/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { verifySessionRemoteExitNodeMiddleware } from "#private/middlewares/verifyRemoteExitNode";
import { Router } from "express";
import {
    db,
    exitNodes,
    Resource,
    ResourcePassword,
    ResourcePincode,
    Session,
    User,
    certificates,
    exitNodeOrgs,
    RemoteExitNode,
    olms,
    newts,
    clients,
    sites,
    domains,
    orgDomains,
    targets,
    loginPage,
    loginPageOrg,
    LoginPage,
    resourceHeaderAuth,
    ResourceHeaderAuth,
    orgs,
    requestAuditLog
} from "@server/db";
import {
    resources,
    resourcePincode,
    resourcePassword,
    sessions,
    users,
    userOrgs,
    roleResources,
    userResources,
    resourceRules
} from "@server/db";
import { eq, and, inArray, isNotNull, ne } from "drizzle-orm";
import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { getTraefikConfig } from "#private/lib/traefik";
import {
    generateGerbilConfig,
    generateRelayMappings,
    updateAndGenerateEndpointDestinations,
    updateSiteBandwidth
} from "@server/routers/gerbil";
import * as gerbil from "@server/routers/gerbil";
import logger from "@server/logger";
import { decryptData } from "@server/lib/encryption";
import config from "@server/lib/config";
import privateConfig from "#private/lib/config";
import * as fs from "fs";
import { exchangeSession } from "@server/routers/badger";
import { validateResourceSessionToken } from "@server/auth/sessions/resource";
import { checkExitNodeOrg, resolveExitNodes } from "#private/lib/exitNodes";
import { maxmindLookup } from "@server/db/maxmind";
import { verifyResourceAccessToken } from "@server/auth/verifyResourceAccessToken";
import semver from "semver";

// Zod schemas for request validation
const getResourceByDomainParamsSchema = z
    .object({
        domain: z.string().min(1, "Domain is required")
    })
    .strict();

const getUserSessionParamsSchema = z
    .object({
        userSessionId: z.string().min(1, "User session ID is required")
    })
    .strict();

const getUserOrgRoleParamsSchema = z
    .object({
        userId: z.string().min(1, "User ID is required"),
        orgId: z.string().min(1, "Organization ID is required")
    })
    .strict();

const getRoleResourceAccessParamsSchema = z
    .object({
        roleId: z
            .string()
            .transform(Number)
            .pipe(
                z.number().int().positive("Role ID must be a positive integer")
            ),
        resourceId: z
            .string()
            .transform(Number)
            .pipe(
                z
                    .number()
                    .int()
                    .positive("Resource ID must be a positive integer")
            )
    })
    .strict();

const getUserResourceAccessParamsSchema = z
    .object({
        userId: z.string().min(1, "User ID is required"),
        resourceId: z
            .string()
            .transform(Number)
            .pipe(
                z
                    .number()
                    .int()
                    .positive("Resource ID must be a positive integer")
            )
    })
    .strict();

const getResourceRulesParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(
                z
                    .number()
                    .int()
                    .positive("Resource ID must be a positive integer")
            )
    })
    .strict();

const validateResourceSessionTokenParamsSchema = z
    .object({
        resourceId: z
            .string()
            .transform(Number)
            .pipe(
                z
                    .number()
                    .int()
                    .positive("Resource ID must be a positive integer")
            )
    })
    .strict();

const validateResourceSessionTokenBodySchema = z
    .object({
        token: z.string().min(1, "Token is required")
    })
    .strict();

const validateResourceAccessTokenBodySchema = z
    .object({
        accessTokenId: z.string().optional(),
        resourceId: z.number().optional(),
        accessToken: z.string()
    })
    .strict();

// Certificates by domains query validation
const getCertificatesByDomainsQuerySchema = z
    .object({
        // Accept domains as string or array (domains or domains[])
        domains: z
            .union([z.array(z.string().min(1)), z.string().min(1)])
            .optional(),
        // Handle array format from query parameters (domains[])
        "domains[]": z
            .union([z.array(z.string().min(1)), z.string().min(1)])
            .optional()
    })
    .strict();

