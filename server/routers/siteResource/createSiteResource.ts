import {
    clientSiteResources,
    db,
    newts,
    orgs,
    roles,
    roleSiteResources,
    siteNetworks,
    networks,
    SiteResource,
    siteResources,
    sites,
    userSiteResources,
    primaryDb
} from "@server/db";
import { getUniqueSiteResourceName } from "@server/db/names";
import {
    getNextAvailableAliasAddress,
    isIpInCidr,
    portRangeStringSchema
} from "@server/lib/ip";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    rebuildClientAssociationsFromSiteResource,
    isOrgRebuildRateLimited
} from "@server/lib/rebuildClientAssociations";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { and, eq, inArray } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { validateAndConstructDomain } from "@server/lib/domainUtils";
import { createCertificate } from "#dynamic/routers/certificates/createCertificate";
import { build } from "@server/build";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";

const createSiteResourceParamsSchema = z.strictObject({
    orgId: z.string()
});

const createSiteResourceSchema = z
    .strictObject({
        name: z.string().min(1).max(255),
        niceId: z.string().optional(),
        // protocol: z.enum(["tcp", "udp"]).optional(),
        mode: z.enum(["host", "cidr", "http", "ssh"]),
        ssl: z.boolean().optional(), // only used for http mode
        scheme: z.enum(["http", "https"]).optional(),
        siteIds: z.array(z.int()).optional(),
        siteId: z.number().int().positive().optional(), // DEPRECATED: for backward compatibility, we will convert this to siteIds array if provided
        destinationPort: z.int().positive().optional(),
        destination: z.string().min(1).optional(),
        enabled: z.boolean().default(true),
        alias: z
            .string()
            .regex(
                /^(?:[a-zA-Z0-9*?](?:[a-zA-Z0-9*?-]{0,61}[a-zA-Z0-9*?])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
                "Alias must be a fully qualified domain name with optional wildcards (e.g., example.com, *.example.com, host-0?.example.internal)"
            )
            .optional()
            .openapi({
                description:
                    "Fully qualified domain name with optional wildcards, e.g., example.internal, *.example.internal, or host-0?.example.internal",
                example: "service.example.internal"
            }),
        userIds: z.array(z.string()),
        roleIds: z.array(z.int()),
        clientIds: z.array(z.int()),
        tcpPortRangeString: portRangeStringSchema,
        udpPortRangeString: portRangeStringSchema,
        disableIcmp: z.boolean().optional(),
        authDaemonPort: z.int().positive().optional(),
        authDaemonMode: z.enum(["site", "remote", "native"]).optional(),
        pamMode: z.enum(["passthrough", "push"]).optional(),
        domainId: z.string().optional(), // only used for http mode, we need this to verify the alias is unique within the org
        subdomain: z.string().optional() // only used for http mode, we need this to verify the alias is unique within the org
    })
    .strict()
    .refine(
        (data) => {
            if (
                (data.mode === "host" || data.mode === "ssh") &&
                data.destination
            ) {
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
                const isValidAlias =
                    data.alias !== undefined &&
                    data.alias !== null &&
                    data.alias.trim() !== "";

                return isValidDomain && isValidAlias; // require the alias to be set in the case of domain
            } else if (data.mode === "http") {
                // we have to have a domainId defined
                if (!data.domainId) {
                    return false;
                }
            } else if (data.mode === "cidr") {
                // Check if it's a valid CIDR (v4 or v6)
                const isValidCIDR = z
                    .union([z.cidrv4(), z.cidrv6()])
                    .safeParse(data.destination).success;
                return isValidCIDR;
            }
            return true;
        },
        {
            message:
                "Destination must be a valid IPV4 address or valid domain AND alias is required"
        }
    )
    .refine(
        (data) => {
            if (data.mode === "http") {
                return (
                    data.scheme !== undefined &&
                    data.scheme !== null &&
                    data.destinationPort !== undefined &&
                    data.destinationPort !== null &&
                    data.destinationPort >= 1 &&
                    data.destinationPort <= 65535
                );
            } else if (data.mode === "ssh") {
                // just check the destinationPort
                return (
                    data.destinationPort === undefined ||
                    (data.destinationPort !== null &&
                        data.destinationPort >= 1 &&
                        data.destinationPort <= 65535)
                );
            }
            return true;
        },
        {
            message:
                "HTTP mode requires scheme (http or https) and a valid destination port"
        }
    )
    .refine(
        (data) => {
            // destination is only optional for ssh mode with native authDaemonMode
            if (data.mode === "ssh" && data.authDaemonMode === "native") {
                return true;
            }
            return (
                data.destination !== undefined && data.destination.trim() !== ""
            );
        },
        {
            message:
                "Destination is required unless mode is ssh with authDaemonMode native"
        }
    )
    .refine(
        (data) => {
            return (
                (data.siteIds !== undefined && data.siteIds.length > 0) ||
                data.siteId !== undefined
            );
        },
        {
            message: "At least one of siteIds or siteId must be provided"
        }
    )
    .refine(
        (data) => {
            if (data.mode !== "ssh") return true;
            const isSingleSiteMode =
                data.authDaemonMode === "native" ||
                (data.pamMode === "push" && data.authDaemonMode === "site") ||
                (data.pamMode === "push" && data.authDaemonMode === undefined);
            if (!isSingleSiteMode) return true;
            const effectiveSiteIds = [
                ...(data.siteIds ?? []),
                ...(data.siteId !== undefined ? [data.siteId] : [])
            ];
            const uniqueSiteIds = new Set(effectiveSiteIds);
            return uniqueSiteIds.size <= 1;
        },
        {
            message: "Only one site is allowed for this SSH daemon mode"
        }
    );

export type CreateSiteResourceBody = z.infer<typeof createSiteResourceSchema>;
export type CreateSiteResourceResponse = SiteResource;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/site-resource",
    description: "Create a new site resource.",
    tags: [OpenAPITags.PrivateResource],
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

        const { orgId } = parsedParams.data;
        const {
            name,
            niceId,
            siteIds: siteIdsInput = [],
            siteId,
            mode,
            scheme,
            destinationPort,
            destination,
            enabled,
            ssl,
            alias,
            userIds,
            roleIds,
            clientIds,
            tcpPortRangeString,
            udpPortRangeString,
            disableIcmp,
            authDaemonPort,
            authDaemonMode,
            pamMode,
            domainId,
            subdomain
        } = parsedBody.data;

        // Backward compatibility: merge deprecated siteId into siteIds array
        const siteIds = [...siteIdsInput];
        if (siteId !== undefined && !siteIds.includes(siteId)) {
            siteIds.push(siteId);
        }

        if (build == "saas") {
            const usage = await usageService.getUsage(
                orgId,
                LimitId.PRIVATE_RESOURCES
            );
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectResource = await usageService.checkLimitSet(
                orgId,

                LimitId.PRIVATE_RESOURCES,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectResource) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Private resource limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        if (mode == "http") {
            const hasHttpFeature = await isLicensedOrSubscribed(
                orgId,
                tierMatrix[TierFeature.AdvancedPrivateResources]
            );
            if (!hasHttpFeature) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "HTTP private resources are not included in your current plan. Please upgrade."
                    )
                );
            }
        }

        // Verify the site exists and belongs to the org
        const sitesToAssign = await db
            .select()
            .from(sites)
            .where(and(inArray(sites.siteId, siteIds), eq(sites.orgId, orgId)));

        if (sitesToAssign.length !== siteIds.length) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Some site not found")
            );
        }

        const [org] = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (!org) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Organization not found")
            );
        }

        if (!org.subnet || !org.utilitySubnet) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Organization with ID ${orgId} has no subnet or utilitySubnet defined defined`
                )
            );
        }

        if (await isOrgRebuildRateLimited(org.orgId)) {
            return next(
                createHttpError(
                    HttpCode.TOO_MANY_REQUESTS,
                    "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                )
            );
        }

        // Only check if destination is an IP address
        const isIp = z
            .union([z.ipv4(), z.ipv6()])
            .safeParse(destination).success;
        if (
            isIp &&
            (isIpInCidr(destination!, org.subnet) ||
                isIpInCidr(destination!, org.utilitySubnet))
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "IP can not be in the CIDR range of the organization's subnet or utility subnet"
                )
            );
        }

        if (domainId && alias) {
            // throw an error because we can only have one or the other
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Alias and domain cannot both be set. Please choose one or the other."
                )
            );
        }

        let fullDomain: string | null = null;
        let finalSubdomain: string | null = null;
        if (domainId) {
            // Validate domain and construct full domain
            const domainResult = await validateAndConstructDomain(
                domainId,
                orgId,
                subdomain
            );

            if (!domainResult.success) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, domainResult.error)
                );
            }

            fullDomain = domainResult.fullDomain;
            finalSubdomain = domainResult.subdomain;

            // make sure the full domain is unique
            const existingResource = await db
                .select()
                .from(siteResources)
                .where(eq(siteResources.fullDomain, fullDomain));

            if (existingResource.length > 0) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "Resource with that domain already exists"
                    )
                );
            }
        }

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

        const isLicensedSshPam = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.advancedPrivateResources
        );

        if (mode == "ssh" && !isLicensedSshPam) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "SSH private resources are not included in your current plan. Please upgrade."
                )
            );
        }

        let updatedNiceId = niceId;
        if (!niceId) {
            updatedNiceId = await getUniqueSiteResourceName(orgId);
        }

        let aliasAddress: string | null = null;
        let releaseAliasLock: (() => Promise<void>) | null = null;
        if (mode === "host" || mode === "http" || mode === "ssh") {
            const { value, release } =
                await getNextAvailableAliasAddress(orgId);
            aliasAddress = value;
            releaseAliasLock = release;
        }

        let newSiteResource: SiteResource | undefined;
        try {
            await db.transaction(async (trx) => {
                const [network] = await trx
                    .insert(networks)
                    .values({
                        scope: "resource",
                        orgId: orgId
                    })
                    .returning();

                if (!network) {
                    return next(
                        createHttpError(
                            HttpCode.INTERNAL_SERVER_ERROR,
                            `Failed to create network`
                        )
                    );
                }

                let tcpPortRangeStringAdjusted = tcpPortRangeString;
                if (mode === "http") {
                    tcpPortRangeStringAdjusted = "443,80";
                } else if (mode === "ssh") {
                    tcpPortRangeStringAdjusted = destinationPort
                        ? destinationPort.toString()
                        : "22";
                }

                // Create the site resource
                const insertValues: typeof siteResources.$inferInsert = {
                    niceId: updatedNiceId!,
                    orgId,
                    name,
                    mode,
                    ssl,
                    networkId: network.networkId,
                    destination: destination, // the ssh can be null
                    scheme,
                    destinationPort,
                    enabled,
                    alias: alias ? alias.trim() : null,
                    aliasAddress,
                    tcpPortRangeString: tcpPortRangeStringAdjusted,
                    udpPortRangeString:
                        mode == "http" || mode == "ssh"
                            ? ""
                            : udpPortRangeString,
                    disableIcmp:
                        disableIcmp ||
                        (mode == "http" || mode == "ssh" ? true : false), // default to true for http resources, otherwise false
                    domainId,
                    subdomain: finalSubdomain,
                    fullDomain
                };
                if (isLicensedSshPam) {
                    if (authDaemonPort !== undefined)
                        insertValues.authDaemonPort = authDaemonPort;
                    if (authDaemonMode !== undefined)
                        insertValues.authDaemonMode = authDaemonMode;
                    if (pamMode !== undefined) insertValues.pamMode = pamMode;
                }
                [newSiteResource] = await trx
                    .insert(siteResources)
                    .values(insertValues)
                    .returning();

                const siteResourceId = newSiteResource.siteResourceId;

                //////////////////// update the associations ////////////////////

                for (const siteId of siteIds) {
                    await trx.insert(siteNetworks).values({
                        siteId: siteId,
                        networkId: network.networkId
                    });
                }

                const [adminRole] = await trx
                    .select()
                    .from(roles)
                    .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                    .limit(1);

                if (!adminRole) {
                    return next(
                        createHttpError(
                            HttpCode.NOT_FOUND,
                            `Admin role not found`
                        )
                    );
                }

                await trx.insert(roleSiteResources).values({
                    roleId: adminRole.roleId,
                    siteResourceId: siteResourceId
                });

                if (roleIds.length > 0) {
                    await trx.insert(roleSiteResources).values(
                        roleIds.map((roleId) => ({
                            roleId,
                            siteResourceId
                        }))
                    );
                }

                if (userIds.length > 0) {
                    await trx.insert(userSiteResources).values(
                        userIds.map((userId) => ({
                            userId,
                            siteResourceId
                        }))
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

                for (const siteToAssign of sitesToAssign) {
                    const [newt] = await trx
                        .select()
                        .from(newts)
                        .where(eq(newts.siteId, siteToAssign.siteId))
                        .limit(1);

                    if (!newt) {
                        return next(
                            createHttpError(
                                HttpCode.NOT_FOUND,
                                `Newt not found for site ${siteToAssign.siteId}`
                            )
                        );
                    }
                }

                await usageService.add(
                    orgId,
                    LimitId.PRIVATE_RESOURCES,
                    1,
                    trx
                );
            });
        } finally {
            await releaseAliasLock?.();
        }

        if (!newSiteResource) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Site resource creation failed"
                )
            );
        }

        logger.info(
            `Created site resource ${newSiteResource.siteResourceId} for org ${orgId}`
        );

        if (
            ssl &&
            mode === "http" &&
            domainId &&
            fullDomain &&
            build != "oss"
        ) {
            await createCertificate(domainId, fullDomain, db);
        }

        // Run in the background after the response is sent. Wrapped in its
        // own transaction so it always executes on the primary — avoiding any
        // replica-lag issues while still allowing the HTTP response to return
        // early.
        rebuildClientAssociationsFromSiteResource(newSiteResource!).catch(
            (err) => {
                logger.error(
                    `Error rebuilding client associations for site resource ${newSiteResource!.siteResourceId}:`,
                    err
                );
            }
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
