import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { build } from "@server/build";
import {
    db,
    loginPage,
    orgs,
    Resource,
    resources,
    resourcePolicies,
    roleResources,
    rolePolicies,
    roles,
    userPolicies,
    userResources,
    domainNamespaces
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, and } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { subdomainSchema, wildcardSubdomainSchema } from "@server/lib/schemas";
import config from "@server/lib/config";
import { OpenAPITags, registry } from "@server/openApi";
import { createCertificate } from "#dynamic/routers/certificates/createCertificate";
import {
    validateAndConstructDomain,
    checkWildcardDomainConflict
} from "@server/lib/domainUtils";
import { isSubscribed } from "#dynamic/lib/isSubscribed";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    getUniqueResourceName,
    getUniqueResourcePolicyName
} from "@server/db/names";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";

const createResourceParamsSchema = z.strictObject({
    orgId: z.string()
});

function resolveModeFromLegacyFields(data: {
    mode?: "http" | "ssh" | "rdp" | "vnc" | "tcp" | "udp";
    http?: boolean;
    protocol?: "tcp" | "udp";
}): {
    mode?: "http" | "ssh" | "rdp" | "vnc" | "tcp" | "udp";
    error?: string;
} {
    if (data.mode) {
        return { mode: data.mode };
    }

    if (typeof data.http === "boolean" && data.protocol) {
        if (data.http && data.protocol === "tcp") {
            return { mode: "http" };
        }
        if (!data.http && data.protocol === "tcp") {
            return { mode: "tcp" };
        }
        if (!data.http && data.protocol === "udp") {
            return { mode: "udp" };
        }
        return {
            error: "Invalid deprecated http/protocol combination"
        };
    }

    return { mode: undefined };
}

