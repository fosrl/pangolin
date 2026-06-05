import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    domainNamespaces,
    loginPage,
    resourceHeaderAuth,
    resourceHeaderAuthExtendedCompatibility,
    resourcePassword,
    resourcePincode,
    resourceRules,
    resourceWhitelist
} from "@server/db";
import {
    domains,
    Org,
    orgDomains,
    orgs,
    Resource,
    resourcePolicies,
    resources
} from "@server/db";
import { eq, and, ne } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import config from "@server/lib/config";
import {
    tlsNameSchema,
    subdomainSchema,
    wildcardSubdomainSchema
} from "@server/lib/schemas";
import { registry } from "@server/openApi";
import { OpenAPITags } from "@server/openApi";
import { createCertificate } from "#dynamic/routers/certificates/createCertificate";
import {
    validateAndConstructDomain,
    checkWildcardDomainConflict
} from "@server/lib/domainUtils";
import { build } from "@server/build";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { isSubscribed } from "#dynamic/lib/isSubscribed";
import {
    isHealthDependentDNSRoutingPolicy,
    resourceHasEnabledHealthChecks,
    updateDNSAuthorityForResource,
    updateDNSAuthorityForDomain
} from "@server/routers/dns/dnsAuthority";
import { updateAuthProxyForResource } from "@server/routers/auth/authProxy";

const updateResourceParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

const updateHttpResourceBodySchema = z
    .strictObject({
        name: z.string().min(1).max(255).optional(),
        niceId: z
            .string()
            .min(1)
            .max(255)
            .regex(
                /^[a-zA-Z0-9-]+$/,
                "niceId can only contain letters, numbers, and dashes"
            )
            .optional(),
        subdomain: z.string().nullable().optional(),
        ssl: z.boolean().optional(),
        sso: z.boolean().optional(),
        blockAccess: z.boolean().optional(),
        emailWhitelistEnabled: z.boolean().optional(),
        applyRules: z.boolean().optional(),
        domainId: z.string().optional(),
        enabled: z.boolean().optional(),
        stickySession: z.boolean().optional(),
        tlsServerName: z.string().nullable().optional(),
        setHostHeader: z.string().nullable().optional(),
        skipToIdpId: z.int().positive().nullable().optional(),
        headers: z
            .array(z.strictObject({ name: z.string(), value: z.string() }))
            .nullable()
            .optional(),
        // Maintenance mode fields
        maintenanceModeEnabled: z.boolean().optional(),
        maintenanceModeType: z.enum(["forced", "automatic"]).optional(),
        maintenanceTitle: z.string().max(255).nullable().optional(),
        maintenanceMessage: z.string().max(2000).nullable().optional(),
        maintenanceEstimatedTime: z.string().max(100).nullable().optional(),
        postAuthPath: z.string().nullable().optional(),
        // SSH settings
        pamMode: z.enum(["passthrough", "push"]).optional(),
        authDaemonMode: z.enum(["site", "remote", "native"]).optional(),
        authDaemonPort: z.int().min(1).max(65535).nullable().optional(),
        // DNS Authority fields
        dnsAuthorityEnabled: z.boolean().optional(),
        dnsAuthorityTtl: z.int().min(1).max(86400).optional(),
        dnsAuthorityRoutingPolicy: z
            .enum(["failover", "roundrobin", "priority", "intelligent"])
            .optional(),
        resourcePolicyId: z.number().nullable().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    })
    .refine(
        (data) => {
            if (data.subdomain) {
                return (
                    subdomainSchema.safeParse(data.subdomain).success ||
                    wildcardSubdomainSchema.safeParse(data.subdomain).success
                );
            }
            return true;
        },
        {
            error: "Invalid subdomain"
        }
    )
    .refine(
        (data) => {
            if (data.tlsServerName) {
                return tlsNameSchema.safeParse(data.tlsServerName).success;
            }
            return true;
        },
        {
            error: "Invalid TLS Server Name. Use domain name format, or save empty to remove the TLS Server Name."
        }
    )
    .refine(
        (data) => {
            if (data.setHostHeader) {
                return tlsNameSchema.safeParse(data.setHostHeader).success;
            }
            return true;
        },
        {
            error: "Invalid custom Host Header value. Use domain name format, or save empty to unset custom Host Header."
        }
    )
    .refine(
        (data) => {
            if (data.headers) {
                // HTTP header names must be valid token characters (RFC 7230)
                const validHeaderName = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;
                return data.headers.every((h) => validHeaderName.test(h.name));
            }
            return true;
        },
        {
            error: "Header names may only contain valid HTTP token characters (letters, digits, and !#$%&'*+-.^_`|~)."
        }
    )
    .refine(
        (data) => {
            if (data.headers) {
                // HTTP header values must be visible ASCII or horizontal whitespace, no control chars (RFC 7230)
                const validHeaderValue = /^[\t\x20-\x7E]*$/;
                return data.headers.every((h) =>
                    validHeaderValue.test(h.value)
                );
            }
            return true;
        },
        {
            error: "Header values may only contain printable ASCII characters and horizontal whitespace."
        }
    )
    .refine(
        (data) => {
            if (data.headers) {
                // Reject Traefik template syntax {{word}} in names or values
                const templatePattern = /\{\{[^}]+\}\}/;
                return data.headers.every(
                    (h) =>
                        !templatePattern.test(h.name) &&
                        !templatePattern.test(h.value)
                );
            }
            return true;
        },
        {
            error: "Header names and values must not contain template expressions such as {{value}}."
        }
    );

