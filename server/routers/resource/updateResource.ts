import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, loginPage } from "@server/db";
import {
    domains,
    newts,
    Org,
    orgDomains,
    orgs,
    Resource,
    resources,
    sites,
    targets
} from "@server/db";
import { eq, and, ne } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import config from "@server/lib/config";
import { tlsNameSchema } from "@server/lib/schemas";
import { subdomainSchema } from "@server/lib/schemas";
import { registry } from "@server/openApi";
import { OpenAPITags } from "@server/openApi";
import { createCertificate } from "#dynamic/routers/certificates/createCertificate";
import { validateAndConstructDomain } from "@server/lib/domainUtils";
import { build } from "@server/build";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { sendNewtSyncMessage } from "../newt/sync";

const updateResourceParamsSchema = z.strictObject({
    resourceId: z.string().transform(Number).pipe(z.int().positive())
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
        subdomain: subdomainSchema.nullable().optional(),
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
        postAuthPath: z.string().nullable().optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
        error: "At least one field must be provided for update"
    })
    .refine(
        (data) => {
            if (data.subdomain) {
                return subdomainSchema.safeParse(data.subdomain).success;
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
                return data.headers.every((h) => validHeaderValue.test(h.value));
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
        proxyProtocolVersion: z.int().min(1).optional()
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
    responses: {}
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

        if (resource.http) {
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

async function syncNewtsForResource(resourceId: number) {
    const siteNewtPairs = await db
        .select({
            site: sites,
            newt: newts
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .innerJoin(newts, eq(newts.siteId, sites.siteId))
        .where(and(eq(targets.resourceId, resourceId), eq(sites.type, "newt")));

    const uniqueNewts = new Map<string, (typeof siteNewtPairs)[number]>();
    for (const pair of siteNewtPairs) {
        uniqueNewts.set(pair.newt.newtId, pair);
    }

    await Promise.all(
        Array.from(uniqueNewts.values()).map(async ({ newt, site }) => {
            try {
                await sendNewtSyncMessage(newt, site);
            } catch (error) {
                logger.warn(
                    `Failed to sync newt ${newt.newtId} after resource update`,
                    error
                );
            }
        })
    );
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

    if (updateData.domainId) {
        const domainId = updateData.domainId;

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

        const { fullDomain, subdomain: finalSubdomain } = domainResult;

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
                .set({ fullDomain })
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

    const isLicensed = await isLicensedOrSubscribed(
        resource.orgId,
        tierMatrix.maintencePage
    );
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

    if (
        typeof updateData.enabled === "boolean" &&
        updateData.enabled !== resource.enabled
    ) {
        await syncNewtsForResource(resource.resourceId);
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

    if (updateData.niceId) {
        const [existingResource] = await db
            .select()
            .from(resources)
            .where(
                and(
                    eq(resources.niceId, updateData.niceId),
                    eq(resources.orgId, resource.orgId)
                )
            );

        if (
            existingResource &&
            existingResource.resourceId !== resource.resourceId
        ) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `A resource with niceId "${updateData.niceId}" already exists`
                )
            );
        }
    }

    const updatedResource = await db
        .update(resources)
        .set(updateData)
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

    if (
        typeof updateData.enabled === "boolean" &&
        updateData.enabled !== resource.enabled
    ) {
        await syncNewtsForResource(resource.resourceId);
    }

    return response(res, {
        data: updatedResource[0],
        success: true,
        error: false,
        message: "Non-http Resource updated successfully",
        status: HttpCode.OK
    });
}
