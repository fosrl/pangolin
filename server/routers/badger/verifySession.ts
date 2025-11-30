import { validateResourceSessionToken } from "@server/auth/sessions/resource";
import { verifyResourceAccessToken } from "@server/auth/verifyResourceAccessToken";
import {
    getResourceByDomain,
    getResourceRules,
    getRoleResourceAccess,
    getUserOrgRole,
    getUserResourceAccess,
    getOrgLoginPage,
    getUserSessionWithUser
} from "@server/db/queries/verifySessionQueries";
import {
    LoginPage,
    Org,
    Resource,
    ResourceHeaderAuth,
    ResourcePassword,
    ResourcePincode,
    ResourceRule,
    resourceSessions
} from "@server/db";
import config from "@server/lib/config";
import { isIpInCidr } from "@server/lib/ip";
import { response } from "@server/lib/response";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { getCountryCodeForIp } from "@server/lib/geoip";
import { getOrgTierData } from "#dynamic/lib/billing";
import { TierId } from "@server/lib/billing/tiers";
import { verifyPassword } from "@server/auth/password";
import {
    checkOrgAccessPolicy,
    enforceResourceSessionLength
} from "#dynamic/lib/checkOrgAccessPolicy";
import { logRequestAudit } from "./logRequestAudit";
import cache from "@server/lib/cache";

const verifyResourceSessionSchema = z.object({
    sessions: z.record(z.string()).optional(),
    headers: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
    originalRequestURL: z.string().url(),
    scheme: z.string(),
    host: z.string(),
    path: z.string(),
    method: z.string(),
    tls: z.boolean(),
    requestIp: z.string().optional()
});

export type VerifyResourceSessionSchema = z.infer<
    typeof verifyResourceSessionSchema
>;

type BasicUserData = {
    username: string;
    email: string | null;
    name: string | null;
};

export type VerifyUserResponse = {
    valid: boolean;
    redirectUrl?: string;
    userData?: BasicUserData;
};

