/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
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
    logsDb,
    exitNodes,
    Resource,
    ResourcePassword,
    ResourcePincode,
    Session,
    User,
    certificates,
    exitNodeOrgs,
    domains,
    orgDomains,
    loginPage,
    loginPageOrg,
    LoginPage,
    resourceHeaderAuth,
    ResourceHeaderAuth,
    resourceHeaderAuthExtendedCompatibility,
    ResourceHeaderAuthExtendedCompatibility,
    orgs,
    requestAuditLog,
    Org,
    resourcePolicies,
    resourcePolicyPincode,
    ResourcePolicyPincode,
    resourcePolicyPassword,
    ResourcePolicyPassword,
    resourcePolicyHeaderAuth,
    ResourcePolicyHeaderAuth
} from "@server/db";
import {
    resources,
    resourcePincode,
    resourcePassword,
    sessions,
    users,
    userOrgs,
    roleResources,
    rolePolicies,
    userResources,
    userPolicies,
    resourceRules,
    resourcePolicyRules,
    userOrgRoles,
    roles
} from "@server/db";
import { eq, and, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "@server/db";
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
import logger from "@server/logger";
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { exchangeSession } from "@server/routers/badger";
import {
    ResourceSessionValidationResult,
    validateResourceSessionToken
} from "@server/auth/sessions/resource";
import { checkExitNodeOrg, resolveExitNodes } from "#private/lib/exitNodes";
import { maxmindLookup } from "@server/db/maxmind";
import { verifyResourceAccessToken } from "@server/auth/verifyResourceAccessToken";
import semver from "semver";
import { maxmindAsnLookup } from "@server/db/maxmindAsn";
import { checkOrgAccessPolicy } from "@server/lib/checkOrgAccessPolicy";
import { sanitizeString } from "@server/lib/sanitize";

// Zod schemas for request validation
const getResourceByDomainParamsSchema = z.strictObject({
    domain: z.string().min(1, "Domain is required")
});

const getUserSessionParamsSchema = z.strictObject({
    userSessionId: z.string().min(1, "User session ID is required")
});

const getUserOrgRoleParamsSchema = z.strictObject({
    userId: z.string().min(1, "User ID is required"),
    orgId: z.string().min(1, "Organization ID is required")
});

const getUserOrgSessionVerifySchema = z.strictObject({
    userId: z.string().min(1, "User ID is required"),
    orgId: z.string().min(1, "Organization ID is required"),
    sessionId: z.string().min(1, "Session ID is required")
});

const getRoleNameParamsSchema = z.strictObject({
    roleId: z
        .string()
        .transform(Number)
        .pipe(z.int().positive("Role ID must be a positive integer"))
});

const getRoleResourceAccessParamsSchema = z.strictObject({
    roleId: z
        .string()
        .transform(Number)
        .pipe(z.int().positive("Role ID must be a positive integer")),
    resourceId: z
        .string()
        .transform(Number)
        .pipe(z.int().positive("Resource ID must be a positive integer"))
});

const getResourceAccessParamsSchema = z.strictObject({
    resourceId: z
        .string()
        .transform(Number)
        .pipe(z.int().positive("Resource ID must be a positive integer"))
});

const getResourceAccessQuerySchema = z.strictObject({
    roleIds: z
        .union([z.array(z.string()), z.string()])
        .transform((val) =>
            (Array.isArray(val) ? val : [val])
                .map(Number)
                .filter((n) => !isNaN(n))
        )
});

const getUserResourceAccessParamsSchema = z.strictObject({
    userId: z.string().min(1, "User ID is required"),
    resourceId: z
        .string()
        .transform(Number)
        .pipe(z.int().positive("Resource ID must be a positive integer"))
});

const getResourceRulesParamsSchema = z.strictObject({
    resourceId: z
        .string()
        .transform(Number)
        .pipe(z.int().positive("Resource ID must be a positive integer"))
});

const validateResourceSessionTokenParamsSchema = z.strictObject({
    resourceId: z
        .string()
        .transform(Number)
        .pipe(z.int().positive("Resource ID must be a positive integer"))
});

const validateResourceSessionTokenBodySchema = z.strictObject({
    token: z.string().min(1, "Token is required")
});

const validateResourceAccessTokenBodySchema = z.strictObject({
    accessTokenId: z.string().optional(),
    resourceId: z.number().optional(),
    accessToken: z.string()
});

// Certificates by domains query validation
const getCertificatesByDomainsQuerySchema = z.strictObject({
    // Accept domains as string or array (domains or domains[])
    domains: z
        .union([z.array(z.string().min(1)), z.string().min(1)])
        .optional(),
    // Handle array format from query parameters (domains[])
    "domains[]": z
        .union([z.array(z.string().min(1)), z.string().min(1)])
        .optional()
});

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
    pincode: ResourcePincode | ResourcePolicyPincode | null;
    password: ResourcePassword | ResourcePolicyPassword | null;
    headerAuth: ResourceHeaderAuth | ResourcePolicyHeaderAuth | null;
    headerAuthExtendedCompatibility: ResourceHeaderAuthExtendedCompatibility | null;
    applyRules: boolean | null;
    sso: boolean | null;
    emailWhitelistEnabled: boolean | null;
    org: Org;
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

        const pangolinUIUrl = config.getRawConfig().app.dashboard_url; // points to the dashboard to serve from there

        try {
            const traefikConfig = await getTraefikConfig(
                remoteExitNode.exitNodeId,
                ["newt", "local", "wireguard"], // Allow them to use all the site types
                true, // But don't allow domain namespace resources
                false, // Dont include login pages,
                true, // allow raw resources
                pangolinUIUrl, // dont generate maintenance page
                pangolinUIUrl // generate browser gateway targets
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

// Get valid certificates for given domains (supports wildcard certs)
hybridRouter.get(
    "/certificates/domains",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
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
                const decryptedCert = decrypt(
                    cert.certFile!, // is not null from query
                    config.getRawConfig().server.secret!
                );

                // Decrypt and save key file
                const decryptedKey = decrypt(
                    cert.keyFile!,
                    config.getRawConfig().server.secret!
                );

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

            // Build wildcard domain candidates for the requested domain.
            // e.g. "me.example.test.com" -> ["*.example.test.com", "*.test.com"]
            const domainParts = domain.split(".");
            const wildcardCandidates: string[] = [];
            for (let i = 1; i < domainParts.length; i++) {
                wildcardCandidates.push(`*.${domainParts.slice(i).join(".")}`);
            }

            const sharedPolicy = alias(resourcePolicies, "sharedPolicy");
            const defaultPolicy = alias(resourcePolicies, "defaultPolicy");
            const sharedPolicyPincode = alias(
                resourcePolicyPincode,
                "sharedPolicyPincode"
            );
            const defaultPolicyPincode = alias(
                resourcePolicyPincode,
                "defaultPolicyPincode"
            );
            const sharedPolicyPassword = alias(
                resourcePolicyPassword,
                "sharedPolicyPassword"
            );
            const defaultPolicyPassword = alias(
                resourcePolicyPassword,
                "defaultPolicyPassword"
            );
            const sharedPolicyHeaderAuth = alias(
                resourcePolicyHeaderAuth,
                "sharedPolicyHeaderAuth"
            );
            const defaultPolicyHeaderAuth = alias(
                resourcePolicyHeaderAuth,
                "defaultPolicyHeaderAuth"
            );

            const potentialResults = await db
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
                .leftJoin(
                    resourceHeaderAuthExtendedCompatibility,
                    eq(
                        resourceHeaderAuthExtendedCompatibility.resourceId,
                        resources.resourceId
                    )
                )
                .leftJoin(
                    sharedPolicy,
                    eq(
                        sharedPolicy.resourcePolicyId,
                        resources.resourcePolicyId
                    )
                )
                .leftJoin(
                    sharedPolicyPincode,
                    eq(
                        sharedPolicyPincode.resourcePolicyId,
                        sharedPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    sharedPolicyPassword,
                    eq(
                        sharedPolicyPassword.resourcePolicyId,
                        sharedPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    sharedPolicyHeaderAuth,
                    eq(
                        sharedPolicyHeaderAuth.resourcePolicyId,
                        sharedPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicy,
                    eq(
                        defaultPolicy.resourcePolicyId,
                        resources.defaultResourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicyPincode,
                    eq(
                        defaultPolicyPincode.resourcePolicyId,
                        defaultPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicyPassword,
                    eq(
                        defaultPolicyPassword.resourcePolicyId,
                        defaultPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicyHeaderAuth,
                    eq(
                        defaultPolicyHeaderAuth.resourcePolicyId,
                        defaultPolicy.resourcePolicyId
                    )
                )
                .innerJoin(orgs, eq(orgs.orgId, resources.orgId))
                .where(
                    or(
                        // Exact match
                        eq(resources.fullDomain, domain),
                        // Wildcard match
                        wildcardCandidates.length > 0
                            ? and(
                                  eq(resources.wildcard, true),
                                  inArray(
                                      resources.fullDomain,
                                      wildcardCandidates
                                  )
                              )
                            : sql`false`
                    )
                );

            // Prefer exact match over wildcard match
            const exactMatch = potentialResults.find(
                (r) => r.resources?.fullDomain === domain
            );
            const result = exactMatch ?? potentialResults[0];

            if (
                result &&
                (await checkExitNodeOrg(
                    remoteExitNode.exitNodeId,
                    result.resources.orgId
                ))
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

            const hasSharedPolicy = result.sharedPolicy !== null;

            const effectivePolicyPincode = hasSharedPolicy
                ? result.sharedPolicyPincode
                : (result.defaultPolicyPincode ?? null);
            const effectivePolicyPassword = hasSharedPolicy
                ? result.sharedPolicyPassword
                : (result.defaultPolicyPassword ?? null);
            const effectivePolicyHeaderAuth = hasSharedPolicy
                ? result.sharedPolicyHeaderAuth
                : (result.defaultPolicyHeaderAuth ?? null);
            const selectedPolicy = hasSharedPolicy
                ? result.sharedPolicy
                : result.defaultPolicy;
            const effectiveApplyRules =
                selectedPolicy?.applyRules ?? result.resources.applyRules;
            const effectiveSSO = selectedPolicy?.sso ?? result.resources.sso;
            const effectiveEmailWhitelistEnabled =
                selectedPolicy?.emailWhitelistEnabled ??
                result.resources.emailWhitelistEnabled;

            const resourceWithAuth: ResourceWithAuth = {
                resource: {
                    ...result.resources,
                    applyRules: effectiveApplyRules,
                    sso: effectiveSSO,
                    emailWhitelistEnabled: effectiveEmailWhitelistEnabled
                },
                pincode: effectivePolicyPincode ?? result.resourcePincode,
                password: effectivePolicyPassword ?? result.resourcePassword,
                headerAuth:
                    effectivePolicyHeaderAuth ?? result.resourceHeaderAuth,
                headerAuthExtendedCompatibility: effectivePolicyHeaderAuth
                    ? ({
                          headerAuthExtendedCompatibilityId: 0,
                          resourceId: result.resources.resourceId,
                          extendedCompatibilityIsActivated:
                              effectivePolicyHeaderAuth.extendedCompatibility
                      } as ResourceHeaderAuthExtendedCompatibility)
                    : result.resourceHeaderAuthExtendedCompatibility,
                applyRules: effectiveApplyRules,
                sso: effectiveSSO,
                emailWhitelistEnabled: effectiveEmailWhitelistEnabled,
                org: result.orgs
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

const getOrgLoginPageParamsSchema = z.strictObject({
    orgId: z.string().min(1)
});

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

            if (!result) {
                return response<LoginPage | null>(res, {
                    data: null,
                    success: true,
                    error: false,
                    message: "Login page not found",
                    status: HttpCode.OK
                });
            }

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
    "/user/:userId/org/:orgId/roles",
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

            const userOrgRoleRows = await db
                .select({ roleId: userOrgRoles.roleId, roleName: roles.name })
                .from(userOrgRoles)
                .innerJoin(roles, eq(roles.roleId, userOrgRoles.roleId))
                .where(
                    and(
                        eq(userOrgRoles.userId, userId),
                        eq(userOrgRoles.orgId, orgId)
                    )
                );

            logger.debug(
                `User ${userId} has roles in org ${orgId}:`,
                userOrgRoleRows
            );

            return response<{ roleId: number; roleName: string }[]>(res, {
                data: userOrgRoleRows,
                success: true,
                error: false,
                message:
                    userOrgRoleRows.length > 0
                        ? "User org roles retrieved successfully"
                        : "User has no roles in this organization",
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

// DEPRICATED Get user organization role
// used for backward compatibility with old remote nodes
hybridRouter.get(
    "/user/:userId/org/:orgId/role", // <- note the missing s
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

            // get the roles on the user

            const userOrgRoleRows = await db
                .select({ roleId: userOrgRoles.roleId })
                .from(userOrgRoles)
                .where(
                    and(
                        eq(userOrgRoles.userId, userId),
                        eq(userOrgRoles.orgId, orgId)
                    )
                );

            const roleIds = userOrgRoleRows.map((r) => r.roleId);

            let roleId: number | null = null;

            if (userOrgRoleRows.length === 0) {
                // User has no roles in this organization
                roleId = null;
            } else if (userOrgRoleRows.length === 1) {
                // User has exactly one role, return it
                roleId = userOrgRoleRows[0].roleId;
            } else {
                // User has multiple roles
                // Check if any of these roles are also assigned to a resource
                // If we find a match, prefer that role; otherwise return the first role
                // Get all resources that have any of these roles assigned
                const roleResourceMatches = await db
                    .select({ roleId: roleResources.roleId })
                    .from(roleResources)
                    .where(inArray(roleResources.roleId, roleIds))
                    .limit(1);
                if (roleResourceMatches.length > 0) {
                    // Return the first role that's also on a resource
                    roleId = roleResourceMatches[0].roleId;
                } else {
                    // No resource match found, return the first role
                    roleId = userOrgRoleRows[0].roleId;
                }
            }

            return response<{ roleId: number | null }>(res, {
                data: { roleId },
                success: true,
                error: false,
                message:
                    roleIds.length > 0
                        ? "User org roles retrieved successfully"
                        : "User has no roles in this organization",
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

// Get user organization role
hybridRouter.get(
    "/user/:userId/org/:orgId/session/:sessionId/verify",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getUserOrgSessionVerifySchema.safeParse(
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

            const { userId, orgId, sessionId } = parsedParams.data;
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

            const accessPolicy = await checkOrgAccessPolicy({
                orgId,
                userId,
                sessionId
            });

            return response(res, {
                data: accessPolicy,
                success: true,
                error: false,
                message: "User org access policy retrieved successfully",
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

// Get role name by ID
hybridRouter.get(
    "/role/:roleId/name",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getRoleNameParamsSchema.safeParse(req.params);
            if (!parsedParams.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedParams.error).toString()
                    )
                );
            }

            const { roleId } = parsedParams.data;
            const remoteExitNode = req.remoteExitNode;

            if (!remoteExitNode?.exitNodeId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Remote exit node not found"
                    )
                );
            }

            const [role] = await db
                .select({ name: roles.name })
                .from(roles)
                .where(eq(roles.roleId, roleId))
                .limit(1);

            return response<string | null>(res, {
                data: role?.name ?? null,
                success: true,
                error: false,
                message: role
                    ? "Role name retrieved successfully"
                    : "Role not found",
                status: HttpCode.OK
            });
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to get role name"
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

            const [direct, viaPolicies] = await Promise.all([
                db
                    .select()
                    .from(roleResources)
                    .where(
                        and(
                            eq(roleResources.resourceId, resourceId),
                            eq(roleResources.roleId, roleId)
                        )
                    )
                    .limit(1),
                db
                    .select({
                        roleId: rolePolicies.roleId,
                        resourcePolicyId: rolePolicies.resourcePolicyId
                    })
                    .from(rolePolicies)
                    .innerJoin(
                        resources,
                        or(
                            eq(
                                resources.resourcePolicyId,
                                rolePolicies.resourcePolicyId
                            ),
                            and(
                                isNull(resources.resourcePolicyId),
                                eq(
                                    resources.defaultResourcePolicyId,
                                    rolePolicies.resourcePolicyId
                                )
                            )
                        )
                    )
                    .where(
                        and(
                            eq(resources.resourceId, resourceId),
                            eq(rolePolicies.roleId, roleId)
                        )
                    )
                    .limit(1)
            ]);

            const result = direct[0] ?? viaPolicies[0] ?? null;

            return response<typeof roleResources.$inferSelect | null>(res, {
                data: result as any,
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

// Check if role has access to resource
hybridRouter.get(
    "/resource/:resourceId/access",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = getResourceAccessParamsSchema.safeParse(
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
            const parsedQuery = getResourceAccessQuerySchema.safeParse(
                req.query
            );
            const roleIds = parsedQuery.success ? parsedQuery.data.roleIds : [];

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

            const [direct, viaPolicies] = await Promise.all([
                db
                    .select({
                        resourceId: roleResources.resourceId,
                        roleId: roleResources.roleId
                    })
                    .from(roleResources)
                    .where(
                        and(
                            eq(roleResources.resourceId, resourceId),
                            inArray(roleResources.roleId, roleIds)
                        )
                    ),
                roleIds.length > 0
                    ? db
                          .select({
                              resourceId: sql<number>`${resourceId}`,
                              roleId: rolePolicies.roleId
                          })
                          .from(rolePolicies)
                          .innerJoin(
                              resources,
                              or(
                                  eq(
                                      resources.resourcePolicyId,
                                      rolePolicies.resourcePolicyId
                                  ),
                                  and(
                                      isNull(resources.resourcePolicyId),
                                      eq(
                                          resources.defaultResourcePolicyId,
                                          rolePolicies.resourcePolicyId
                                      )
                                  )
                              )
                          )
                          .where(
                              and(
                                  eq(resources.resourceId, resourceId),
                                  inArray(rolePolicies.roleId, roleIds)
                              )
                          )
                    : Promise.resolve([])
            ]);

            const combined = [...direct, ...viaPolicies];
            const result = combined.length > 0 ? combined : null;

            return response<{ resourceId: number; roleId: number }[] | null>(
                res,
                {
                    data: result,
                    success: true,
                    error: false,
                    message: result
                        ? "Role resource access retrieved successfully"
                        : "Role resource access not found",
                    status: HttpCode.OK
                }
            );
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

            const [directUserAccess, viaPoliciesUserAccess] = await Promise.all(
                [
                    db
                        .select()
                        .from(userResources)
                        .where(
                            and(
                                eq(userResources.userId, userId),
                                eq(userResources.resourceId, resourceId)
                            )
                        )
                        .limit(1),
                    db
                        .select({
                            userId: userPolicies.userId,
                            resourcePolicyId: userPolicies.resourcePolicyId
                        })
                        .from(userPolicies)
                        .innerJoin(
                            resources,
                            or(
                                eq(
                                    resources.resourcePolicyId,
                                    userPolicies.resourcePolicyId
                                ),
                                and(
                                    isNull(resources.resourcePolicyId),
                                    eq(
                                        resources.defaultResourcePolicyId,
                                        userPolicies.resourcePolicyId
                                    )
                                )
                            )
                        )
                        .where(
                            and(
                                eq(resources.resourceId, resourceId),
                                eq(userPolicies.userId, userId)
                            )
                        )
                        .limit(1)
                ]
            );

            const result =
                directUserAccess[0] ?? viaPoliciesUserAccess[0] ?? null;

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

            const [directRules, policyRules] = await Promise.all([
                db
                    .select()
                    .from(resourceRules)
                    .where(eq(resourceRules.resourceId, resourceId)),
                db
                    .select({
                        ruleId: resourcePolicyRules.ruleId,
                        resourceId: sql<number>`${resourceId}`,
                        enabled: resourcePolicyRules.enabled,
                        priority: resourcePolicyRules.priority,
                        action: resourcePolicyRules.action,
                        match: resourcePolicyRules.match,
                        value: resourcePolicyRules.value
                    })
                    .from(resourcePolicyRules)
                    .innerJoin(
                        resources,
                        or(
                            eq(
                                resources.resourcePolicyId,
                                resourcePolicyRules.resourcePolicyId
                            ),
                            and(
                                isNull(resources.resourcePolicyId),
                                eq(
                                    resources.defaultResourcePolicyId,
                                    resourcePolicyRules.resourcePolicyId
                                )
                            )
                        )
                    )
                    .where(eq(resources.resourceId, resourceId))
            ]);

            const maxDirectPriority = directRules.reduce(
                (max, r) => Math.max(max, r.priority),
                0
            );
            const offsetPolicyRules = policyRules.map((r) => ({
                ...r,
                priority: maxDirectPriority + r.priority
            }));

            const rules = [
                ...directRules,
                ...offsetPolicyRules
            ] as (typeof resourceRules.$inferSelect)[];

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

            // this is for backward compatibility with nodes that did not have the policy id checking
            const modifiedResult: ResourceSessionValidationResult = {
                ...result,
                resourceSession: result.resourceSession
                    ? {
                          ...result.resourceSession,
                          // Prefer policy IDs, but keep legacy IDs populated for older nodes.
                          pincodeId:
                              result.resourceSession.policyPincodeId ??
                              result.resourceSession.pincodeId ??
                              null,
                          passwordId:
                              result.resourceSession.policyPasswordId ??
                              result.resourceSession.passwordId ??
                              null,
                          whitelistId:
                              result.resourceSession.policyWhitelistId ??
                              result.resourceSession.whitelistId ??
                              null
                      }
                    : null
            };

            return response(res, {
                data: modifiedResult,
                success: true,
                error: false,
                message: modifiedResult.resourceSession
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

const asnIpLookupParamsSchema = z.object({
    ip: z.union([z.ipv4(), z.ipv6()])
});
hybridRouter.get(
    "/asnip/:ip",
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsedParams = asnIpLookupParamsSchema.safeParse(req.params);
            if (!parsedParams.success) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        fromError(parsedParams.error).toString()
                    )
                );
            }

            const { ip } = parsedParams.data;

            if (!maxmindAsnLookup) {
                return next(
                    createHttpError(
                        HttpCode.SERVICE_UNAVAILABLE,
                        "ASNIP service is not available"
                    )
                );
            }

            const result = maxmindAsnLookup.get(ip);

            if (!result || !result.autonomous_system_number) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "ASNIP information not found"
                    )
                );
            }

            const { autonomous_system_number } = result;

            logger.debug(
                `ASNIP lookup successful for IP ${ip}: ${autonomous_system_number}`
            );

            return response(res, {
                data: { asn: autonomous_system_number },
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
    publicKey: z.string() // this is the client public key
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

            const {
                olmId,
                newtId,
                ip,
                port,
                timestamp,
                token,
                publicKey,
                reachableAt
            } = parsedParams.data;

            const destinations = await updateAndGenerateEndpointDestinations(
                olmId,
                newtId,
                ip,
                port,
                timestamp,
                token,
                publicKey,
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
                    orgId: sanitizeString(logEntry.orgId),
                    actorType: sanitizeString(logEntry.actorType),
                    actor: sanitizeString(logEntry.actor),
                    actorId: sanitizeString(logEntry.actorId),
                    metadata: sanitizeString(logEntry.metadata),
                    action: logEntry.action,
                    resourceId: logEntry.resourceId,
                    reason: logEntry.reason,
                    location: sanitizeString(logEntry.location),
                    // userAgent: data.userAgent, // TODO: add this
                    // headers: data.body.headers,
                    // query: data.body.query,
                    originalRequestURL:
                        sanitizeString(logEntry.originalRequestURL) ?? "",
                    scheme: sanitizeString(logEntry.scheme) ?? "",
                    host: sanitizeString(logEntry.host) ?? "",
                    path: sanitizeString(logEntry.path) ?? "",
                    method: sanitizeString(logEntry.method) ?? "",
                    ip: sanitizeString(logEntry.ip),
                    tls: logEntry.tls
                }));

            // batch them into inserts of 100 to avoid exceeding parameter limits
            const batchSize = 100;
            for (let i = 0; i < logEntries.length; i += batchSize) {
                const batch = logEntries.slice(i, i + batchSize);
                await logsDb.insert(requestAuditLog).values(batch);
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