// Type exports for request schemas
export type GetResourceByDomainParams = z.infer<
    typeof getResourceByDomainParamsSchema
>;
export type GetUserSessionParams = z.infer<typeof getUserSessionParamsSchema>;
export type GetUserOrgRoleParams = z.infer<typeof getUserOrgRoleParamsSchema>;
export type GetRoleResourceAccessParams = z.infer<
    typeof getRoleResourceAccessParamsSchema
>;
export type GetUserResourceAccessParams = z.infer<
    typeof getUserResourceAccessParamsSchema
>;
export type GetResourceRulesParams = z.infer<
    typeof getResourceRulesParamsSchema
>;
export type ValidateResourceSessionTokenParams = z.infer<
    typeof validateResourceSessionTokenParamsSchema
>;
export type ValidateResourceSessionTokenBody = z.infer<
    typeof validateResourceSessionTokenBodySchema
>;

// Type definitions for API responses
export type ResourceWithAuth = {
    resource: Resource | null;
    pincode: ResourcePincode | null;
    password: ResourcePassword | null;
    headerAuth: ResourceHeaderAuth | null;
};

export type UserSessionWithUser = {
    session: Session | null;
    user: User | null;
};

// Root routes
export const hybridRouter = Router();
hybridRouter.use(verifySessionRemoteExitNodeMiddleware);

// TODO: ADD RATE LIMITING TO THESE ROUTES AS NEEDED BASED ON USAGE PATTERNS

hybridRouter.get(
    "/general-config",
    async (req: Request, res: Response, next: NextFunction) => {
        return response(res, {
            data: {
                resource_session_request_param:
                    config.getRawConfig().server.resource_session_request_param,
                resource_access_token_headers:
                    config.getRawConfig().server.resource_access_token_headers,
                resource_access_token_param:
                    config.getRawConfig().server.resource_access_token_param,
                session_cookie_name:
                    config.getRawConfig().server.session_cookie_name,
                require_email_verification:
                    config.getRawConfig().flags?.require_email_verification ||
                    false,
                resource_session_length_hours:
                    config.getRawConfig().server.resource_session_length_hours
            },
            success: true,
            error: false,
            message: "General config retrieved successfully",
            status: HttpCode.OK
        });
    }
);

hybridRouter.get(
    "/traefik-config",
    async (req: Request, res: Response, next: NextFunction) => {
        const remoteExitNode = req.remoteExitNode;

        if (!remoteExitNode || !remoteExitNode.exitNodeId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Remote exit node not found"
                )
            );
        }

        try {
            const traefikConfig = await getTraefikConfig(
                remoteExitNode.exitNodeId,
                ["newt", "local", "wireguard"], // Allow them to use all the site types
                true, // But don't allow domain namespace resources
                false, // Dont include login pages,
                true // allow raw resources
            );

            return response(res, {
                data: traefikConfig,
                success: true,
                error: false,
                message: "Traefik config retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get Traefik config"
                )
            );
        }
    }
);

let encryptionKeyPath = "";
let encryptionKeyHex = "";
let encryptionKey: Buffer;
function loadEncryptData() {
    if (encryptionKey) {
        return; // already loaded
    }

    encryptionKeyPath =
        privateConfig.getRawPrivateConfig().server.encryption_key_path;

    if (!fs.existsSync(encryptionKeyPath)) {
        throw new Error(
            "Encryption key file not found. Please generate one first."
        );
    }

    encryptionKeyHex = fs.readFileSync(encryptionKeyPath, "utf8").trim();
    encryptionKey = Buffer.from(encryptionKeyHex, "hex");
}

