import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, loginPage } from "@server/db";
import {
    domains,
    orgDomains,
    orgs,
    Resource,
    resources,
    roleResources,
    roles,
    userResources
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, and } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { subdomainSchema, tlsNameSchema } from "@server/lib/schemas";
import config from "@server/lib/config";
import { OpenAPITags, registry } from "@server/openApi";
import { build } from "@server/build";
import { createCertificate } from "#dynamic/routers/certificates/createCertificate";
import { getUniqueResourceName } from "@server/db/names";
import { validateAndConstructDomain } from "@server/lib/domainUtils";

const createResourceParamsSchema = z.strictObject({
    orgId: z.string()
});

const createHttpResourceSchema = z
    .strictObject({
        name: z.string().min(1).max(255),
        subdomain: z.string().nullable().optional(),
        http: z.boolean(),
        protocol: z.enum(["tcp", "udp"]),
        domainId: z.string(),
        stickySession: z.boolean().optional(),
        postAuthPath: z.string().nullable().optional(),
        redirectDomains: z.array(tlsNameSchema).max(100).nullable().optional()
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
    );

const createRawResourceSchema = z
    .strictObject({
        name: z.string().min(1).max(255),
        http: z.boolean(),
        protocol: z.enum(["tcp", "udp"]),
        proxyPort: z.int().min(1).max(65535)
        // enableProxy: z.boolean().default(true) // always true now
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
            error: "Raw resources are not allowed"
        }
    );

export type CreateResourceResponse = Resource;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/resource",
    description: "Create a resource.",
    tags: [OpenAPITags.Org, OpenAPITags.Resource],
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
    responses: {}
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

        if (req.user && !req.userOrgRoleId) {
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

        if (typeof req.body.http !== "boolean") {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "http field is required")
            );
        }

        const { http } = req.body;

        if (http) {
            return await createHttpResource({ req, res, next }, { orgId });
        } else {
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

    const { name, domainId, postAuthPath } = parsedBody.data;
    const subdomain = parsedBody.data.subdomain;
    const stickySession = parsedBody.data.stickySession;
    const redirectDomains = parsedBody.data.redirectDomains;

    // Validate domain and construct full domain
    const domainResult = await validateAndConstructDomain(
        domainId,
        orgId,
        subdomain
    );

    if (!domainResult.success) {
        return next(createHttpError(HttpCode.BAD_REQUEST, domainResult.error));
    }

    const { fullDomain, subdomain: finalSubdomain } = domainResult;

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

    const normalizedRedirectDomains = redirectDomains
        ? Array.from(
              new Set(
                  redirectDomains
                      .map((domain) => domain.trim().toLowerCase())
                      .filter((domain) => domain.length > 0)
              )
          ).filter((domain) => domain !== fullDomain.toLowerCase())
        : [];

    let resource: Resource | undefined;

    const niceId = await getUniqueResourceName(orgId);

    await db.transaction(async (trx) => {
        const newResource = await trx
            .insert(resources)
            .values({
                niceId,
                fullDomain,
                domainId,
                orgId,
                name,
                subdomain: finalSubdomain,
                http: true,
                protocol: "tcp",
                ssl: true,
                stickySession: stickySession,
                postAuthPath: postAuthPath,
                redirectDomains:
                    normalizedRedirectDomains.length > 0
                        ? JSON.stringify(normalizedRedirectDomains)
                        : null
            })
            .returning();

        const adminRole = await db
            .select()
            .from(roles)
            .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
            .limit(1);

        if (adminRole.length === 0) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, `Admin role not found`)
            );
        }

        await trx.insert(roleResources).values({
            roleId: adminRole[0].roleId,
            resourceId: newResource[0].resourceId
        });

        if (req.user && req.userOrgRoleId != adminRole[0].roleId) {
            // make sure the user can access the resource
            await trx.insert(userResources).values({
                userId: req.user?.userId!,
                resourceId: newResource[0].resourceId
            });
        }

        resource = newResource[0];
    });

    if (!resource) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create resource"
            )
        );
    }

    if (build != "oss") {
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

    const { name, http, protocol, proxyPort } = parsedBody.data;

    let resource: Resource | undefined;

    const niceId = await getUniqueResourceName(orgId);

    await db.transaction(async (trx) => {
        const newResource = await trx
            .insert(resources)
            .values({
                niceId,
                orgId,
                name,
                http,
                protocol,
                proxyPort
                // enableProxy
            })
            .returning();

        const adminRole = await db
            .select()
            .from(roles)
            .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
            .limit(1);

        if (adminRole.length === 0) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, `Admin role not found`)
            );
        }

        await trx.insert(roleResources).values({
            roleId: adminRole[0].roleId,
            resourceId: newResource[0].resourceId
        });

        if (req.user && req.userOrgRoleId != adminRole[0].roleId) {
            // make sure the user can access the resource
            await trx.insert(userResources).values({
                userId: req.user?.userId!,
                resourceId: newResource[0].resourceId
            });
        }

        resource = newResource[0];
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
