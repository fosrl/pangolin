import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { clients, db, exitNodes, logsDb, statusHistory } from "@server/db";
import { roles, userSites, sites, roleSites, Site, orgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq, and, count } from "drizzle-orm";
import { getUniqueSiteName } from "../../db/names";
import { addPeer } from "../gerbil/peers";
import { fromError } from "zod-validation-error";
import { newts } from "@server/db";
import moment from "moment";
import { OpenAPITags, registry } from "@server/openApi";
import { hashPassword } from "@server/auth/password";
import { isValidIP } from "@server/lib/validators";
import { getNextAvailableClientSubnet, isIpInCidr } from "@server/lib/ip";
import { verifyExitNodeOrgAccess } from "#dynamic/lib/exitNodes";
import { build } from "@server/build";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import { generateId } from "@server/auth/sessions/app";

const createSiteParamsSchema = z.strictObject({
    orgId: z.string()
});

const createSiteSchema = z.strictObject({
    name: z.string().min(1).max(255),
    exitNodeId: z.int().positive().optional(),
    niceId: z.string().min(1).max(255).optional(),
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
});
// .refine((data) => {
//     if (data.type === "local") {
//         return !config.getRawConfig().flags?.disable_local_sites;
//     } else if (data.type === "wireguard") {
//         return !config.getRawConfig().flags?.disable_basic_wireguard_sites;
//     }
//     return true;
// });

export type CreateSiteBody = z.infer<typeof createSiteSchema>;

export type CreateSiteResponse = Site & {
    newtId?: string;
    secret?: string;
};

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/site",
    description: "Create a new site.",
    tags: [OpenAPITags.Site],
    request: {
        params: createSiteParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createSiteSchema,
                    example: {
                        name: "My Site",
                        type: "newt"
                    }
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
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
            address,
            niceId
        } = parsedBody.data;

        const updatedNewtSecret = secret || generateId(48);
        const updatedNewtId = newtId || generateId(15);

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

        if (
            req.user &&
            (!req.userOrgRoleIds || req.userOrgRoleIds.length === 0)
        ) {
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

        if (build == "saas") {
            const usage = await usageService.getUsage(orgId, LimitId.SITES);
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectSites = await usageService.checkLimitSet(
                orgId,

                LimitId.SITES,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectSites) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Site limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        let updatedAddress = null;
        let releaseSubnetLock: (() => Promise<void>) | null = null;
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
        } else {
            const { value: newClientAddress, release } =
                await getNextAvailableClientSubnet(orgId);
            releaseSubnetLock = release;
            updatedAddress = newClientAddress.split("/")[0];
        }

        let newSite: Site | undefined;
        try {
            if (type === "wireguard" && subnet && exitNodeId) {
                // Only wireguard sites actually persist the provided subnet/exitNodeId.
                // Newt sites have their subnet/exit node chosen (under a lock) when the
                // newt connects, so validating them here is both unnecessary and racy,
                // since pickSiteDefaults does not lock the subnet it suggests.
                //make sure the subnet is in the range of the exit node if provided
                const [exitNode] = await db
                    .select()
                    .from(exitNodes)
                    .where(eq(exitNodes.exitNodeId, exitNodeId));

                if (!exitNode) {
                    return next(
                        createHttpError(
                            HttpCode.NOT_FOUND,
                            "Exit node not found"
                        )
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

            let updatedNiceId = niceId;
            if (!niceId) {
                updatedNiceId = await getUniqueSiteName(orgId);
            } else {
                // make sure the niceId is unique
                const existingSite = await db
                    .select()
                    .from(sites)
                    .where(
                        and(eq(sites.niceId, niceId), eq(sites.orgId, orgId))
                    )
                    .limit(1);

                if (existingSite.length > 0) {
                    return next(
                        createHttpError(
                            HttpCode.CONFLICT,
                            `Nice ID ${niceId} already exists. Please choose a different one.`
                        )
                    );
                }
            }

            await db.transaction(async (trx) => {
                if (type == "newt") {
                    [newSite] = await trx
                        .insert(sites)
                        .values({
                            // NOTE: NO SUBNET OR EXIT NODE ID PASSED IN HERE BECAUSE ITS NOW CHOSEN ON CONNECT
                            orgId,
                            name,
                            niceId: updatedNiceId!,
                            address: updatedAddress || null,
                            type,
                            dockerSocketEnabled: true,
                            status: "approved"
                        })
                        .returning();

                    await logsDb.insert(statusHistory).values({
                        entityType: "site",
                        entityId: newSite.siteId,
                        orgId: orgId,
                        status: "offline",
                        timestamp: Math.floor(Date.now() / 1000)
                    });
                } else if (type == "wireguard") {
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

                    const { exitNode, hasAccess } =
                        await verifyExitNodeOrgAccess(exitNodeId, orgId);

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
                            niceId: updatedNiceId!,
                            subnet,
                            type,
                            pubKey: pubKey || null,
                            status: "approved"
                        })
                        .returning();
                } else if (type == "local") {
                    [newSite] = await trx
                        .insert(sites)
                        .values({
                            exitNodeId: exitNodeId || null,
                            orgId,
                            name,
                            niceId: updatedNiceId!,
                            type,
                            dockerSocketEnabled: false,
                            online: true,
                            subnet: "0.0.0.0/32",
                            status: "approved"
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
                        createHttpError(
                            HttpCode.NOT_FOUND,
                            `Admin role not found`
                        )
                    );
                }

                await trx.insert(roleSites).values({
                    roleId: adminRole[0].roleId,
                    siteId: newSite.siteId
                });

                if (
                    req.user &&
                    !req.userOrgRoleIds?.includes(adminRole[0].roleId)
                ) {
                    // make sure the user can access the site
                    trx.insert(userSites).values({
                        userId: req.user?.userId!,
                        siteId: newSite.siteId
                    });
                }

                // add the peer to the exit node
                if (type == "newt") {
                    const secretHash = await hashPassword(updatedNewtSecret);

                    await trx.insert(newts).values({
                        newtId: updatedNewtId,
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

                await usageService.add(orgId, LimitId.SITES, 1, trx);
            });
        } finally {
            await releaseSubnetLock?.();
        }

        if (!newSite) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to create site"
                )
            );
        }

        return response<CreateSiteResponse>(res, {
            data: {
                ...newSite,
                newtId: type == "newt" ? updatedNewtId : undefined,
                secret: type == "newt" ? updatedNewtSecret : undefined
            },
            success: true,
            error: false,
            message: "Site created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