// Get valid certificates for given domains (supports wildcard certs)
hybridRouter.get(
    "/certificates/domains",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            loadEncryptData(); // Ensure encryption key is loaded

            const parsed = getCertificatesByDomainsQuerySchema.safeParse(
                req.query
            );
            if (!parsed.success) {
                logger.info("Invalid query parameters:", parsed.error);
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsed.error).toString()
                    )
                );
            }

            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                logger.error("Remote exit node not found");
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            // Normalize domains into a unique array
            const rawDomains = parsed.data.domains;
            const rawDomainsArray = parsed.data["domains[]"];

            // Combine both possible sources
            const allRawDomains = [
                ...(Array.isArray(rawDomains)
                    ? rawDomains
                    : rawDomains
                      ? [rawDomains]
                      : []),
                ...(Array.isArray(rawDomainsArray)
                    ? rawDomainsArray
                    : rawDomainsArray
                      ? [rawDomainsArray]
                      : [])
            ];

            const uniqueDomains = Array.from(
                new Set(
                    allRawDomains
                        .map((d) => (typeof d === "string" ? d.trim() : ""))
                        .filter((d) => d.length > 0)
                )
            );

            if (uniqueDomains.length === 0) {
                return response(res, {
                    data: [],
                    success: true,
                    error: false,
                    message: "No domains provided",
                    status: HttpCode.OK
                });
            }

            // Build candidate domain list: exact + first-suffix for wildcard lookup
            const suffixes = uniqueDomains
                .map((domain) => {
                    const firstDot = domain.indexOf(".");
                    return firstDot > 0 ? domain.slice(firstDot + 1) : null;
                })
                .filter((d): d is string => !!d);

            const candidateDomains = Array.from(
                new Set([...uniqueDomains, ...suffixes])
            );

            // Query certificates with domain and org information to check authorization
            const certRows = await db
                .select({
                    id: certificates.certId,
                    domain: certificates.domain,
                    certFile: certificates.certFile,
                    keyFile: certificates.keyFile,
                    expiresAt: certificates.expiresAt,
                    updatedAt: certificates.updatedAt,
                    wildcard: certificates.wildcard,
                    domainId: certificates.domainId,
                    orgId: orgDomains.orgId
                })
                .from(certificates)
                .leftJoin(domains, eq(domains.domainId, certificates.domainId))
                .leftJoin(orgDomains, eq(orgDomains.domainId, domains.domainId))
                .where(
                    and(
                        eq(certificates.status, "valid"),
                        isNotNull(certificates.certFile),
                        isNotNull(certificates.keyFile),
                        inArray(certificates.domain, candidateDomains)
                    )
                );

            // Filter certificates based on wildcard matching and exit node authorization
            const filtered = [];
            for (const cert of certRows) {
                // Check if the domain matches our request
                const domainMatches =
                    uniqueDomains.includes(cert.domain) ||
                    (cert.wildcard === true &&
                        uniqueDomains.some((d) =>
                            d.endsWith(`.${cert.domain}`)
                        ));

                if (!domainMatches) {
                    continue;
                }

                // Check if the exit node has access to the org that owns this domain
                if (cert.orgId) {
                    const hasAccess = await checkExitNodeOrg(
                        remoteExitNode.exitNodeId,
                        cert.orgId
                    );
                    if (hasAccess) {
                        // checkExitNodeOrg returns true when access is denied
                        continue;
                    }
                }

                filtered.push(cert);
            }

            const result = filtered.map((cert) => {
                // Decrypt and save certificate file
                const decryptedCert = decryptData(
                    cert.certFile!, // is not null from query
                    encryptionKey
                );

                // Decrypt and save key file
                const decryptedKey = decryptData(cert.keyFile!, encryptionKey);

                // Return only the certificate data without org information
                return {
                    id: cert.id,
                    domain: cert.domain,
                    certFile: decryptedCert,
                    keyFile: decryptedKey,
                    expiresAt: cert.expiresAt,
                    updatedAt: cert.updatedAt,
                    wildcard: cert.wildcard
                };
            });

            return response(res, {
                data: result,
                success: true,
                error: false,
                message: "Certificates retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get certificates for domains"
                )
            );
        }
    }
);

