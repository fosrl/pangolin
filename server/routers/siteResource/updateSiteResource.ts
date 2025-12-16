import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    clientSiteResources,
    clientSiteResourcesAssociationsCache,
    db,
    newts,
    roles,
    roleSiteResources,
    sites,
    Transaction,
    userSiteResources
} from "@server/db";
import { siteResources, SiteResource } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, and, ne } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import { updatePeerData, updateTargets } from "@server/routers/client/targets";
import {
    generateAliasConfig,
    generateRemoteSubnets,
    generateSubnetProxyTargets,
    portRangeStringSchema
} from "@server/lib/ip";
import {
    getClientSiteResourceAccess,
    rebuildClientAssociationsFromSiteResource
} from "@server/lib/rebuildClientAssociations";

const updateSiteResourceParamsSchema = z.strictObject({
    siteResourceId: z.string().transform(Number).pipe(z.int().positive()),
    siteId: z.string().transform(Number).pipe(z.int().positive()),
    orgId: z.string()
});

const updateSiteResourceSchema = z
    .strictObject({
        name: z.string().min(1).max(255).optional(),
        // mode: z.enum(["host", "cidr", "port"]).optional(),
        mode: z.enum(["host", "cidr"]).optional(),
        // protocol: z.enum(["tcp", "udp"]).nullish(),
        // proxyPort: z.int().positive().nullish(),
        // destinationPort: z.int().positive().nullish(),
        destination: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
        alias: z
            .string()
            .regex(
                /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
                "Alias must be a fully qualified domain name (e.g., example.internal)"
            )
            .nullish(),
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
            if (data.mode === "host" && data.destination) {
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
            if (data.mode === "cidr" && data.destination) {
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

export type UpdateSiteResourceBody = z.infer<typeof updateSiteResourceSchema>;
export type UpdateSiteResourceResponse = SiteResource;

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/site/{siteId}/resource/{siteResourceId}",
    description: "Update a site resource.",
    tags: [OpenAPITags.Client, OpenAPITags.Org],
    request: {
        params: updateSiteResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateSiteResourceSchema
                }
            }
        }
    },
    responses: {}
});

