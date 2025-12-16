import {
    clientSiteResources,
    db,
    newts,
    roles,
    roleSiteResources,
    SiteResource,
    siteResources,
    sites,
    userSiteResources
} from "@server/db";
import { getUniqueSiteResourceName } from "@server/db/names";
import { getNextAvailableAliasAddress, portRangeStringSchema } from "@server/lib/ip";
import { rebuildClientAssociationsFromSiteResource } from "@server/lib/rebuildClientAssociations";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const createSiteResourceParamsSchema = z.strictObject({
    siteId: z.string().transform(Number).pipe(z.int().positive()),
    orgId: z.string()
});

const createSiteResourceSchema = z
    .strictObject({
        name: z.string().min(1).max(255),
        mode: z.enum(["host", "cidr", "port"]),
        // protocol: z.enum(["tcp", "udp"]).optional(),
        // proxyPort: z.int().positive().optional(),
        // destinationPort: z.int().positive().optional(),
        destination: z.string().min(1),
        enabled: z.boolean().default(true),
        alias: z
            .string()
            .regex(
                /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
                "Alias must be a fully qualified domain name (e.g., example.com)"
            )
            .optional(),
        userIds: z.array(z.string()),
        roleIds: z.array(z.int()),
        clientIds: z.array(z.int()),
        tcpPortRangeString: portRangeStringSchema,
        udpPortRangeString: portRangeStringSchema,
        disableIcmp: z.boolean().optional()
    })
    .strict()
    .refine(
        (data) => {
            if (data.mode === "host") {
                // Check if it's a valid IP address using zod (v4 or v6)
                const isValidIP = z
                    // .union([z.ipv4(), z.ipv6()])
                    .union([z.ipv4()]) // for now lets just do ipv4 until we verify ipv6 works everywhere
                    .safeParse(data.destination).success;

                if (isValidIP) {
                    return true;
                }

                // Check if it's a valid domain (hostname pattern, TLD not required)
                const domainRegex =
                    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
                const isValidDomain = domainRegex.test(data.destination);
                const isValidAlias = data.alias && domainRegex.test(data.alias);

                return isValidDomain && isValidAlias; // require the alias to be set in the case of domain
            }
            return true;
        },
        {
            message:
                "Destination must be a valid IP address or valid domain AND alias is required"
        }
    )
    .refine(
        (data) => {
            if (data.mode === "cidr") {
                // Check if it's a valid CIDR (v4 or v6)
                const isValidCIDR = z
                    // .union([z.cidrv4(), z.cidrv6()])
                    .union([z.cidrv4()]) // for now lets just do ipv4 until we verify ipv6 works everywhere
                    .safeParse(data.destination).success;
                return isValidCIDR;
            }
            return true;
        },
        {
            message: "Destination must be a valid CIDR notation for cidr mode"
        }
    );

export type CreateSiteResourceBody = z.infer<typeof createSiteResourceSchema>;
export type CreateSiteResourceResponse = SiteResource;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/site/{siteId}/resource",
    description: "Create a new site resource.",
    tags: [OpenAPITags.Client, OpenAPITags.Org],
    request: {
        params: createSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createSiteResourceSchema
                }
            }
        }
    },
    responses: {}
});

export async function createSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = createSiteResourceParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = createSiteResourceSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteId, orgId } = parsedParams.data;
        const {
            name,
            mode,
            // protocol,
            // proxyPort,
            // destinationPort,
            destination,
            enabled,
            alias,
            userIds,
            roleIds,
            clientIds,
            tcpPortRangeString,
            udpPortRangeString,
            disableIcmp
        } = parsedBody.data;

        // Verify the site exists and belongs to the org
        const [site] = await db
            .select()
            .from(sites)
            .where(and(eq(sites.siteId, siteId), eq(sites.orgId, orgId)))
            .limit(1);

        if (!site) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Site not found"));
        }

        // // check if resource with same protocol and proxy port already exists (only for port mode)
        // if (mode === "port" && protocol && proxyPort) {
        //     const [existingResource] = await db
        //         .select()
        //         .from(siteResources)
        //         .where(
        //             and(
        //                 eq(siteResources.siteId, siteId),
        //                 eq(siteResources.orgId, orgId),
        //                 eq(siteResources.protocol, protocol),
        //                 eq(siteResources.proxyPort, proxyPort)
        //             )
        //         )
        //         .limit(1);
        //     if (existingResource && existingResource.siteResourceId) {
        //         return next(
        //             createHttpError(
        //                 HttpCode.CONFLICT,
        //                 "A resource with the same protocol and proxy port already exists"
        //             )
        //         );
        //     }
        // }

        // make sure the alias is unique within the org if provided
        if (alias) {
            const [conflict] = await db
                .select()
                .from(siteResources)
                .where(
                    and(
                        eq(siteResources.orgId, orgId),
                        eq(siteResources.alias, alias.trim())
                    )
                )
                .limit(1);

            if (conflict) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "Alias already in use by another site resource"
                    )
                );
            }
        }

        const niceId = await getUniqueSiteResourceName(orgId);
        let aliasAddress: string | null = null;
        if (mode == "host") {
            // we can only have an alias on a host
            aliasAddress = await getNextAvailableAliasAddress(orgId);
        }

        let newSiteResource: SiteResource | undefined;
        await db.transaction(async (trx) => {
            // Create the site resource
            [newSiteResource] = await trx
                .insert(siteResources)
                .values({
                    siteId,
                    niceId,
                    orgId,
                    name,
                    mode,
                    // protocol: mode === "port" ? protocol : null,
                    // proxyPort: mode === "port" ? proxyPort : null,
                    // destinationPort: mode === "port" ? destinationPort : null,
                    destination,
                    enabled,
                    alias,
                    aliasAddress,
                    tcpPortRangeString,
                    udpPortRangeString,
                    disableIcmp
                })
                .returning();

            const siteResourceId = newSiteResource.siteResourceId;

            //////////////////// update the associations ////////////////////

            const [adminRole] = await trx
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                .limit(1);

            if (!adminRole) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, `Admin role not found`)
                );
            }

            await trx.insert(roleSiteResources).values({
                roleId: adminRole.roleId,
                siteResourceId: siteResourceId
            });

            if (roleIds.length > 0) {
                await trx
                    .insert(roleSiteResources)
                    .values(
                        roleIds.map((roleId) => ({ roleId, siteResourceId }))
                    );
            }

            if (userIds.length > 0) {
                await trx
                    .insert(userSiteResources)
                    .values(
                        userIds.map((userId) => ({ userId, siteResourceId }))
                    );
            }

            if (clientIds.length > 0) {
                await trx.insert(clientSiteResources).values(
                    clientIds.map((clientId) => ({
                        clientId,
                        siteResourceId
                    }))
                );
            }

            const [newt] = await trx
                .select()
                .from(newts)
                .where(eq(newts.siteId, site.siteId))
                .limit(1);

            if (!newt) {
                return next(
                    createHttpError(HttpCode.NOT_FOUND, "Newt not found")
                );
            }

            await rebuildClientAssociationsFromSiteResource(
                newSiteResource,
                trx
            ); // we need to call this because we added to the admin role
        });

        if (!newSiteResource) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Site resource creation failed"
                )
            );
        }

        logger.info(
            `Created site resource ${newSiteResource.siteResourceId} for site ${siteId}`
        );

        return response(res, {
            data: newSiteResource,
            success: true,
            error: false,
            message: "Site resource created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error("Error creating site resource:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create site resource"
            )
        );
    }
}