// Get resource by domain with pincode and password information
hybridRouter.get(
    "/resource/domain/:domain",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getResourceByDomainParamsSchema.safeParse(
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

            const { domain } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode?.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [result] = await db
                .select()
                .from(resources)
                .leftJoin(
                    resourcePincode,
                    eq(resourcePincode.resourceId, resources.resourceId)
                )
                .leftJoin(
                    resourcePassword,
                    eq(resourcePassword.resourceId, resources.resourceId)
                )
                .leftJoin(
                    resourceHeaderAuth,
                    eq(resourceHeaderAuth.resourceId, resources.resourceId)
                )
                .where(eq(resources.fullDomain, domain))
                .limit(1);

            if (
                await checkExitNodeOrg(
                    remoteExitNode.exitNodeId,
                    result.resources.orgId
                )
            ) {
                // If the exit node is not allowed for the org, return an error
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Exit node not allowed for this organization"
                    )
                );
            }

            if (!result) {
                return response<ResourceWithAuth | null>(res, {
                    data: null,
                    success: true,
                    error: false,
                    message: "Resource not found",
                    status: HttpCode.OK
                });
            }

            const resourceWithAuth: ResourceWithAuth = {
                resource: result.resources,
                pincode: result.resourcePincode,
                password: result.resourcePassword,
                headerAuth: result.resourceHeaderAuth
            };

            return response<ResourceWithAuth>(res, {
                data: resourceWithAuth,
                success: true,
                error: false,
                message: "Resource retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get resource by domain"
                )
            );
        }
    }
);

const getOrgLoginPageParamsSchema = z
    .object({
        orgId: z.string().min(1)
    })
    .strict();

hybridRouter.get(
    "/org/:orgId/login-page",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getOrgLoginPageParamsSchema.safeParse(
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

            const { orgId } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode?.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [result] = await db
                .select()
                .from(loginPageOrg)
                .where(eq(loginPageOrg.orgId, orgId))
                .innerJoin(
                    loginPage,
                    eq(loginPageOrg.loginPageId, loginPage.loginPageId)
                )
                .limit(1);

            if (
                await checkExitNodeOrg(
                    remoteExitNode.exitNodeId,
                    result.loginPageOrg.orgId
                )
            ) {
                // If the exit node is not allowed for the org, return an error
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Exit node not allowed for this organization"
                    )
                );
            }

            if (!result) {
                return response<LoginPage | null>(res, {
                    data: null,
                    success: true,
                    error: false,
                    message: "Login page not found",
                    status: HttpCode.OK
                });
            }

            return response<LoginPage>(res, {
                data: result.loginPage,
                success: true,
                error: false,
                message: "Login page retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get org login page"
                )
            );
        }
    }
);

// Get user session with user information
hybridRouter.get(
    "/session/:userSessionId",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getUserSessionParamsSchema.safeParse(
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

            const { userSessionId } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode?.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [res_data] = await db
                .select()
                .from(sessions)
                .leftJoin(users, eq(users.userId, sessions.userId))
                .where(eq(sessions.sessionId, userSessionId));

            if (!res_data) {
                return response<UserSessionWithUser | null>(res, {
                    data: null,
                    success: true,
                    error: false,
                    message: "Session not found",
                    status: HttpCode.OK
                });
            }

            // TODO: THIS SEEMS TO BE TERRIBLY INEFFICIENT AND WE CAN FIX WITH SOME KIND OF BETTER SCHEMA!!!!!!!!!!!!!!!
            // Check if the user belongs to any organization that the exit node has access to
            if (res_data.user) {
                const userOrgsResult = await db
                    .select({
                        orgId: userOrgs.orgId
                    })
                    .from(userOrgs)
                    .where(eq(userOrgs.userId, res_data.user.userId));

                // Check if the exit node has access to any of the user's organizations
                let hasAccess = false;
                for (const userOrg of userOrgsResult) {
                    const accessDenied = await checkExitNodeOrg(
                        remoteExitNode.exitNodeId,
                        userOrg.orgId
                    );
                    if (!accessDenied) {
                        // checkExitNodeOrg returns true when access is denied, false when allowed
                        hasAccess = true;
                        break;
                    }
                }

                if (!hasAccess) {
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            "Exit node not authorized to access this user session"
                        )
                    );
                }
            }

            const userSessionWithUser: UserSessionWithUser = {
                session: res_data.session,
                user: res_data.user
            };

            return response<UserSessionWithUser>(res, {
                data: userSessionWithUser,
                success: true,
                error: false,
                message: "Session retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get user session"
                )
            );
        }
    }
);