export async function updateSiteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateSiteResourceParamsSchema.safeParse(
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

        const parsedBody = updateSiteResourceSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteResourceId, siteId, orgId } = parsedParams.data;
        const {
            name,
            mode,
            destination,
            alias,
            enabled,
            userIds,
            roleIds,
            clientIds,
            tcpPortRangeString,
            udpPortRangeString,
            disableIcmp
        } = parsedBody.data;

        const [site] = await db
            .select()
            .from(sites)
            .where(and(eq(sites.siteId, siteId), eq(sites.orgId, orgId)))
            .limit(1);

        if (!site) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Site not found"));
        }

        // Check if site resource exists
        const [existingSiteResource] = await db
            .select()
            .from(siteResources)
            .where(
                and(
                    eq(siteResources.siteResourceId, siteResourceId),
                    eq(siteResources.siteId, siteId),
                    eq(siteResources.orgId, orgId)
                )
            )
            .limit(1);

        if (!existingSiteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        // make sure the alias is unique within the org if provided
        if (alias) {
            const [conflict] = await db
                .select()
                .from(siteResources)
                .where(
                    and(
                        eq(siteResources.orgId, orgId),
                        eq(siteResources.alias, alias.trim()),
                        ne(siteResources.siteResourceId, siteResourceId) // exclude self
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

        let updatedSiteResource: SiteResource | undefined;
        await db.transaction(async (trx) => {
            // Update the site resource
            [updatedSiteResource] = await trx
                .update(siteResources)
                .set({
                    name: name,
                    mode: mode,
                    destination: destination,
                    enabled: enabled,
                    alias: alias && alias.trim() ? alias : null,
                    tcpPortRangeString: tcpPortRangeString,
                    udpPortRangeString: udpPortRangeString,
                    disableIcmp: disableIcmp
                })
                .where(
                    and(
                        eq(siteResources.siteResourceId, siteResourceId),
                        eq(siteResources.siteId, siteId),
                        eq(siteResources.orgId, orgId)
                    )
                )
                .returning();

            //////////////////// update the associations ////////////////////

            await trx
                .delete(clientSiteResources)
                .where(eq(clientSiteResources.siteResourceId, siteResourceId));

            if (clientIds.length > 0) {
                await trx.insert(clientSiteResources).values(
                    clientIds.map((clientId) => ({
                        clientId,
                        siteResourceId
                    }))
                );
            }

            await trx
                .delete(userSiteResources)
                .where(eq(userSiteResources.siteResourceId, siteResourceId));

            if (userIds.length > 0) {
                await trx
                    .insert(userSiteResources)
                    .values(
                        userIds.map((userId) => ({ userId, siteResourceId }))
                    );
            }

            // Get all admin role IDs for this org to exclude from deletion
            const adminRoles = await trx
                .select()
                .from(roles)
                .where(
                    and(
                        eq(roles.isAdmin, true),
                        eq(roles.orgId, updatedSiteResource.orgId)
                    )
                );
            const adminRoleIds = adminRoles.map((role) => role.roleId);

            if (adminRoleIds.length > 0) {
                await trx.delete(roleSiteResources).where(
                    and(
                        eq(roleSiteResources.siteResourceId, siteResourceId),
                        ne(roleSiteResources.roleId, adminRoleIds[0]) // delete all but the admin role
                    )
                );
            } else {
                await trx
                    .delete(roleSiteResources)
                    .where(
                        eq(roleSiteResources.siteResourceId, siteResourceId)
                    );
            }

            if (roleIds.length > 0) {
                await trx
                    .insert(roleSiteResources)
                    .values(
                        roleIds.map((roleId) => ({ roleId, siteResourceId }))
                    );
            }

            logger.info(
                `Updated site resource ${siteResourceId} for site ${siteId}`
            );

            await handleMessagingForUpdatedSiteResource(
                existingSiteResource,
                updatedSiteResource!,
                { siteId: site.siteId, orgId: site.orgId },
                trx
            );
        });

        return response(res, {
            data: updatedSiteResource,
            success: true,
            error: false,
            message: "Site resource updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error updating site resource:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to update site resource"
            )
        );
    }
}

export async function handleMessagingForUpdatedSiteResource(
    existingSiteResource: SiteResource | undefined,
    updatedSiteResource: SiteResource,
    site: { siteId: number; orgId: string },
    trx: Transaction
) {
    const { mergedAllClients } =
        await rebuildClientAssociationsFromSiteResource(
            existingSiteResource || updatedSiteResource, // we want to rebuild based on the existing resource then we will apply the change to the destination below
            trx
        );

    // after everything is rebuilt above we still need to update the targets and remote subnets if the destination changed
    const destinationChanged =
        existingSiteResource &&
        existingSiteResource.destination !== updatedSiteResource.destination;
    const aliasChanged =
        existingSiteResource &&
        existingSiteResource.alias !== updatedSiteResource.alias;
    const portRangesChanged =
        existingSiteResource &&
        (existingSiteResource.tcpPortRangeString !==
            updatedSiteResource.tcpPortRangeString ||
            existingSiteResource.udpPortRangeString !==
                updatedSiteResource.udpPortRangeString ||
            existingSiteResource.disableIcmp !==
                updatedSiteResource.disableIcmp);

    // if the existingSiteResource is undefined (new resource) we don't need to do anything here, the rebuild above handled it all

    if (destinationChanged || aliasChanged || portRangesChanged) {
        const [newt] = await trx
            .select()
            .from(newts)
            .where(eq(newts.siteId, site.siteId))
            .limit(1);

        if (!newt) {
            throw new Error(
                "Newt not found for site during site resource update"
            );
        }

        // Only update targets on newt if destination changed
        if (destinationChanged || portRangesChanged) {
            const oldTargets = generateSubnetProxyTargets(
                existingSiteResource,
                mergedAllClients
            );
            const newTargets = generateSubnetProxyTargets(
                updatedSiteResource,
                mergedAllClients
            );

            await updateTargets(newt.newtId, {
                oldTargets: oldTargets,
                newTargets: newTargets
            });
        }

        const olmJobs: Promise<void>[] = [];
        for (const client of mergedAllClients) {
            // does this client have access to another resource on this site that has the same destination still? if so we dont want to remove it from their olm yet
            // todo: optimize this query if needed
            const oldDestinationStillInUseSites = await trx
                .select()
                .from(siteResources)
                .innerJoin(
                    clientSiteResourcesAssociationsCache,
                    eq(
                        clientSiteResourcesAssociationsCache.siteResourceId,
                        siteResources.siteResourceId
                    )
                )
                .where(
                    and(
                        eq(
                            clientSiteResourcesAssociationsCache.clientId,
                            client.clientId
                        ),
                        eq(siteResources.siteId, site.siteId),
                        eq(
                            siteResources.destination,
                            existingSiteResource.destination
                        ),
                        ne(
                            siteResources.siteResourceId,
                            existingSiteResource.siteResourceId
                        )
                    )
                );

            const oldDestinationStillInUseByASite =
                oldDestinationStillInUseSites.length > 0;

            // we also need to update the remote subnets on the olms for each client that has access to this site
            olmJobs.push(
                updatePeerData(
                    client.clientId,
                    updatedSiteResource.siteId,
                    destinationChanged
                        ? {
                              oldRemoteSubnets: !oldDestinationStillInUseByASite
                                  ? generateRemoteSubnets([
                                        existingSiteResource
                                    ])
                                  : [],
                              newRemoteSubnets: generateRemoteSubnets([
                                  updatedSiteResource
                              ])
                          }
                        : undefined,
                    aliasChanged
                        ? {
                              oldAliases: generateAliasConfig([
                                  existingSiteResource
                              ]),
                              newAliases: generateAliasConfig([
                                  updatedSiteResource
                              ])
                          }
                        : undefined
                )
            );
        }

        await Promise.all(olmJobs);
    }
}