const createHttpResourceSchema = z
    .strictObject({
        name: z.string().min(1).max(255),
        subdomain: z.string().nullable().optional(),
        http: z.boolean().optional().openapi({
            deprecated: true,
            description:
                "Deprecated. Use `mode` instead. Legacy compatibility only."
        }),
        protocol: z.enum(["tcp", "udp"]).optional().openapi({
            deprecated: true,
            description:
                "Deprecated. Use `mode` instead. Legacy compatibility only."
        }),
        domainId: z.string(),
        stickySession: z.boolean().optional(),
        postAuthPath: z.string().nullable().optional(),
        mode: z.enum(["http", "ssh", "rdp", "vnc", "tcp", "udp"]).optional(),
        // SSH Settings
        pamMode: z.enum(["passthrough", "push"]).optional(),
        authDaemonPort: z.int().positive().optional(),
        authDaemonMode: z.enum(["site", "remote", "native"]).optional()
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
    );

const createRawResourceSchema = z
    .strictObject({
        name: z.string().min(1).max(255),
        http: z.boolean().optional().openapi({
            deprecated: true,
            description:
                "Deprecated. Use `mode` instead. Legacy compatibility only."
        }),
        protocol: z.enum(["tcp", "udp"]).optional().openapi({
            deprecated: true,
            description:
                "Deprecated. Use `mode` instead. Legacy compatibility only."
        }),
        mode: z.enum(["tcp", "udp"]).optional(),
        proxyPort: z.int().min(1).max(65535)
        // enableProxy: z.boolean().default(true) // always true now
    })
    .refine(
        (data) => {
            const resolved = resolveModeFromLegacyFields(data);
            if (resolved.error || !resolved.mode) {
                return false;
            }

            if (!config.getRawConfig().flags?.allow_raw_resources) {
                if (data.proxyPort !== undefined) {
                    return false;
                }
            }
            return true;
        },
        {
            error: "Raw resources are not allowed"
        }
    );

export type CreateResourceResponse = Resource;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/resource",
    description: "Create a resource.",
    tags: [OpenAPITags.PublicResource],
    request: {
        params: createResourceParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createHttpResourceSchema.or(createRawResourceSchema)
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

export async function createResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        // Validate request params
        const parsedParams = createResourceParamsSchema.safeParse(req.params);
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

        // get the org
        const org = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        if (org.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Organization with ID ${orgId} not found`
                )
            );
        }

        const resolvedMode = resolveModeFromLegacyFields(req.body);
        if (resolvedMode.error) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, resolvedMode.error)
            );
        }

        if (resolvedMode.mode) {
            req.body.mode = resolvedMode.mode;
        }

        if (build == "saas") {
            const usage = await usageService.getUsage(
                orgId,
                LimitId.PUBLIC_RESOURCES
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

                LimitId.PUBLIC_RESOURCES,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectResource) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Public resource limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        if (typeof req.body.proxyPort === "number") {
            if (
                !config.getRawConfig().flags?.allow_raw_resources &&
                build == "oss"
            ) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Raw resources are not allowed"
                    )
                );
            }
            return await createRawResource({ req, res, next }, { orgId });
        }

        if (req.body.mode) {
            return await createHttpResource({ req, res, next }, { orgId });
        } else {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "mode is required when deprecated fields are not provided"
                )
            );
        }
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

async function createHttpResource(
    route: {
        req: Request;
        res: Response;
        next: NextFunction;
    },
    meta: {
        orgId: string;
    }
) {
    const { req, res, next } = route;
    const { orgId } = meta;

    const parsedBody = createHttpResourceSchema.safeParse(req.body);
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
        domainId,
        postAuthPath,
        mode,
        authDaemonPort,
        authDaemonMode,
        pamMode
    } = parsedBody.data;
    const subdomain = parsedBody.data.subdomain;
    const stickySession = parsedBody.data.stickySession;

    // Wildcard subdomains are a paid feature
    if (subdomain && subdomain.includes("*")) {
        const isLicensed = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.wildcardSubdomain
        );
        if (!isLicensed) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Wildcard subdomains are not supported on your current plan. Please upgrade to access this feature."
                )
            );
        }
    }

    if (build == "saas" && !isSubscribed(orgId!, tierMatrix.domainNamespaces)) {
        // grandfather in existing users
        const lastAllowedDate = new Date("2026-04-13");
        const userCreatedDate = new Date(req.user?.dateCreated || new Date());
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

    if (
        ["ssh", "rdp", "vnc"].includes(mode!) &&
        !isLicensedOrSubscribed(
            orgId!,
            tierMatrix[TierFeature.AdvancedPublicResources]
        )
    ) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Your current subscription does not support browser gateway resources. Please upgrade to access this feature."
            )
        );
    }

    // Validate domain and construct full domain
    const domainResult = await validateAndConstructDomain(
        domainId,
        orgId,
        subdomain
    );

    if (!domainResult.success) {
        return next(createHttpError(HttpCode.BAD_REQUEST, domainResult.error));
    }

    const { fullDomain, subdomain: finalSubdomain, wildcard } = domainResult;

    logger.debug(`Full domain: ${fullDomain}`);

    // make sure the full domain is unique
    const existingResource = await db
        .select()
        .from(resources)
        .where(eq(resources.fullDomain, fullDomain));

    if (existingResource.length > 0) {
        return next(
            createHttpError(
                HttpCode.CONFLICT,
                "Resource with that domain already exists"
            )
        );
    }

    const wildcardConflict = await checkWildcardDomainConflict(fullDomain);
    if (wildcardConflict.conflict) {
        return next(
            createHttpError(HttpCode.CONFLICT, wildcardConflict.message)
        );
    }

    // Prevent creating resource with same domain as dashboard
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

    let resource: Resource | undefined;

    const niceId = await getUniqueResourceName(orgId);
    const policyNiceId = await getUniqueResourcePolicyName(orgId);

    await db.transaction(async (trx) => {
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

        const [defaultPolicy] = await trx
            .insert(resourcePolicies)
            .values({
                niceId: policyNiceId,
                orgId,
                name: `default policy for ${niceId}`,
                sso: true,
                scope: "resource"
            })
            .returning();

        // make this policy visible by the admin role
        await trx.insert(rolePolicies).values({
            roleId: adminRole[0].roleId,
            resourcePolicyId: defaultPolicy.resourcePolicyId
        });

        // make this policy visible by the current user
        if (req.user && !req.userOrgRoleIds?.includes(adminRole[0].roleId)) {
            await trx.insert(userPolicies).values({
                userId: req.user?.userId!,
                resourcePolicyId: defaultPolicy.resourcePolicyId
            });
        }

        const newResource = await trx
            .insert(resources)
            .values({
                niceId,
                fullDomain,
                domainId,
                orgId,
                name,
                subdomain: finalSubdomain,
                mode: mode,
                pamMode: pamMode,
                authDaemonMode: authDaemonMode,
                authDaemonPort: authDaemonPort,
                ssl: true,
                stickySession: stickySession,
                postAuthPath: postAuthPath,
                wildcard,
                health: "unknown",
                defaultResourcePolicyId: defaultPolicy.resourcePolicyId
            })
            .returning();

        await trx.insert(roleResources).values({
            roleId: adminRole[0].roleId,
            resourceId: newResource[0].resourceId
        });

        if (req.user && !req.userOrgRoleIds?.includes(adminRole[0].roleId)) {
            // make sure the user can access the resource
            await trx.insert(userResources).values({
                userId: req.user?.userId!,
                resourceId: newResource[0].resourceId
            });
        }

        resource = newResource[0];

        await usageService.add(orgId, LimitId.PUBLIC_RESOURCES, 1, trx);
    });

    if (!resource) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create resource"
            )
        );
    }

    if (build !== "oss") {
        await createCertificate(domainId, fullDomain, db);
    }

    return response<CreateResourceResponse>(res, {
        data: resource,
        success: true,
        error: false,
        message: "Http resource created successfully",
        status: HttpCode.CREATED
    });
}

async function createRawResource(
    route: {
        req: Request;
        res: Response;
        next: NextFunction;
    },
    meta: {
        orgId: string;
    }
) {
    const { req, res, next } = route;
    const { orgId } = meta;

    const parsedBody = createRawResourceSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { name, proxyPort } = parsedBody.data;
    const resolvedMode = resolveModeFromLegacyFields(parsedBody.data);
    if (resolvedMode.error || !resolvedMode.mode) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                resolvedMode.error ||
                    "mode is required when deprecated fields are not provided"
            )
        );
    }

    let resource: Resource | undefined;

    const niceId = await getUniqueResourceName(orgId);
    const policyNiceId = await getUniqueResourcePolicyName(orgId);

    await db.transaction(async (trx) => {
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

        const [defaultPolicy] = await trx
            .insert(resourcePolicies)
            .values({
                niceId: policyNiceId,
                orgId,
                name: `default policy for ${niceId}`,
                sso: true,
                scope: "resource"
            })
            .returning();

        // make this policy visible by the admin role
        await trx.insert(rolePolicies).values({
            roleId: adminRole[0].roleId,
            resourcePolicyId: defaultPolicy.resourcePolicyId
        });

        // make this policy visible by the current user
        if (req.user && !req.userOrgRoleIds?.includes(adminRole[0].roleId)) {
            await trx.insert(userPolicies).values({
                userId: req.user?.userId!,
                resourcePolicyId: defaultPolicy.resourcePolicyId
            });
        }

        const newResource = await trx
            .insert(resources)
            .values({
                niceId,
                orgId,
                name,
                mode: resolvedMode.mode,
                proxyPort,
                defaultResourcePolicyId: defaultPolicy.resourcePolicyId
            })
            .returning();

        await trx.insert(roleResources).values({
            roleId: adminRole[0].roleId,
            resourceId: newResource[0].resourceId
        });

        if (req.user && !req.userOrgRoleIds?.includes(adminRole[0].roleId)) {
            // make sure the user can access the resource
            await trx.insert(userResources).values({
                userId: req.user?.userId!,
                resourceId: newResource[0].resourceId
            });
        }

        resource = newResource[0];

        await usageService.add(orgId, LimitId.PUBLIC_RESOURCES, 1, trx);
    });

    if (!resource) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create resource"
            )
        );
    }

    return response<CreateResourceResponse>(res, {
        data: resource,
        success: true,
        error: false,
        message: "Non-http resource created successfully",
        status: HttpCode.CREATED
    });
}