// Get user organization role
hybridRouter.get(
    "/user/:userId/org/:orgId/role",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getUserOrgRoleParamsSchema.safeParse(
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

            const { userId, orgId } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            if (await checkExitNodeOrg(remoteExitNode.exitNodeId, orgId)) {
                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        "User is not authorized to access this organization"
                    )
                );
            }

            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId))
                )
                .limit(1);

            const result = userOrgRole.length > 0 ? userOrgRole[0] : null;

            return response<typeof userOrgs.$inferSelect | null>(res, {
                data: result,
                success: true,
                error: false,
                message: result
                    ? "User org role retrieved successfully"
                    : "User org role not found",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get user org role"
                )
            );
        }
    }
);

// Check if role has access to resource
hybridRouter.get(
    "/role/:roleId/resource/:resourceId/access",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getRoleResourceAccessParamsSchema.safeParse(
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

            const { roleId, resourceId } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode?.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (
                await checkExitNodeOrg(
                    remoteExitNode.exitNodeId,
                    resource.orgId
                )
            ) {
                // If the exit node is not allowed for the org, return an error
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Exit node not allowed for this organization"
                    )
                );
            }

            const roleResourceAccess = await db
                .select()
                .from(roleResources)
                .where(
                    and(
                        eq(roleResources.resourceId, resourceId),
                        eq(roleResources.roleId, roleId)
                    )
                )
                .limit(1);

            const result =
                roleResourceAccess.length > 0 ? roleResourceAccess[0] : null;

            return response<typeof roleResources.$inferSelect | null>(res, {
                data: result,
                success: true,
                error: false,
                message: result
                    ? "Role resource access retrieved successfully"
                    : "Role resource access not found",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get role resource access"
                )
            );
        }
    }
);

// Check if user has direct access to resource
hybridRouter.get(
    "/user/:userId/resource/:resourceId/access",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getUserResourceAccessParamsSchema.safeParse(
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

            const { userId, resourceId } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode?.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (
                await checkExitNodeOrg(
                    remoteExitNode.exitNodeId,
                    resource.orgId
                )
            ) {
                // If the exit node is not allowed for the org, return an error
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Exit node not allowed for this organization"
                    )
                );
            }

            const userResourceAccess = await db
                .select()
                .from(userResources)
                .where(
                    and(
                        eq(userResources.userId, userId),
                        eq(userResources.resourceId, resourceId)
                    )
                )
                .limit(1);

            const result =
                userResourceAccess.length > 0 ? userResourceAccess[0] : null;

            return response<typeof userResources.$inferSelect | null>(res, {
                data: result,
                success: true,
                error: false,
                message: result
                    ? "User resource access retrieved successfully"
                    : "User resource access not found",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get user resource access"
                )
            );
        }
    }
);