export async function verifyResourceSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    logger.debug("Verify session: Badger sent", req.body); // remove when done testing

    const parsedBody = verifyResourceSessionSchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    try {
        const {
            sessions,
            host,
            originalRequestURL,
            requestIp,
            path,
            headers,
            query
        } = parsedBody.data;

        // Extract HTTP Basic Auth credentials if present
        const clientHeaderAuth = extractBasicAuth(headers);

        const clientIp = requestIp
            ? (() => {
                  logger.debug("Request IP:", { requestIp });
                  if (requestIp.startsWith("[") && requestIp.includes("]")) {
                      // if brackets are found, extract the IPv6 address from between the brackets
                      const ipv6Match = requestIp.match(/\[(.*?)\]/);
                      if (ipv6Match) {
                          return ipv6Match[1];
                      }
                  }

                  // ivp4
                  // split at last colon
                  const lastColonIndex = requestIp.lastIndexOf(":");
                  if (lastColonIndex !== -1) {
                      return requestIp.substring(0, lastColonIndex);
                  }
                  return requestIp;
              })()
            : undefined;

        logger.debug("Client IP:", { clientIp });

        const ipCC = clientIp
            ? await getCountryCodeFromIp(clientIp)
            : undefined;

        let cleanHost = host;
        // if the host ends with :port, strip it
        if (cleanHost.match(/:[0-9]{1,5}$/)) {
            const matched = "" + cleanHost.match(/:[0-9]{1,5}$/);
            cleanHost = cleanHost.slice(0, -1 * matched.length);
        }

        const resourceCacheKey = `resource:${cleanHost}`;
        let resourceData:
            | {
                  resource: Resource | null;
                  pincode: ResourcePincode | null;
                  password: ResourcePassword | null;
                  headerAuth: ResourceHeaderAuth | null;
                  org: Org;
              }
            | undefined = cache.get(resourceCacheKey);

        if (!resourceData) {
            const result = await getResourceByDomain(cleanHost);

            if (!result) {
                logger.debug(`Resource not found ${cleanHost}`);

                // TODO: we cant log this for now because we dont know the org
                // eventually it would be cool to show this for the server admin

                // logRequestAudit(
                //     {
                //         action: false,
                //         reason: 201, //resource not found
                //         location: ipCC
                //     },
                //     parsedBody.data
                // );

                return notAllowed(res);
            }

            resourceData = result;
            cache.set(resourceCacheKey, resourceData, 5);
        }

        const { resource, pincode, password, headerAuth } = resourceData;

        if (!resource) {
            logger.debug(`Resource not found ${cleanHost}`);

            // TODO: we cant log this for now because we dont know the org
            // eventually it would be cool to show this for the server admin

            // logRequestAudit(
            //     {
            //         action: false,
            //         reason: 201, //resource not found
            //         location: ipCC
            //     },
            //     parsedBody.data
            // );

            return notAllowed(res);
        }

        const { sso, blockAccess } = resource;

        if (blockAccess) {
            logger.debug("Resource blocked", host);

            logRequestAudit(
                {
                    action: false,
                    reason: 202, //resource blocked
                    resourceId: resource.resourceId,
                    orgId: resource.orgId,
                    location: ipCC
                },
                parsedBody.data
            );

            return notAllowed(res);
        }

        // check the rules
        if (resource.applyRules) {
            const action = await checkRules(
                resource.resourceId,
                clientIp,
                path,
                ipCC
            );

            if (action == "ACCEPT") {
                logger.debug("Resource allowed by rule");

                logRequestAudit(
                    {
                        action: true,
                        reason: 100, // allowed by rule
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC
                    },
                    parsedBody.data
                );

                return allowed(res);
            } else if (action == "DROP") {
                logger.debug("Resource denied by rule");

                // TODO: add rules type
                logRequestAudit(
                    {
                        action: false,
                        reason: 203, // dropped by rules
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC
                    },
                    parsedBody.data
                );

                return notAllowed(res);
            } else if (action == "PASS") {
                logger.debug(
                    "Resource passed by rule, continuing to auth checks"
                );
                // Continue to authentication checks below
            }

            // otherwise its undefined and we pass
        }

        // IMPORTANT: ADD NEW AUTH CHECKS HERE OR WHEN TURNING OFF ALL OTHER AUTH METHODS IT WILL JUST PASS
        if (
            !sso &&
            !pincode &&
            !password &&
            !resource.emailWhitelistEnabled &&
            !headerAuth
        ) {
            logger.debug("Resource allowed because no auth");

            logRequestAudit(
                {
                    action: true,
                    reason: 101, // allowed no auth
                    resourceId: resource.resourceId,
                    orgId: resource.orgId,
                    location: ipCC
                },
                parsedBody.data
            );

            return allowed(res);
        }

        const redirectPath = `/auth/resource/${encodeURIComponent(
            resource.resourceGuid
        )}?redirect=${encodeURIComponent(originalRequestURL)}`;

        // check for access token in headers
        if (
            headers &&
            headers[
                config.getRawConfig().server.resource_access_token_headers.id
            ] &&
            headers[
                config.getRawConfig().server.resource_access_token_headers.token
            ]
        ) {
            const accessTokenId =
                headers[
                    config.getRawConfig().server.resource_access_token_headers
                        .id
                ];
            const accessToken =
                headers[
                    config.getRawConfig().server.resource_access_token_headers
                        .token
                ];

            const { valid, error, tokenItem } = await verifyResourceAccessToken(
                {
                    accessToken,
                    accessTokenId,
                    resourceId: resource.resourceId
                }
            );

            if (error) {
                logger.debug("Access token invalid: " + error);
            }

            if (!valid) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Resource access token is invalid. Resource ID: ${
                            resource.resourceId
                        }. IP: ${clientIp}.`
                    );
                }
            }

            if (valid && tokenItem) {
                logRequestAudit(
                    {
                        action: true,
                        reason: 102, // valid access token
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC,
                        apiKey: {
                            name: tokenItem.title,
                            apiKeyId: tokenItem.accessTokenId
                        }
                    },
                    parsedBody.data
                );

                return allowed(res);
            }
        }

        if (
            query &&
            query[config.getRawConfig().server.resource_access_token_param]
        ) {
            const token =
                query[config.getRawConfig().server.resource_access_token_param];

            const [accessTokenId, accessToken] = token.split(".");

            const { valid, error, tokenItem } = await verifyResourceAccessToken(
                {
                    accessToken,
                    accessTokenId,
                    resourceId: resource.resourceId
                }
            );

            if (error) {
                logger.debug("Access token invalid: " + error);
            }

            if (!valid) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Resource access token is invalid. Resource ID: ${
                            resource.resourceId
                        }. IP: ${clientIp}.`
                    );
                }
            }

            if (valid && tokenItem) {
                logRequestAudit(
                    {
                        action: true,
                        reason: 102, // valid access token
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC,
                        apiKey: {
                            name: tokenItem.title,
                            apiKeyId: tokenItem.accessTokenId
                        }
                    },
                    parsedBody.data
                );

                return allowed(res);
            }
        }

        // check for HTTP Basic Auth header
        const clientHeaderAuthKey = `headerAuth:${clientHeaderAuth}`;
        if (headerAuth && clientHeaderAuth) {
            if (cache.get(clientHeaderAuthKey)) {
                logger.debug(
                    "Resource allowed because header auth is valid (cached)"
                );

                logRequestAudit(
                    {
                        action: true,
                        reason: 103, // valid header auth
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC
                    },
                    parsedBody.data
                );

                return allowed(res);
            } else if (
                await verifyPassword(
                    clientHeaderAuth,
                    headerAuth.headerAuthHash
                )
            ) {
                cache.set(clientHeaderAuthKey, clientHeaderAuth, 5);
                logger.debug("Resource allowed because header auth is valid");

                logRequestAudit(
                    {
                        action: true,
                        reason: 103, // valid header auth
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC
                    },
                    parsedBody.data
                );

                return allowed(res);
            }

            if (
                // we dont want to redirect if this is the only auth method and we did not pass here
                !sso &&
                !pincode &&
                !password &&
                !resource.emailWhitelistEnabled
            ) {
                logRequestAudit(
                    {
                        action: false,
                        reason: 299, // no more auth methods
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC
                    },
                    parsedBody.data
                );

                return notAllowed(res);
            }
        } else if (headerAuth) {
            // if there are no other auth methods we need to return unauthorized if nothing is provided
            if (
                !sso &&
                !pincode &&
                !password &&
                !resource.emailWhitelistEnabled
            ) {
                logRequestAudit(
                    {
                        action: false,
                        reason: 299, // no more auth methods
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC
                    },
                    parsedBody.data
                );

                return notAllowed(res);
            }
        }

        if (!sessions) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Missing resource sessions. Resource ID: ${
                        resource.resourceId
                    }. IP: ${clientIp}.`
                );
            }

            logRequestAudit(
                {
                    action: false,
                    reason: 204, // no sessions
                    resourceId: resource.resourceId,
                    orgId: resource.orgId,
                    location: ipCC
                },
                parsedBody.data
            );

            return notAllowed(res);
        }

        const resourceSessionToken = extractResourceSessionToken(
            sessions,
            resource.ssl
        );

        if (resourceSessionToken) {
            const sessionCacheKey = `session:${resourceSessionToken}`;
            let resourceSession: any = cache.get(sessionCacheKey);

            if (!resourceSession) {
                const result = await validateResourceSessionToken(
                    resourceSessionToken,
                    resource.resourceId
                );

                resourceSession = result?.resourceSession;
                cache.set(sessionCacheKey, resourceSession, 5);
            }

            if (resourceSession?.isRequestToken) {
                logger.debug(
                    "Resource not allowed because session is a temporary request token"
                );
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Resource session is an exchange token. Resource ID: ${
                            resource.resourceId
                        }. IP: ${clientIp}.`
                    );
                }

                logRequestAudit(
                    {
                        action: false,
                        reason: 205, // temporary request token
                        resourceId: resource.resourceId,
                        orgId: resource.orgId,
                        location: ipCC
                    },
                    parsedBody.data
                );

                return notAllowed(res);
            }

            if (resourceSession) {
                // only run this check if not SSO sesion; SSO session length is checked later
                const accessPolicy = await enforceResourceSessionLength(
                    resourceSession,
                    resourceData.org
                );

                if (!accessPolicy.valid) {
                    logger.debug(
                        "Resource session invalid due to org policy:",
                        accessPolicy.error
                    );
                    return notAllowed(res, redirectPath, resource.orgId);
                }

                if (pincode && resourceSession.pincodeId) {
                    logger.debug(
                        "Resource allowed because pincode session is valid"
                    );

                    logRequestAudit(
                        {
                            action: true,
                            reason: 104, // valid pincode
                            resourceId: resource.resourceId,
                            orgId: resource.orgId,
                            location: ipCC
                        },
                        parsedBody.data
                    );

                    return allowed(res);
                }

                if (password && resourceSession.passwordId) {
                    logger.debug(
                        "Resource allowed because password session is valid"
                    );

                    logRequestAudit(
                        {
                            action: true,
                            reason: 105, // valid password
                            resourceId: resource.resourceId,
                            orgId: resource.orgId,
                            location: ipCC
                        },
                        parsedBody.data
                    );

                    return allowed(res);
                }

                if (
                    resource.emailWhitelistEnabled &&
                    resourceSession.whitelistId
                ) {
                    logger.debug(
                        "Resource allowed because whitelist session is valid"
                    );

                    logRequestAudit(
                        {
                            action: true,
                            reason: 106, // valid email
                            resourceId: resource.resourceId,
                            orgId: resource.orgId,
                            location: ipCC
                        },
                        parsedBody.data
                    );

                    return allowed(res);
                }

                if (resourceSession.accessTokenId) {
                    logger.debug(
                        "Resource allowed because access token session is valid"
                    );

                    logRequestAudit(
                        {
                            action: true,
                            reason: 102, // valid access token
                            resourceId: resource.resourceId,
                            orgId: resource.orgId,
                            location: ipCC,
                            apiKey: {
                                name: resourceSession.accessTokenTitle,
                                apiKeyId: resourceSession.accessTokenId
                            }
                        },
                        parsedBody.data
                    );

                    return allowed(res);
                }

                if (resourceSession.userSessionId && sso) {
                    const userAccessCacheKey = `userAccess:${
                        resourceSession.userSessionId
                    }:${resource.resourceId}`;

                    let allowedUserData: BasicUserData | null | undefined =
                        cache.get(userAccessCacheKey);

                    if (allowedUserData === undefined) {
                        allowedUserData = await isUserAllowedToAccessResource(
                            resourceSession.userSessionId,
                            resource,
                            resourceData.org
                        );

                        cache.set(userAccessCacheKey, allowedUserData, 5);
                    }

                    if (
                        allowedUserData !== null &&
                        allowedUserData !== undefined
                    ) {
                        logger.debug(
                            "Resource allowed because user session is valid"
                        );

                        logRequestAudit(
                            {
                                action: true,
                                reason: 107, // valid sso
                                resourceId: resource.resourceId,
                                orgId: resource.orgId,
                                location: ipCC,
                                user: {
                                    username: allowedUserData.username,
                                    userId: resourceSession.userId
                                }
                            },
                            parsedBody.data
                        );

                        return allowed(res, allowedUserData);
                    }
                }
            }
        }

        logger.debug("No more auth to check, resource not allowed");

        if (config.getRawConfig().app.log_failed_attempts) {
            logger.info(
                `Resource access not allowed. Resource ID: ${
                    resource.resourceId
                }. IP: ${clientIp}.`
            );
        }

        logger.debug(`Redirecting to login at ${redirectPath}`);

        logRequestAudit(
            {
                action: false,
                reason: 299, // no more auth methods
                resourceId: resource.resourceId,
                orgId: resource.orgId,
                location: ipCC
            },
            parsedBody.data
        );

        return notAllowed(res, redirectPath, resource.orgId);
    } catch (e) {
        console.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to verify session"
            )
        );
    }
}