export type UpdateResourceResponse = Resource;

const updateRawResourceBodySchema = z
    .strictObject({
        name: z.string().min(1).max(255).optional(),
        niceId: z.string().min(1).max(255).optional(),
        proxyPort: z.int().min(1).max(65535).optional(),
        stickySession: z.boolean().optional(),
        enabled: z.boolean().optional(),
        proxyProtocol: z.boolean().optional(),
        proxyProtocolVersion: z.int().min(1).optional(),
        // DNS Authority fields
        dnsAuthorityEnabled: z.boolean().optional(),
        dnsAuthorityTtl: z.int().min(1).max(86400).optional(),
        dnsAuthorityRoutingPolicy: z
            .enum(["failover", "roundrobin", "priority", "intelligent"])
            .optional(),
        resourcePolicyId: z.number().nullable().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    })
    .refine(
        (data) => {
            if (!config.getRawConfig().flags?.allow_raw_resources) {
                if (data.proxyPort !== undefined) {
                    return false;
                }
            }
            return true;
        },
        {
            error: "Cannot update proxyPort"
        }
    );

registry.registerPath({
    method: "post",
    path: "/resource/{resourceId}",
    description: "Update a resource.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: updateResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateHttpResourceBodySchema.and(
                        updateRawResourceBodySchema
                    )
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
                        data: z.unknown().nullable(),
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

export async function updateResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateResourceParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const [result] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .leftJoin(orgs, eq(resources.orgId, orgs.orgId));

        const resource = result.resources;
        const org = result.orgs;

        if (!resource || !org) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        if (["http", "ssh", "rdp", "vnc"].includes(resource.mode)) {
            // HANDLE UPDATING HTTP RESOURCES
            return await updateHttpResource(
                {
                    req,
                    res,
                    next
                },
                {
                    resource,
                    org
                }
            );
        } else {
            // HANDLE UPDATING RAW TCP/UDP RESOURCES
            return await updateRawResource(
                {
                    req,
                    res,
                    next
                },
                {
                    resource,
                    org
                }
            );
        }
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

async function updateHttpResource(
    route: {
        req: Request;
        res: Response;
        next: NextFunction;
    },
    meta: {
        resource: Resource;
        org: Org;
    }
) {
    const { next, req, res } = route;
    const { resource, org } = meta;

    const parsedBody = updateHttpResourceBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const updateData = parsedBody.data;

    const isLicensed = await isLicensedOrSubscribed(
        resource.orgId,
        tierMatrix.wildcardSubdomain
    );

    if (updateData.resourcePolicyId != null) {
        if (!isLicensed) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Resource policies are not supported on your current plan. Please upgrade to access this feature."
                )
            );
        }

        const [existingPolicy] = await db
            .select()
            .from(resourcePolicies)
            .where(
                eq(
                    resourcePolicies.resourcePolicyId,
                    updateData.resourcePolicyId
                )
            )
            .limit(1);

        if (!existingPolicy) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource policy with ID ${updateData.resourcePolicyId} not found`
                )
            );
        }
    }

    if (updateData.dnsAuthorityEnabled || updateData.dnsAuthorityRoutingPolicy) {
        const effectivePolicy =
            updateData.dnsAuthorityRoutingPolicy ||
            resource.dnsAuthorityRoutingPolicy ||
            "failover";

        if (isHealthDependentDNSRoutingPolicy(effectivePolicy)) {
            const hasHealthChecks = await resourceHasEnabledHealthChecks(
                resource.resourceId
            );

            if (!hasHealthChecks) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `dnsAuthorityRoutingPolicy '${effectivePolicy}' requires at least one enabled target health check for this resource. Use 'roundrobin' or enable health checks.`
                    )
                );
            }
        }
    }

    if (updateData.niceId) {
        const [existingResource] = await db
            .select()
            .from(resources)
            .where(
                and(
                    eq(resources.niceId, updateData.niceId),
                    eq(resources.orgId, resource.orgId),
                    ne(resources.resourceId, resource.resourceId) // exclude the current resource from the search
                )
            )
            .limit(1);

        if (existingResource) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `A resource with niceId "${updateData.niceId}" already exists`
                )
            );
        }
    }

    // Wildcard subdomains are a paid feature
    if (updateData.subdomain && updateData.subdomain.includes("*")) {
        if (!isLicensed) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Wildcard subdomains are not supported on your current plan. Please upgrade to access this feature."
                )
            );
        }
    }

    if (updateData.domainId) {
        const domainId = updateData.domainId;

        if (
            build == "saas" &&
            !isSubscribed(resource.orgId, tierMatrix.domainNamespaces)
        ) {
            // grandfather in existing users
            const lastAllowedDate = new Date("2026-04-13");
            const userCreatedDate = new Date(
                req.user?.dateCreated || new Date()
            );
            if (userCreatedDate > lastAllowedDate) {
                // check if this domain id is a namespace domain and if so, reject
                const domain = await db
                    .select()
                    .from(domainNamespaces)
                    .where(eq(domainNamespaces.domainId, domainId))
                    .limit(1);

                if (domain.length > 0) {
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Your current subscription does not support custom domain namespaces. Please upgrade to access this feature."
                        )
                    );
                }
            }
        }

        // Validate domain and construct full domain
        const domainResult = await validateAndConstructDomain(
            domainId,
            resource.orgId,
            updateData.subdomain
        );

        if (!domainResult.success) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, domainResult.error)
            );
        }

        const {
            fullDomain,
            subdomain: finalSubdomain,
            wildcard
        } = domainResult;

        logger.debug(`Full domain: ${fullDomain}`);

        if (fullDomain) {
            const [existingDomain] = await db
                .select()
                .from(resources)
                .where(eq(resources.fullDomain, fullDomain));

            if (
                existingDomain &&
                existingDomain.resourceId !== resource.resourceId
            ) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        "Resource with that domain already exists"
                    )
                );
            }

            const wildcardConflict = await checkWildcardDomainConflict(
                fullDomain,
                resource.resourceId
            );
            if (wildcardConflict.conflict) {
                return next(
                    createHttpError(HttpCode.CONFLICT, wildcardConflict.message)
                );
            }

            // Prevent updating resource with same domain as dashboard
            const dashboardUrl = config.getRawConfig().app.dashboard_url;
            if (dashboardUrl) {
                const dashboardHost = new URL(dashboardUrl).hostname;
                if (fullDomain === dashboardHost) {
                    return next(
                        createHttpError(
                            HttpCode.CONFLICT,
                            "Resource domain cannot be the same as the dashboard domain"
                        )
                    );
                }
            }

            if (build != "oss") {
                const existingLoginPages = await db
                    .select()
                    .from(loginPage)
                    .where(eq(loginPage.fullDomain, fullDomain));

                if (existingLoginPages.length > 0) {
                    return next(
                        createHttpError(
                            HttpCode.CONFLICT,
                            "Login page with that domain already exists"
                        )
                    );
                }
            }
        }

        // update the full domain if it has changed
        if (fullDomain && fullDomain !== resource.fullDomain) {
            await db
                .update(resources)
                .set({ fullDomain, wildcard })
                .where(eq(resources.resourceId, resource.resourceId));
        }

        // Update the subdomain in the update data
        updateData.subdomain = finalSubdomain;

        if (build != "oss") {
            await createCertificate(domainId, fullDomain, db);
        }
    }

    let headers = undefined;
    if (updateData.headers) {
        headers = JSON.stringify(updateData.headers);
    } else if (updateData.headers === null) {
        headers = null;
    }

    if (!isLicensed) {
        updateData.maintenanceModeEnabled = undefined;
        updateData.maintenanceModeType = undefined;
        updateData.maintenanceTitle = undefined;
        updateData.maintenanceMessage = undefined;
        updateData.maintenanceEstimatedTime = undefined;
    }

    const updatedResource = await db
        .update(resources)
        .set({ ...updateData, headers })
        .where(eq(resources.resourceId, resource.resourceId))
        .returning();

    if (updatedResource.length === 0) {
        return next(
            createHttpError(
                HttpCode.NOT_FOUND,
                `Resource with ID ${resource.resourceId} not found`
            )
        );
    }

    if (updatedResource[0].dnsAuthorityEnabled) {
        await updateDNSAuthorityForResource(updatedResource[0].resourceId);
        if (updatedResource[0].domainId) {
            await updateDNSAuthorityForDomain(updatedResource[0].domainId);
        }
        if (
            updatedResource[0].sso ||
            updatedResource[0].blockAccess ||
            updatedResource[0].emailWhitelistEnabled
        ) {
            await updateAuthProxyForResource(updatedResource[0].resourceId);
        }
    }

    return response(res, {
        data: updatedResource[0],
        success: true,
        error: false,
        message: "HTTP resource updated successfully",
        status: HttpCode.OK
    });
}

async function updateRawResource(
    route: {
        req: Request;
        res: Response;
        next: NextFunction;
    },
    meta: {
        resource: Resource;
        org: Org;
    }
) {
    const { next, req, res } = route;
    const { resource } = meta;

    const parsedBody = updateRawResourceBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const updateData = parsedBody.data;
    let updatedResource: Resource | null = null;

    if (updateData.dnsAuthorityEnabled || updateData.dnsAuthorityRoutingPolicy) {
        const effectivePolicy =
            updateData.dnsAuthorityRoutingPolicy ||
            resource.dnsAuthorityRoutingPolicy ||
            "failover";

        if (isHealthDependentDNSRoutingPolicy(effectivePolicy)) {
            const hasHealthChecks = await resourceHasEnabledHealthChecks(
                resource.resourceId
            );

            if (!hasHealthChecks) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        `dnsAuthorityRoutingPolicy '${effectivePolicy}' requires at least one enabled target health check for this resource. Use 'roundrobin' or enable health checks.`
                    )
                );
            }
        }
    }

    const [existingResource] = await db
        .select()
        .from(resources)
        .where(eq(resources.resourceId, resource.resourceId))
        .limit(1);

    await db.transaction(async (trx) => {
        if (updateData.resourcePolicyId != null) {
            const [existingPolicy] = await trx
                .select()
                .from(resourcePolicies)
                .where(
                    eq(
                        resourcePolicies.resourcePolicyId,
                        updateData.resourcePolicyId
                    )
                )
                .limit(1);

            if (!existingPolicy) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource policy with ID ${updateData.resourcePolicyId} not found`
                    )
                );
            }
        } else {
            // we are in an inline policy and we need to clear out the old tables
            await Promise.all([
                trx
                    .delete(resourcePassword)
                    .where(
                        eq(
                            resourcePassword.resourceId,
                            existingResource.resourceId
                        )
                    ),
                trx
                    .delete(resourcePincode)
                    .where(
                        eq(
                            resourcePincode.resourceId,
                            existingResource.resourceId
                        )
                    ),
                trx
                    .delete(resourceHeaderAuth)
                    .where(
                        eq(
                            resourceHeaderAuth.resourceId,
                            existingResource.resourceId
                        )
                    ),
                trx
                    .delete(resourceHeaderAuthExtendedCompatibility)
                    .where(
                        eq(
                            resourceHeaderAuthExtendedCompatibility.resourceId,
                            existingResource.resourceId
                        )
                    ),
                trx
                    .delete(resourceWhitelist)
                    .where(
                        eq(
                            resourceWhitelist.resourceId,
                            existingResource.resourceId
                        )
                    ),

                trx
                    .delete(resourceRules)
                    .where(
                        eq(
                            resourceRules.resourceId,
                            existingResource.resourceId
                        )
                    )
            ]);
        }

        if (updateData.niceId) {
            const [existingResourceConflict] = await trx
                .select()
                .from(resources)
                .where(
                    and(
                        eq(resources.niceId, updateData.niceId),
                        eq(resources.orgId, resource.orgId)
                    )
                );

            if (
                existingResourceConflict &&
                existingResourceConflict.resourceId !== resource.resourceId
            ) {
                return next(
                    createHttpError(
                        HttpCode.CONFLICT,
                        `A resource with niceId "${updateData.niceId}" already exists`
                    )
                );
            }
        }

        [updatedResource] = await trx
            .update(resources)
            .set(updateData)
            .where(eq(resources.resourceId, resource.resourceId))
            .returning();
    });

    const finalResource = updatedResource as unknown as Resource | null;

    if (!finalResource) {
        return next(
            createHttpError(
                HttpCode.NOT_FOUND,
                `Resource with ID ${resource.resourceId} not found`
            )
        );
    }

    if (finalResource.dnsAuthorityEnabled) {
        await updateDNSAuthorityForResource(finalResource.resourceId);
        if (finalResource.domainId) {
            await updateDNSAuthorityForDomain(finalResource.domainId);
        }
        if (
            finalResource.sso ||
            finalResource.blockAccess ||
            finalResource.emailWhitelistEnabled
        ) {
            await updateAuthProxyForResource(finalResource.resourceId);
        }
    }

    return response(res, {
        data: finalResource,
        success: true,
        error: false,
        message: "Non-http Resource updated successfully",
        status: HttpCode.OK
    });
}