// Get resource rules for a given resource
hybridRouter.get(
    "/resource/:resourceId/rules",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getResourceRulesParamsSchema.safeParse(
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

            const { resourceId } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode?.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (
                await checkExitNodeOrg(
                    remoteExitNode.exitNodeId,
                    resource.orgId
                )
            ) {
                // If the exit node is not allowed for the org, return an error
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Exit node not allowed for this organization"
                    )
                );
            }

            let rules = await db
                .select()
                .from(resourceRules)
                .where(eq(resourceRules.resourceId, resourceId));

            // backward compatibility: COUNTRY -> GEOIP
            // TODO: remove this after a few versions once all exit nodes are updated
            if (
                (remoteExitNode.secondaryVersion &&
                    semver.lt(remoteExitNode.secondaryVersion, "1.1.0")) ||
                !remoteExitNode.secondaryVersion
            ) {
                for (const rule of rules) {
                    if (rule.match == "COUNTRY") {
                        rule.match = "GEOIP";
                    }
                }
            }

            logger.debug(
                `Retrieved ${rules.length} rules for resource ID ${resourceId}: ${JSON.stringify(rules)}`
            );

            return response<(typeof resourceRules.$inferSelect)[]>(res, {
                data: rules,
                success: true,
                error: false,
                message: "Resource rules retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get resource rules"
                )
            );
        }
    }
);

// Validate resource session token
hybridRouter.post(
    "/resource/:resourceId/session/validate",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams =
                validateResourceSessionTokenParamsSchema.safeParse(req.params);
            if (!parsedParams.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedParams.error).toString()
                    )
                );
            }

            const parsedBody = validateResourceSessionTokenBodySchema.safeParse(
                req.body
            );
            if (!parsedBody.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedBody.error).toString()
                    )
                );
            }

            const { resourceId } = parsedParams.data;
            const { token } = parsedBody.data;

            const result = await validateResourceSessionToken(
                token,
                resourceId
            );

            return response(res, {
                data: result,
                success: true,
                error: false,
                message: result.resourceSession
                    ? "Resource session token is valid"
                    : "Resource session token is invalid or expired",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to validate resource session token"
                )
            );
        }
    }
);

// Validate resource session token
hybridRouter.post(
    "/resource/:resourceId/access-token/verify",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedBody = validateResourceAccessTokenBodySchema.safeParse(
                req.body
            );
            if (!parsedBody.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedBody.error).toString()
                    )
                );
            }

            const { accessToken, resourceId, accessTokenId } = parsedBody.data;

            const result = await verifyResourceAccessToken({
                accessTokenId,
                accessToken,
                resourceId
            });

            return response(res, {
                data: result,
                success: true,
                error: false,
                message: result.valid
                    ? "Resource access token is valid"
                    : "Resource access token is invalid or expired",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to validate resource session token"
                )
            );
        }
    }
);

const geoIpLookupParamsSchema = z.object({
    ip: z.union([z.ipv4(), z.ipv6()])
});
hybridRouter.get(
    "/geoip/:ip",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = geoIpLookupParamsSchema.safeParse(req.params);
            if (!parsedParams.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedParams.error).toString()
                    )
                );
            }

            const { ip } = parsedParams.data;

            if (!maxmindLookup) {
                return next(
                    createHttpError(
                        HttpCode.SERVICE_UNAVAILABLE,
                        "GeoIP service is not available"
                    )
                );
            }

            const result = maxmindLookup.get(ip);

            if (!result || !result.country) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "GeoIP information not found"
                    )
                );
            }

            const { country } = result;

            logger.debug(
                `GeoIP lookup successful for IP ${ip}: ${country.iso_code}`
            );

            return response(res, {
                data: { countryCode: country.iso_code },
                success: true,
                error: false,
                message: "GeoIP lookup successful",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to validate resource session token"
                )
            );
        }
    }
);

// GERBIL ROUTERS
const getConfigSchema = z.object({
    publicKey: z.string(),
    endpoint: z.string(),
    listenPort: z.number()
});
hybridRouter.post(
    "/gerbil/get-config",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [exitNode] = await db
                .select()
                .from(exitNodes)
                .where(eq(exitNodes.exitNodeId, remoteExitNode.exitNodeId));

            if (!exitNode) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Exit node not found")
                );
            }

            const parsedParams = getConfigSchema.safeParse(req.body);
            if (!parsedParams.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedParams.error).toString()
                    )
                );
            }

            const { publicKey, endpoint, listenPort } = parsedParams.data;

            // update the public key
            await db
                .update(exitNodes)
                .set({
                    publicKey: publicKey,
                    endpoint: endpoint,
                    listenPort: listenPort
                })
                .where(eq(exitNodes.exitNodeId, remoteExitNode.exitNodeId));

            const configResponse = await generateGerbilConfig(exitNode);

            return res.status(HttpCode.OK).send(configResponse);
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get gerbil config"
                )
            );
        }
    }
);