function extractResourceSessionToken(
    sessions: Record<string, string>,
    ssl: boolean
) {
    const prefix = `${config.getRawConfig().server.session_cookie_name}${
        ssl ? "_s" : ""
    }`;

    const all: { cookieName: string; token: string; priority: number }[] = [];

    for (const [key, value] of Object.entries(sessions)) {
        const parts = key.split(".");
        const timestamp = parts[parts.length - 1];

        // check if string is only numbers
        if (!/^\d+$/.test(timestamp)) {
            continue;
        }

        // cookie name is the key without the timestamp
        const cookieName = key.slice(0, -timestamp.length - 1);

        if (cookieName === prefix) {
            all.push({
                cookieName,
                token: value,
                priority: parseInt(timestamp)
            });
        }
    }

    // sort by priority in desc order
    all.sort((a, b) => b.priority - a.priority);

    const latest = all[0];

    if (!latest) {
        return;
    }

    return latest.token;
}

async function notAllowed(
    res: Response,
    redirectPath?: string,
    orgId?: string
) {
    let loginPage: LoginPage | null = null;
    if (orgId) {
        const { tier } = await getOrgTierData(orgId); // returns null in oss
        if (tier === TierId.STANDARD) {
            loginPage = await getOrgLoginPage(orgId);
        }
    }

    let redirectUrl: string | undefined = undefined;
    if (redirectPath) {
        let endpoint: string;

        if (loginPage && loginPage.domainId && loginPage.fullDomain) {
            const secure = config
                .getRawConfig()
                .app.dashboard_url?.startsWith("https");
            const method = secure ? "https" : "http";
            endpoint = `${method}://${loginPage.fullDomain}`;
        } else {
            endpoint = config.getRawConfig().app.dashboard_url!;
        }
        redirectUrl = `${endpoint}${redirectPath}`;
    }

    const data = {
        data: { valid: false, redirectUrl },
        success: true,
        error: false,
        message: "Access denied",
        status: HttpCode.OK
    };
    logger.debug(JSON.stringify(data));
    return response<VerifyUserResponse>(res, data);
}

