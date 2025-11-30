import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { clients, db, exitNodes } from "@server/db";
import { roles, userSites, sites, roleSites, Site, orgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq, and } from "drizzle-orm";
import { getUniqueSiteName } from "../../db/names";
import { addPeer } from "../gerbil/peers";
import { fromError } from "zod-validation-error";
import { newts } from "@server/db";
import moment from "moment";
import { OpenAPITags, registry } from "@server/openApi";
import { hashPassword } from "@server/auth/password";
import { isValidIP } from "@server/lib/validators";
import { isIpInCidr } from "@server/lib/ip";
import { verifyExitNodeOrgAccess } from "#dynamic/lib/exitNodes";
import { build } from "@server/build";

const createSiteParamsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

const createSiteSchema = z
    .object({
        name: z.string().min(1).max(255),
        exitNodeId: z.number().int().positive().optional(),
        // subdomain: z
        //     .string()
        //     .min(1)
        //     .max(255)
        //     .transform((val) => val.toLowerCase())
        //     .optional(),
        pubKey: z.string().optional(),
        subnet: z.string().optional(),
        newtId: z.string().optional(),
        secret: z.string().optional(),
        address: z.string().optional(),
        type: z.enum(["newt", "wireguard", "local"])
    })
    .strict();
// .refine((data) => {
//     if (data.type === "local") {
//         return !config.getRawConfig().flags?.disable_local_sites;
//     } else if (data.type === "wireguard") {
//         return !config.getRawConfig().flags?.disable_basic_wireguard_sites;
//     }
//     return true;
// });

export type CreateSiteBody = z.infer<typeof createSiteSchema>;

export type CreateSiteResponse = Site;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/site",
    description: "Create a new site.",
    tags: [OpenAPITags.Site, OpenAPITags.Org],
    request: {
        params: createSiteParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createSiteSchema
                }
            }
        }
    },
    responses: {}
});

export async function createSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createSiteSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const {
            name,
            type,
            exitNodeId,
            pubKey,
            subnet,
            newtId,
            secret,
            address
        } = parsedBody.data;

        const parsedParams = createSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        if (req.user && !req.userOrgRoleId) {
            return next(
                createHttpError(HttpCode.FORBIDDEN, "User does not have a role")
            );
        }

        const [org] = await db.select().from(orgs).where(eq(orgs.orgId, orgId));

        if (!org) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Organization with ID ${orgId} not found`
                )
            );
        }

        let updatedAddress = null;
        if (address) {
            if (!org.subnet) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `Organization with ID ${orgId} has no subnet defined`
                    )
                );
            }

            if (!isValidIP(address)) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid address format. Please provide a valid IP notation."
                    )
                );
            }

            if (!isIpInCidr(address, org.subnet)) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "IP is not in the CIDR range of the subnet."
                    )
                );
            }

            updatedAddress = `${address}/${org.subnet.split("/")[1]}`; // we want the block size of the whole org

            // make sure the subnet is unique
            const addressExistsSites = await db
                .select()
                .from(sites)
                .where(
                    and(
                        eq(sites.address, updatedAddress),
                        eq(sites.orgId, orgId)
                    )
                )
                .limit(1);

            if (addressExistsSites.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `Subnet ${updatedAddress} already exists in sites`
                    )
                );
            }

            const addressExistsClients = await db
                .select()
                .from(clients)
                .where(
                    and(
                        eq(clients.subnet, updatedAddress),
                        eq(clients.orgId, orgId)
                    )
                )
                .limit(1);
            if (addressExistsClients.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `Subnet ${updatedAddress} already exists in clients`
                    )
                );
            }
        }

        if (subnet && exitNodeId) {
            //make sure the subnet is in the range of the exit node if provided
            const [exitNode] = await db
                .select()
                .from(exitNodes)
                .where(eq(exitNodes.exitNodeId, exitNodeId));

            if (!exitNode) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, "Exit node not found")
                );
            }

            if (!exitNode.address) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Exit node has no subnet defined"
                    )
                );
            }

            const subnetIp = subnet.split("/")[0];

            if (!isIpInCidr(subnetIp, exitNode.address)) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Subnet is not in the CIDR range of the exit node address."
                    )
                );
            }

            // lets also make sure there is no overlap with other sites on the exit node
            const sitesQuery = await db
                .select({
                    subnet: sites.subnet
                })
                .from(sites)
                .where(
                    and(
                        eq(sites.exitNodeId, exitNodeId),
                        eq(sites.subnet, subnet)
                    )
                );

            if (sitesQuery.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `Subnet ${subnet} overlaps with an existing site on this exit node. Please restart site creation.`
                    )
                );
            }
        }

        const niceId = await getUniqueSiteName(orgId);

        let newSite: Site;

        await db.transaction(async (trx) => {
            if (type == "wireguard" || type == "newt") {
                // we are creating a site with an exit node (tunneled)
                if (!subnet) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Subnet is required for tunneled sites"
                        )
                    );
                }

                if (!exitNodeId) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Exit node ID is required for tunneled sites"
                        )
                    );
                }

                const { exitNode, hasAccess } = await verifyExitNodeOrgAccess(
                    exitNodeId,
                    orgId
                );

                if (!exitNode) {
                    logger.warn("Exit node not found");
                    return next(
                        createHttpError(
                            HttpCode.NOT_FOUND,
                            "Exit node not found"
                        )
                    );
                }

                if (!hasAccess) {
                    logger.warn("Not authorized to use this exit node");
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            "Not authorized to use this exit node"
                        )
                    );
                }

                [newSite] = await trx
                    .insert(sites)
                    .values({
                        orgId,
                        exitNodeId,
                        name,
                        niceId,
                        address: updatedAddress || null,
                        subnet,
                        type,
                        dockerSocketEnabled: type == "newt",
                        ...(pubKey && type == "wireguard" && { pubKey })
                    })
                    .returning();
            } else if (type == "local") {
                [newSite] = await trx
                    .insert(sites)
                    .values({
                        exitNodeId: exitNodeId || null,
                        orgId,
                        name,
                        niceId,
                        address: updatedAddress || null,
                        type,
                        dockerSocketEnabled: false,
                        online: true,
                        subnet: "0.0.0.0/32"
                    })
                    .returning();
            } else {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Site type not recognized"
                    )
                );
            }

            const adminRole = await trx
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                .limit(1);

            if (adminRole.length === 0) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, `Admin role not found`)
                );
            }

            await trx.insert(roleSites).values({
                roleId: adminRole[0].roleId,
                siteId: newSite.siteId
            });

            if (req.user && req.userOrgRoleId != adminRole[0].roleId) {
                // make sure the user can access the site
                trx.insert(userSites).values({
                    userId: req.user?.userId!,
                    siteId: newSite.siteId
                });
            }

            // add the peer to the exit node
            if (type == "newt") {
                const secretHash = await hashPassword(secret!);

                await trx.insert(newts).values({
                    newtId: newtId!,
                    secretHash,
                    siteId: newSite.siteId,
                    dateCreated: moment().toISOString()
                });
            } else if (type == "wireguard") {
                if (!pubKey) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Public key is required for wireguard sites"
                        )
                    );
                }

                if (!exitNodeId) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Exit node ID is required for wireguard sites"
                        )
                    );
                }

                await addPeer(exitNodeId, {
                    publicKey: pubKey,
                    allowedIps: []
                });
            }

            return response<CreateSiteResponse>(res, {
                data: newSite,
                success: true,
                error: false,
                message: "Site created successfully",
                status: HttpCode.CREATED
            });
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