hybridRouter.post(
    "/gerbil/receive-bandwidth",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const bandwidthData: any[] = req.body;

            if (!Array.isArray(bandwidthData)) {
                throw new Error("Invalid bandwidth data");
            }

            await updateSiteBandwidth(
                bandwidthData,
                false,
                remoteExitNode.exitNodeId
            ); // we dont want to check limits

            return res.status(HttpCode.OK).send({ success: true });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to receive bandwidth data"
                )
            );
        }
    }
);

const updateHolePunchSchema = z.object({
    olmId: z.string().optional(),
    newtId: z.string().optional(),
    token: z.string(),
    ip: z.string(),
    port: z.number(),
    timestamp: z.number(),
    reachableAt: z.string().optional(),
    publicKey: z.string().optional()
});
hybridRouter.post(
    "/gerbil/update-hole-punch",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [exitNode] = await db
                .select()
                .from(exitNodes)
                .where(eq(exitNodes.exitNodeId, remoteExitNode.exitNodeId));

            if (!exitNode) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Exit node not found")
                );
            }

            // Validate request parameters
            const parsedParams = updateHolePunchSchema.safeParse(req.body);
            if (!parsedParams.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedParams.error).toString()
                    )
                );
            }

            const { olmId, newtId, ip, port, timestamp, token, reachableAt } =
                parsedParams.data;

            const destinations = await updateAndGenerateEndpointDestinations(
                olmId,
                newtId,
                ip,
                port,
                timestamp,
                token,
                exitNode,
                true
            );

            return res.status(HttpCode.OK).send({
                destinations: destinations
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "An error occurred..."
                )
            );
        }
    }
);

hybridRouter.post(
    "/gerbil/get-all-relays",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [exitNode] = await db
                .select()
                .from(exitNodes)
                .where(eq(exitNodes.exitNodeId, remoteExitNode.exitNodeId));

            if (!exitNode) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Exit node not found")
                );
            }

            const mappings = await generateRelayMappings(exitNode);

            logger.debug(
                `Returning mappings for ${Object.keys(mappings).length} endpoints`
            );
            return res.status(HttpCode.OK).send({ mappings });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "An error occurred..."
                )
            );
        }
    }
);

hybridRouter.post("/badger/exchange-session", exchangeSession);

const getResolvedHostnameSchema = z.object({
    hostname: z.string(),
    publicKey: z.string()
});

hybridRouter.post(
    "/gerbil/get-resolved-hostname",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Validate request parameters
            const parsedParams = getResolvedHostnameSchema.safeParse(req.body);
            if (!parsedParams.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedParams.error).toString()
                    )
                );
            }

            const { hostname, publicKey } = parsedParams.data;

            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [exitNode] = await db
                .select()
                .from(exitNodes)
                .where(eq(exitNodes.exitNodeId, remoteExitNode.exitNodeId));

            if (!exitNode) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Exit node not found")
                );
            }

            const resourceExitNodes = await resolveExitNodes(
                hostname,
                publicKey
            );

            if (resourceExitNodes.length === 0) {
                return res.status(HttpCode.OK).send({ endpoints: [] });
            }

            // Filter endpoints based on exit node authorization
            // WE DONT WANT SOMEONE TO SEND A REQUEST TO SOMEONE'S
            // EXIT NODE AND TO FORWARD IT TO ANOTHER'S!
            const authorizedEndpoints = [];
            for (const node of resourceExitNodes) {
                const accessDenied = await checkExitNodeOrg(
                    remoteExitNode.exitNodeId,
                    node.orgId
                );
                if (!accessDenied) {
                    // checkExitNodeOrg returns true when access is denied, false when allowed
                    authorizedEndpoints.push(node.endpoint);
                }
            }

            if (authorizedEndpoints.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Exit node not authorized to access this resource"
                    )
                );
            }

            const endpoints = authorizedEndpoints;

            logger.debug(
                `Returning ${Object.keys(endpoints).length} endpoints: ${JSON.stringify(endpoints)}`
            );
            return res.status(HttpCode.OK).send({ endpoints });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "An error occurred..."
                )
            );
        }
    }
);