function allowed(res: Response, userData?: BasicUserData) {
    const data = {
        data:
            userData !== undefined && userData !== null
                ? { valid: true, ...userData }
                : { valid: true },
        success: true,
        error: false,
        message: "Access allowed",
        status: HttpCode.OK
    };
    return response<VerifyUserResponse>(res, data);
}

async function isUserAllowedToAccessResource(
    userSessionId: string,
    resource: Resource,
    org: Org
): Promise<BasicUserData | null> {
    const result = await getUserSessionWithUser(userSessionId);

    if (!result) {
        return null;
    }

    const { user, session } = result;

    if (!user || !session) {
        return null;
    }

    if (
        config.getRawConfig().flags?.require_email_verification &&
        !user.emailVerified
    ) {
        return null;
    }

    const userOrgRole = await getUserOrgRole(user.userId, resource.orgId);

    if (!userOrgRole) {
        return null;
    }

    const accessPolicy = await checkOrgAccessPolicy({
        org,
        user,
        session
    });
    if (!accessPolicy.allowed || accessPolicy.error) {
        logger.debug(`User not allowed by org access policy because`, {
            accessPolicy
        });
        return null;
    }

    const roleResourceAccess = await getRoleResourceAccess(
        resource.resourceId,
        userOrgRole.roleId
    );

    if (roleResourceAccess) {
        return {
            username: user.username,
            email: user.email,
            name: user.name
        };
    }

    const userResourceAccess = await getUserResourceAccess(
        user.userId,
        resource.resourceId
    );

    if (userResourceAccess) {
        return {
            username: user.username,
            email: user.email,
            name: user.name
        };
    }

    return null;
}

async function checkRules(
    resourceId: number,
    clientIp: string | undefined,
    path: string | undefined,
    ipCC?: string
): Promise<"ACCEPT" | "DROP" | "PASS" | undefined> {
    const ruleCacheKey = `rules:${resourceId}`;

    let rules: ResourceRule[] | undefined = cache.get(ruleCacheKey);

    if (!rules) {
        rules = await getResourceRules(resourceId);
        cache.set(ruleCacheKey, rules, 5);
    }

    if (rules.length === 0) {
        logger.debug("No rules found for resource", resourceId);
        return;
    }

    // sort rules by priority in ascending order
    rules = rules.sort((a, b) => a.priority - b.priority);

    for (const rule of rules) {
        if (!rule.enabled) {
            continue;
        }

        if (
            clientIp &&
            rule.match == "CIDR" &&
            isIpInCidr(clientIp, rule.value)
        ) {
            return rule.action as any;
        } else if (clientIp && rule.match == "IP" && clientIp == rule.value) {
            return rule.action as any;
        } else if (
            path &&
            rule.match == "PATH" &&
            isPathAllowed(rule.value, path)
        ) {
            return rule.action as any;
        } else if (
            clientIp &&
            rule.match == "COUNTRY" &&
            (await isIpInGeoIP(ipCC, rule.value))
        ) {
            return rule.action as any;
        }
    }

    return;
}