hybridRouter.get(
    "/org/:orgId/get-retention-days",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getOrgLoginPageParamsSchema.safeParse(
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

            const { orgId } = parsedParams.data;

            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            if (await checkExitNodeOrg(remoteExitNode.exitNodeId, orgId)) {
                // If the exit node is not allowed for the org, return an error
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Exit node not allowed for this organization"
                    )
                );
            }

            const [org] = await db
                .select({
                    settingsLogRetentionDaysRequest:
                        orgs.settingsLogRetentionDaysRequest
                })
                .from(orgs)
                .where(eq(orgs.orgId, orgId))
                .limit(1);

            return response(res, {
                data: {
                    settingsLogRetentionDaysRequest:
                        org.settingsLogRetentionDaysRequest
                },
                success: true,
                error: false,
                message: "Log retention days retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "An error occurred..."
                )
            );
        }
    }
);

const batchLogsSchema = z.object({
    logs: z.array(
        z.object({
            timestamp: z.number(),
            orgId: z.string().optional(),
            actorType: z.string().optional(),
            actor: z.string().optional(),
            actorId: z.string().optional(),
            metadata: z.string().nullable(),
            action: z.boolean(),
            resourceId: z.number().optional(),
            reason: z.number(),
            location: z.string().optional(),
            originalRequestURL: z.string(),
            scheme: z.string(),
            host: z.string(),
            path: z.string(),
            method: z.string(),
            ip: z.string().optional(),
            tls: z.boolean()
        })
    )
});

hybridRouter.post(
    "/logs/batch",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedBody = batchLogsSchema.safeParse(req.body);
            if (!parsedBody.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedBody.error).toString()
                    )
                );
            }

            const { logs } = parsedBody.data;

            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode || !remoteExitNode.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const exitNodeOrgsRes = await db
                .select()
                .from(exitNodeOrgs)
                .where(
                    and(eq(exitNodeOrgs.exitNodeId, remoteExitNode.exitNodeId))
                )
                .limit(1);

            // Batch insert all logs in a single query
            const logEntries = logs
                .filter((logEntry) => {
                    if (!logEntry.orgId) {
                        return false;
                    }

                    const isOrgAllowed = exitNodeOrgsRes.some(
                        (eno) => eno.orgId === logEntry.orgId
                    );
                    return isOrgAllowed;
                })
                .map((logEntry) => ({
                    timestamp: logEntry.timestamp,
                    orgId: logEntry.orgId,
                    actorType: logEntry.actorType,
                    actor: logEntry.actor,
                    actorId: logEntry.actorId,
                    metadata: logEntry.metadata,
                    action: logEntry.action,
                    resourceId: logEntry.resourceId,
                    reason: logEntry.reason,
                    location: logEntry.location,
                    // userAgent: data.userAgent, // TODO: add this
                    // headers: data.body.headers,
                    // query: data.body.query,
                    originalRequestURL: logEntry.originalRequestURL,
                    scheme: logEntry.scheme,
                    host: logEntry.host,
                    path: logEntry.path,
                    method: logEntry.method,
                    ip: logEntry.ip,
                    tls: logEntry.tls
                }));

            // batch them into inserts of 100 to avoid exceeding parameter limits
            const batchSize = 100;
            for (let i = 0; i < logEntries.length; i += batchSize) {
                const batch = logEntries.slice(i, i + batchSize);
                await db.insert(requestAuditLog).values(batch);
            }

            return response(res, {
                data: null,
                success: true,
                error: false,
                message: "Logs saved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "An error occurred..."
                )
            );
        }
    }
);