export function isPathAllowed(pattern: string, path: string): boolean {
    logger.debug(`\nMatching path "${path}" against pattern "${pattern}"`);

    // Normalize and split paths into segments
    const normalize = (p: string) => p.split("/").filter(Boolean);
    const patternParts = normalize(pattern);
    const pathParts = normalize(path);

    logger.debug(`Normalized pattern parts: [${patternParts.join(", ")}]`);
    logger.debug(`Normalized path parts: [${pathParts.join(", ")}]`);

    // Recursive function to try different wildcard matches
    function matchSegments(patternIndex: number, pathIndex: number): boolean {
        const indent = "  ".repeat(pathIndex); // Indent based on recursion depth
        const currentPatternPart = patternParts[patternIndex];
        const currentPathPart = pathParts[pathIndex];

        logger.debug(
            `${indent}Checking patternIndex=${patternIndex} (${currentPatternPart || "END"}) vs pathIndex=${pathIndex} (${currentPathPart || "END"})`
        );

        // If we've consumed all pattern parts, we should have consumed all path parts
        if (patternIndex >= patternParts.length) {
            const result = pathIndex >= pathParts.length;
            logger.debug(
                `${indent}Reached end of pattern, remaining path: ${pathParts.slice(pathIndex).join("/")} -> ${result}`
            );
            return result;
        }

        // If we've consumed all path parts but still have pattern parts
        if (pathIndex >= pathParts.length) {
            // The only way this can match is if all remaining pattern parts are wildcards
            const remainingPattern = patternParts.slice(patternIndex);
            const result = remainingPattern.every((p) => p === "*");
            logger.debug(
                `${indent}Reached end of path, remaining pattern: ${remainingPattern.join("/")} -> ${result}`
            );
            return result;
        }

        // For full segment wildcards, try consuming different numbers of path segments
        if (currentPatternPart === "*") {
            logger.debug(
                `${indent}Found wildcard at pattern index ${patternIndex}`
            );

            // Try consuming 0 segments (skip the wildcard)
            logger.debug(
                `${indent}Trying to skip wildcard (consume 0 segments)`
            );
            if (matchSegments(patternIndex + 1, pathIndex)) {
                logger.debug(
                    `${indent}Successfully matched by skipping wildcard`
                );
                return true;
            }

            // Try consuming current segment and recursively try rest
            logger.debug(
                `${indent}Trying to consume segment "${currentPathPart}" for wildcard`
            );
            if (matchSegments(patternIndex, pathIndex + 1)) {
                logger.debug(
                    `${indent}Successfully matched by consuming segment for wildcard`
                );
                return true;
            }

            logger.debug(`${indent}Failed to match wildcard`);
            return false;
        }

        // Check for in-segment wildcard (e.g., "prefix*" or "prefix*suffix")
        if (currentPatternPart.includes("*")) {
            logger.debug(
                `${indent}Found in-segment wildcard in "${currentPatternPart}"`
            );

            // Convert the pattern segment to a regex pattern
            const regexPattern = currentPatternPart
                .replace(/\*/g, ".*") // Replace * with .* for regex wildcard
                .replace(/\?/g, "."); // Replace ? with . for single character wildcard if needed

            const regex = new RegExp(`^${regexPattern}$`);

            if (regex.test(currentPathPart)) {
                logger.debug(
                    `${indent}Segment with wildcard matches: "${currentPatternPart}" matches "${currentPathPart}"`
                );
                return matchSegments(patternIndex + 1, pathIndex + 1);
            }

            logger.debug(
                `${indent}Segment with wildcard mismatch: "${currentPatternPart}" doesn't match "${currentPathPart}"`
            );
            return false;
        }

        // For regular segments, they must match exactly
        if (currentPatternPart !== currentPathPart) {
            logger.debug(
                `${indent}Segment mismatch: "${currentPatternPart}" != "${currentPathPart}"`
            );
            return false;
        }

        logger.debug(
            `${indent}Segments match: "${currentPatternPart}" = "${currentPathPart}"`
        );
        // Move to next segments in both pattern and path
        return matchSegments(patternIndex + 1, pathIndex + 1);
    }

    const result = matchSegments(0, 0);
    logger.debug(`Final result: ${result}`);
    return result;
}

async function isIpInGeoIP(
    ipCountryCode: string | undefined,
    checkCountryCode: string
): Promise<boolean> {
    if (checkCountryCode == "ALL") {
        return true;
    }

    return ipCountryCode?.toUpperCase() === checkCountryCode.toUpperCase();
}

async function getCountryCodeFromIp(ip: string): Promise<string | undefined> {
    const geoIpCacheKey = `geoip:${ip}`;

    let cachedCountryCode: string | undefined = cache.get(geoIpCacheKey);

    if (!cachedCountryCode) {
        cachedCountryCode = await getCountryCodeForIp(ip); // do it locally
        // Cache for longer since IP geolocation doesn't change frequently
        cache.set(geoIpCacheKey, cachedCountryCode, 300); // 5 minutes
    }

    return cachedCountryCode;
}

function extractBasicAuth(
    headers: Record<string, string> | undefined
): string | undefined {
    if (!headers || (!headers.authorization && !headers.Authorization)) {
        return;
    }

    const authHeader = headers.authorization || headers.Authorization;

    // Check if it's Basic Auth
    if (!authHeader.startsWith("Basic ")) {
        logger.debug("Authorization header is not Basic Auth");
        return;
    }

    try {
        // Extract the base64 encoded credentials
        return authHeader.slice("Basic ".length);
    } catch (error) {
        logger.debug("Basic Auth: Failed to decode credentials", {
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
}
