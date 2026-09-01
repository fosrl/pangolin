import {
    createResourceSession,
    serializeResourceSessionCookie,
    validateResourceSessionToken
} from "@server/auth/sessions/resource";
import { generateSessionToken } from "@server/auth/sessions/app";
import { verifyResourceAccessToken } from "@server/auth/verifyResourceAccessToken";
import {
    extractVirtualApiKeyCredential,
    verifyVirtualApiKey
} from "@server/auth/verifyVirtualApiKey";
import {
    getResourceByDomain,
    getResourceRules,
    getRoleResourceAccess,
    getUserResourceAccess,
    getOrgLoginPage,
    getUserSessionWithUser,
    getWhitelistEmail
} from "@server/db/queries/verifySessionQueries";
import { getUserOrgRoles } from "@server/lib/userOrgRoles";
import {
    LoginPage,
    Org,
    Resource,
    ResourceAccessToken,
    ResourceHeaderAuth,
    ResourceHeaderAuthExtendedCompatibility,
    ResourcePassword,
    ResourcePincode,
    ResourcePolicyPincode,
    ResourcePolicyPassword,
    ResourcePolicyHeaderAuth,
    ResourceRule,
    ResourceSession,
    db,
    resourceAccessToken,
    users
} from "@server/db";
import config from "@server/lib/config";
import { isIpInCidr, stripPortFromHost } from "@server/lib/ip";
import { isPathAllowed } from "@server/lib/pathMatch";
import { response } from "@server/lib/response";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { getCountryCodeForIp } from "@server/lib/geoip";
import { getAsnForIp } from "@server/lib/asn";
import {
    buildInferenceAuthClientError,
    type ClientErrorResponse
} from "@server/lib/aiGatewayAuthError";
import { resolveAiCapabilityFromPath } from "@server/lib/aiCapabilities";
import { verifyPassword } from "@server/auth/password";
import {
    checkOrgAccessPolicy,
    enforceResourceSessionLength
} from "#dynamic/lib/checkOrgAccessPolicy";
import { logRequestAudit } from "./logRequestAudit";
import { logAccessAudit } from "#dynamic/lib/logAccessAudit";
import { REGIONS } from "@server/db/regions";
import { localCache } from "#dynamic/lib/cache";
import { APP_VERSION } from "@server/lib/consts";
import { isSubscribed } from "#dynamic/lib/isSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { eq } from "drizzle-orm";

const verifyResourceSessionSchema = z.object({
    sessions: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    originalRequestURL: z.url(),
    scheme: z.string(),
    host: z.string(),
    path: z.string(),
    method: z.string(),
    tls: z.boolean(),
    requestIp: z.string().optional(),
    badgerVersion: z.string().optional()
});

export type VerifyResourceSessionSchema = z.infer<
    typeof verifyResourceSessionSchema
>;

type BasicUserData = {
    dontStripSession?: boolean;
    userId: string;
    username: string;
    email: string | null;
    name: string | null;
    role: string | null;
};

// Some auth methods (e.g. email whitelist) only know the remote email and
// have no associated user record to attach userId/username/name/role to.
type EmailOnlyUserData = {
    dontStripSession?: boolean;
    email: string;
};

export type { ClientErrorResponse };

export type VerifyUserResponse = {
    valid: boolean;
    headerAuthChallenged?: boolean;
    redirectUrl?: string;
    userData?: BasicUserData;
    pangolinVersion?: string;
    dontStripSession?: boolean;
    clientError?: ClientErrorResponse;
    // Set independently of userData so a manual virtual API key with no
    // associated user still gets attributed to the key that authenticated
    // the request (see the mode === "inference" branch below).
    virtualApiKeyId?: string;
};

function notAllowedWithClientError(
    res: Response,
    clientError: ClientErrorResponse
) {
    const data = {
        data: {
            valid: false,
            clientError,
            pangolinVersion: APP_VERSION
        },
        success: true,
        error: false,
        message: "Access denied",
        status: HttpCode.OK
    };
    return response<VerifyUserResponse>(res, data);
}

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
            query,
            badgerVersion
        } = parsedBody.data;

        // Extract HTTP Basic Auth credentials if present
        const clientHeaderAuth = extractBasicAuth(headers);

        const clientUserAgent =
            headers?.["user-agent"] || headers?.["User-Agent"];
        const clientIsBrowser = isBrowserUserAgent(clientUserAgent);

        const clientIp = requestIp
            ? stripPortFromHost(requestIp, badgerVersion)
            : undefined;

        logger.debug("Client IP:", { clientIp });

        const ipCC = clientIp
            ? await getCountryCodeFromIp(clientIp)
            : undefined;

        const ipAsn = clientIp ? await getAsnFromIp(clientIp) : undefined;

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
                  pincode: ResourcePincode | ResourcePolicyPincode | null;
                  password: ResourcePassword | ResourcePolicyPassword | null;
                  headerAuth:
                      | ResourceHeaderAuth
                      | ResourcePolicyHeaderAuth
                      | null;
                  headerAuthExtendedCompatibility: ResourceHeaderAuthExtendedCompatibility | null;
                  applyRules: boolean | null;
                  sso: boolean | null;
                  emailWhitelistEnabled: boolean | null;
                  org: Org;
              }
            | undefined = localCache.get(resourceCacheKey);

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
            localCache.set(resourceCacheKey, resourceData, 5);
        }

        const {
            resource,
            applyRules,
            sso,
            pincode,
            password,
            headerAuth,
            emailWhitelistEnabled,
            headerAuthExtendedCompatibility
        } = resourceData;

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

        const { blockAccess, mode } = resource;
        const dontStripSession = ["ssh", "rdp", "vnc", "inference"].includes(
            mode
        );

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
        if (applyRules) {
            const action = await checkRules(
                resource.resourceId,
                clientIp,
                path,
                ipCC,
                ipAsn
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

                return allowed(res, undefined, dontStripSession);
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
            !emailWhitelistEnabled &&
            !headerAuth
        ) {
            // Public inference always requires a virtual API key.
            if (mode !== "inference") {
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

                return allowed(res, undefined, dontStripSession);
            }
        }

        // Only offer a browser redirect to clients that can actually follow one and log in
        // (an interactive browser). Non-browser clients (curl, scripts, bots, etc.) just get
        // an unauthorized response from Badger instead of a login redirect URL.
        const redirectPath = clientIsBrowser
            ? `/auth/resource/${encodeURIComponent(
                  resource.resourceGuid
              )}?redirect=${encodeURIComponent(originalRequestURL)}`
            : undefined;

        // Virtual API keys for public inference resources (provider-style auth headers).
        // Session/SSO may authenticate users elsewhere (e.g. dashboard key pages), but
        // only a valid virtual API key is allowed through to the AI gateway.
        if (mode === "inference") {
            const vakCredential = extractVirtualApiKeyCredential(headers);
            if (vakCredential) {
                const {
                    valid,
                    error,
                    key,
                    userData: vakUserData
                } = await verifyVirtualApiKey({
                    credential: vakCredential,
                    resourceId: resource.resourceId,
                    orgId: resource.orgId
                });

                if (error) {
                    logger.debug("Virtual API key invalid: " + error);
                }

                if (!valid) {
                    if (config.getRawConfig().app.log_failed_attempts) {
                        logger.info(
                            `Virtual API key is invalid. Resource ID: ${resource.resourceId}. IP: ${clientIp}.`
                        );
                    }
                }

                if (valid && key) {
                    logRequestAudit(
                        {
                            action: true,
                            reason: 109, // valid virtual API key
                            resourceId: resource.resourceId,
                            orgId: resource.orgId,
                            location: ipCC,
                            ...(vakUserData
                                ? {
                                      user: {
                                          username: vakUserData.username,
                                          userId: vakUserData.userId
                                      }
                                  }
                                : {
                                      apiKey: {
                                          name: key.name,
                                          apiKeyId: key.virtualApiKeyId
                                      }
                                  }),
                            metadata: {
                                virtualApiKeyId: key.virtualApiKeyId,
                                virtualApiKeyKind: key.kind
                            }
                        },
                        parsedBody.data
                    );

                    return allowed(
                        res,
                        vakUserData,
                        dontStripSession,
                        key.virtualApiKeyId
                    );
                }
            }

            logRequestAudit(
                {
                    action: false,
                    reason: 299, // no more auth methods / VAK required
                    resourceId: resource.resourceId,
                    orgId: resource.orgId,
                    location: ipCC
                },
                parsedBody.data
            );

            // Browsers go to the resource auth / API key page. API clients get
            // a capability-shaped JSON auth error instead of a redirect.
            if (clientIsBrowser) {
                return notAllowed(res, redirectPath, resource.orgId);
            }

            return notAllowedWithClientError(
                res,
                buildInferenceAuthClientError(resolveAiCapabilityFromPath(path))
            );
        }

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
                return await allowAccessToken(
                    res,
                    resource,
                    tokenItem,
                    sessions,
                    dontStripSession,
                    parsedBody.data,
                    ipCC
                );
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
                return await allowAccessToken(
                    res,
                    resource,
                    tokenItem,
                    sessions,
                    dontStripSession,
                    parsedBody.data,
                    ipCC
                );
            }
        }

        // check for HTTP Basic Auth header
        const clientHeaderAuthKey = `headerAuth:${resource.resourceId}:${clientHeaderAuth}`;
        if (headerAuth && clientHeaderAuth) {
            if (localCache.get(clientHeaderAuthKey)) {
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

                return allowed(res, undefined, dontStripSession);
            } else if (
                await verifyPassword(
                    clientHeaderAuth,
                    headerAuth.headerAuthHash
                )
            ) {
                localCache.set(clientHeaderAuthKey, clientHeaderAuth, 5);
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

                return allowed(res, undefined, dontStripSession);
            }

            if (
                // we dont want to redirect if this is the only auth method and we did not pass here
                !sso &&
                !pincode &&
                !password &&
                !emailWhitelistEnabled &&
                !headerAuthExtendedCompatibility?.extendedCompatibilityIsActivated
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
                !emailWhitelistEnabled &&
                !headerAuthExtendedCompatibility?.extendedCompatibilityIsActivated
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
            let resourceSession: ResourceSession | null | undefined =
                localCache.get(sessionCacheKey);

            if (!resourceSession) {
                const result = await validateResourceSessionToken(
                    resourceSessionToken,
                    resource.resourceId
                );

                resourceSession = result?.resourceSession;
                localCache.set(sessionCacheKey, resourceSession, 5);
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
                // only run this check if not SSO session; SSO session length is checked later
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

                if (
                    pincode &&
                    (resourceSession.pincodeId ||
                        resourceSession.policyPincodeId)
                ) {
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

                    return allowed(res, undefined, dontStripSession);
                }

                if (
                    password &&
                    (resourceSession.passwordId ||
                        resourceSession.policyPasswordId)
                ) {
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

                    return allowed(res, undefined, dontStripSession);
                }

                if (
                    emailWhitelistEnabled &&
                    (resourceSession.whitelistId ||
                        resourceSession.policyWhitelistId)
                ) {
                    logger.debug(
                        "Resource allowed because whitelist session is valid"
                    );

                    const whitelistCacheKey = `whitelistEmail:${resourceSession.whitelistId}:${resourceSession.policyWhitelistId}`;
                    let whitelistEmail: string | null | undefined =
                        localCache.get(whitelistCacheKey);

                    if (whitelistEmail === undefined) {
                        whitelistEmail = await getWhitelistEmail(
                            resourceSession.whitelistId,
                            resourceSession.policyWhitelistId
                        );
                        localCache.set(whitelistCacheKey, whitelistEmail, 12);
                    }

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

                    return allowed(
                        res,
                        whitelistEmail ? { email: whitelistEmail } : undefined,
                        dontStripSession
                    );
                }

                if (resourceSession.accessTokenId) {
                    const [tokenItem] = await db
                        .select()
                        .from(resourceAccessToken)
                        .where(
                            eq(
                                resourceAccessToken.accessTokenId,
                                resourceSession.accessTokenId
                            )
                        )
                        .limit(1);

                    if (
                        tokenItem &&
                        tokenItem.resourceId === resource.resourceId
                    ) {
                        logger.debug(
                            "Resource allowed because access token session is valid"
                        );

                        const userData = await getAccessTokenUserData(
                            tokenItem,
                            resource.orgId
                        );

                        logAccessTokenRequestAudit(
                            {
                                resourceId: resource.resourceId,
                                orgId: resource.orgId,
                                location: ipCC,
                                accessTokenId: resourceSession.accessTokenId,
                                tokenTitle: tokenItem.title ?? null,
                                userData
                            },
                            parsedBody.data
                        );

                        return allowed(res, userData, dontStripSession);
                    }

                    logger.debug(
                        "Access token session does not belong to this resource"
                    );
                }

                if (resourceSession.userSessionId && sso) {
                    const userAccessCacheKey = `userAccess:${
                        resourceSession.userSessionId
                    }:${resource.resourceId}`;

                    let allowedUserData: BasicUserData | null | undefined =
                        localCache.get(userAccessCacheKey);

                    if (allowedUserData === undefined) {
                        allowedUserData = await isUserAllowedToAccessResource(
                            resourceSession.userSessionId,
                            resource,
                            resourceData.org
                        );

                        // this is query intensive so let it cache a little longer
                        localCache.set(userAccessCacheKey, allowedUserData, 12);
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
                                    userId: allowedUserData.userId
                                }
                            },
                            parsedBody.data
                        );

                        return allowed(
                            res,
                            { ...allowedUserData, dontStripSession },
                            dontStripSession
                        );
                    }
                }
            }
        }

        // If headerAuthExtendedCompatibility is activated but no clientHeaderAuth provided, force client to challenge.
        // Skip the challenge when SSO is also enabled so browsers get the SSO redirect instead of a native Basic
        // Auth dialog; clients that proactively send Authorization: Basic are still accepted above.
        if (
            headerAuthExtendedCompatibility &&
            headerAuthExtendedCompatibility.extendedCompatibilityIsActivated &&
            !clientHeaderAuth &&
            !sso
        ) {
            return headerAuthChallenged(res, redirectPath, resource.orgId);
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
        const subscribed = await isSubscribed(
            // this is fine because the org login page is only a saas feature
            orgId,
            tierMatrix.loginPageDomain
        );
        if (subscribed) {
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
        data: { valid: false, redirectUrl, pangolinVersion: APP_VERSION },
        success: true,
        error: false,
        message: "Access denied",
        status: HttpCode.OK
    };
    // logger.debug(JSON.stringify(data));
    return response<VerifyUserResponse>(res, data);
}

function allowed(
    res: Response,
    userData?: BasicUserData | EmailOnlyUserData,
    dontStripSession?: boolean,
    virtualApiKeyId?: string
) {
    const baseData =
        userData !== undefined && userData !== null
            ? { valid: true, ...userData, pangolinVersion: APP_VERSION }
            : { valid: true, pangolinVersion: APP_VERSION };
    const withVirtualApiKey = virtualApiKeyId
        ? { ...baseData, virtualApiKeyId }
        : baseData;
    const data = {
        data: dontStripSession
            ? { ...withVirtualApiKey, dontStripSession: true }
            : withVirtualApiKey,
        success: true,
        error: false,
        message: "Access allowed",
        status: HttpCode.OK
    };
    logger.debug("Access allowed, response data:", data);
    return response<VerifyUserResponse>(res, data);
}

async function allowAccessToken(
    res: Response,
    resource: Resource,
    tokenItem: ResourceAccessToken,
    sessions: Record<string, string> | undefined,
    dontStripSession: boolean | undefined,
    auditBody: VerifyResourceSessionSchema,
    location?: string
) {
    const userData = await getAccessTokenUserData(tokenItem, resource.orgId);

    logAccessTokenRequestAudit(
        {
            resourceId: resource.resourceId,
            orgId: resource.orgId,
            location,
            accessTokenId: tokenItem.accessTokenId,
            tokenTitle: tokenItem.title,
            userData
        },
        auditBody
    );

    if (!tokenItem.persistSession) {
        logAccessTokenAccessAudit(tokenItem, resource, userData, auditBody);
        return allowed(res, userData, dontStripSession);
    }

    const resourceSessionToken = extractResourceSessionToken(
        sessions ?? {},
        resource.ssl
    );

    if (resourceSessionToken) {
        const sessionCacheKey = `session:${resourceSessionToken}`;
        let resourceSession: ResourceSession | null | undefined =
            localCache.get(sessionCacheKey);

        if (!resourceSession) {
            const result = await validateResourceSessionToken(
                resourceSessionToken,
                resource.resourceId
            );
            resourceSession = result?.resourceSession;
            localCache.set(sessionCacheKey, resourceSession, 5);
        }

        if (
            resourceSession &&
            !resourceSession.isRequestToken &&
            resourceSession.accessTokenId === tokenItem.accessTokenId
        ) {
            logger.debug(
                "Resource allowed because existing access token session is valid"
            );
            return allowed(res, userData, dontStripSession);
        }
    }

    logAccessTokenAccessAudit(tokenItem, resource, userData, auditBody);
    return await createAccessTokenSession(res, resource, tokenItem, userData);
}

async function createAccessTokenSession(
    res: Response,
    resource: Resource,
    tokenItem: ResourceAccessToken,
    userData?: BasicUserData
) {
    const token = generateSessionToken();
    const sess = await createResourceSession({
        resourceId: resource.resourceId,
        token,
        accessTokenId: tokenItem.accessTokenId,
        sessionLength: tokenItem.sessionLength,
        expiresAt: tokenItem.expiresAt,
        doNotExtend: tokenItem.expiresAt ? true : false
    });
    const cookieName = config.getRawConfig().server.session_cookie_name;
    const cookie = serializeResourceSessionCookie(
        cookieName,
        resource.fullDomain!,
        token,
        !resource.ssl,
        new Date(sess.expiresAt)
    );
    res.appendHeader("Set-Cookie", cookie);
    logger.debug("Access token is valid, creating new session");
    return allowed(res, userData);
}

async function getAccessTokenUserData(
    tokenItem: ResourceAccessToken,
    orgId: string
): Promise<BasicUserData | undefined> {
    if (!tokenItem.userId) {
        return undefined;
    }

    const cacheKey = `accessTokenUser:${tokenItem.userId}:${orgId}`;
    const cached = localCache.get(cacheKey) as BasicUserData | null | undefined;
    if (cached !== undefined) {
        return cached ?? undefined;
    }

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, tokenItem.userId))
        .limit(1);

    if (!user) {
        localCache.set(cacheKey, null, 5);
        return undefined;
    }

    const userOrgRoles = await getUserOrgRoles(user.userId, orgId);
    const userData: BasicUserData = {
        userId: user.userId,
        username: user.username,
        email: user.email,
        name: user.name,
        role: userOrgRoles.map((r) => r.roleName).join(", ") || null
    };

    localCache.set(cacheKey, userData, 12);
    return userData;
}

function logAccessTokenRequestAudit(
    data: {
        resourceId: number;
        orgId: string;
        location?: string;
        accessTokenId: string;
        tokenTitle: string | null;
        userData?: BasicUserData;
    },
    body: VerifyResourceSessionSchema
) {
    if (data.userData) {
        logRequestAudit(
            {
                action: true,
                reason: 102, // valid access token
                resourceId: data.resourceId,
                orgId: data.orgId,
                location: data.location,
                user: {
                    username: data.userData.username,
                    userId: data.userData.userId
                },
                metadata: {
                    accessTokenId: data.accessTokenId,
                    accessTokenTitle: data.tokenTitle
                }
            },
            body
        );
        return;
    }

    logRequestAudit(
        {
            action: true,
            reason: 102, // valid access token
            resourceId: data.resourceId,
            orgId: data.orgId,
            location: data.location,
            apiKey: {
                name: data.tokenTitle,
                apiKeyId: data.accessTokenId
            }
        },
        body
    );
}

function logAccessTokenAccessAudit(
    tokenItem: ResourceAccessToken,
    resource: Resource,
    userData: BasicUserData | undefined,
    body: VerifyResourceSessionSchema
) {
    const userAgent =
        body.headers?.["user-agent"] || body.headers?.["User-Agent"];

    if (userData) {
        logAccessAudit({
            orgId: resource.orgId,
            resourceId: resource.resourceId,
            action: true,
            type: "accessToken",
            user: {
                username: userData.username,
                userId: userData.userId
            },
            metadata: {
                accessTokenId: tokenItem.accessTokenId,
                accessTokenTitle: tokenItem.title
            },
            userAgent,
            requestIp: body.requestIp
        });
        return;
    }

    logAccessAudit({
        orgId: resource.orgId,
        resourceId: resource.resourceId,
        action: true,
        type: "accessToken",
        apiKey: {
            name: tokenItem.title,
            apiKeyId: tokenItem.accessTokenId
        },
        userAgent,
        requestIp: body.requestIp
    });
}

async function headerAuthChallenged(
    res: Response,
    redirectPath?: string,
    orgId?: string
) {
    let loginPage: LoginPage | null = null;
    if (orgId) {
        const subscribed = await isSubscribed(
            orgId,
            tierMatrix.loginPageDomain
        ); // this is fine because the org login page is only a saas feature
        if (subscribed) {
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
        data: {
            headerAuthChallenged: true,
            valid: false,
            redirectUrl,
            pangolinVersion: APP_VERSION
        },
        success: true,
        error: false,
        message: "Access denied",
        status: HttpCode.OK
    };
    // logger.debug(JSON.stringify(data));
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

    const userOrgRoles = await getUserOrgRoles(user.userId, resource.orgId);

    if (!userOrgRoles.length) {
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
        userOrgRoles.map((r) => r.roleId)
    );
    if (roleResourceAccess && roleResourceAccess.length > 0) {
        return {
            userId: user.userId,
            username: user.username,
            email: user.email,
            name: user.name,
            role: userOrgRoles.map((r) => r.roleName).join(", ")
        };
    }

    const userResourceAccess = await getUserResourceAccess(
        user.userId,
        resource.resourceId
    );

    if (userResourceAccess) {
        return {
            userId: user.userId,
            username: user.username,
            email: user.email,
            name: user.name,
            role: userOrgRoles.map((r) => r.roleName).join(", ")
        };
    }

    return null;
}

async function checkRules(
    resourceId: number,
    clientIp: string | undefined,
    path: string | undefined,
    ipCC?: string,
    ipAsn?: number
): Promise<"ACCEPT" | "DROP" | "PASS" | undefined> {
    const ruleCacheKey = `rules:${resourceId}`;

    let rules: ResourceRule[] | undefined = localCache.get(ruleCacheKey);

    if (!rules) {
        rules = await getResourceRules(resourceId);
        localCache.set(ruleCacheKey, rules, 5);
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
            (rule.match === "COUNTRY" || rule.match === "COUNTRY_IS_NOT")
        ) {
            // COUNTRY=ALL should not affect local/private/CGNAT addresses.
            if (
                rule.value.toUpperCase() === "ALL" &&
                isLocalOrCarrierGradeNatIp(clientIp)
            ) {
                continue;
            }

            const inCountry = await isIpInGeoIP(ipCC, rule.value);
            const matched = rule.match === "COUNTRY" ? inCountry : !inCountry;

            if (matched) {
                return rule.action as any;
            }
        } else if (clientIp && rule.match == "ASN") {
            // ASN=ALL/AS0 should not affect local/private/CGNAT addresses.
            if (
                (rule.value.toUpperCase() === "ALL" ||
                    rule.value.toUpperCase() === "AS0") &&
                isLocalOrCarrierGradeNatIp(clientIp)
            ) {
                continue;
            }

            if (await isIpInAsn(ipAsn, rule.value)) {
                return rule.action as any;
            }
        } else if (
            clientIp &&
            rule.match == "REGION" &&
            (await isIpInRegion(ipCC, rule.value))
        ) {
            return rule.action as any;
        }
    }

    return;
}

export { isPathAllowed };

async function isIpInGeoIP(
    ipCountryCode: string | undefined,
    checkCountryCode: string
): Promise<boolean> {
    if (checkCountryCode == "ALL") {
        return true;
    }

    return ipCountryCode?.toUpperCase() === checkCountryCode.toUpperCase();
}

function isLocalOrCarrierGradeNatIp(ip: string): boolean {
    const localAndCgnatCidrs = [
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "::1/128",
        "fc00::/7",
        "fe80::/10"
    ];

    try {
        return localAndCgnatCidrs.some((cidr) => isIpInCidr(ip, cidr));
    } catch {
        return false;
    }
}

async function isIpInAsn(
    ipAsn: number | undefined,
    checkAsn: string
): Promise<boolean> {
    // Handle "ALL" special case
    if (checkAsn === "ALL" || checkAsn === "AS0") {
        return true;
    }

    if (!ipAsn) {
        return false;
    }

    // Normalize the check ASN - remove "AS" prefix if present and convert to number
    const normalizedCheckAsn = checkAsn.toUpperCase().replace(/^AS/, "");
    const checkAsnNumber = parseInt(normalizedCheckAsn, 10);

    if (isNaN(checkAsnNumber)) {
        logger.warn(`Invalid ASN format in rule: ${checkAsn}`);
        return false;
    }

    const match = ipAsn === checkAsnNumber;
    logger.debug(
        `ASN check: IP ASN ${ipAsn} ${match ? "matches" : "does not match"} rule ASN ${checkAsnNumber}`
    );

    return match;
}

export async function isIpInRegion(
    ipCountryCode: string | undefined,
    checkRegionCode: string
): Promise<boolean> {
    if (!ipCountryCode) {
        return false;
    }

    const upperCode = ipCountryCode.toUpperCase();

    for (const region of REGIONS) {
        // Check if it's a top-level region (continent)
        if (region.id === checkRegionCode) {
            for (const subregion of region.includes) {
                if (subregion.countries.includes(upperCode)) {
                    logger.debug(
                        `Country ${upperCode} is in region ${region.id} (${region.name})`
                    );
                    return true;
                }
            }
            logger.debug(
                `Country ${upperCode} is not in region ${region.id} (${region.name})`
            );
            return false;
        }

        // Check subregions
        for (const subregion of region.includes) {
            if (subregion.id === checkRegionCode) {
                if (subregion.countries.includes(upperCode)) {
                    logger.debug(
                        `Country ${upperCode} is in region ${subregion.id} (${subregion.name})`
                    );
                    return true;
                }
                logger.debug(
                    `Country ${upperCode} is not in region ${subregion.id} (${subregion.name})`
                );
                return false;
            }
        }
    }

    return false;
}

async function getAsnFromIp(ip: string): Promise<number | undefined> {
    const asnCacheKey = `asn:${ip}`;

    let cachedAsn: number | undefined = localCache.get(asnCacheKey);

    if (!cachedAsn) {
        cachedAsn = await getAsnForIp(ip); // do it locally
        // Cache for longer since IP ASN doesn't change frequently
        if (cachedAsn) {
            localCache.set(asnCacheKey, cachedAsn, 300); // 5 minutes
        }
    }

    return cachedAsn;
}

async function getCountryCodeFromIp(ip: string): Promise<string | undefined> {
    const geoIpCacheKey = `geoip:${ip}`;

    let cachedCountryCode: string | undefined = localCache.get(geoIpCacheKey);

    if (!cachedCountryCode) {
        cachedCountryCode = await getCountryCodeForIp(ip); // do it locally
        // Only cache successful lookups to avoid filling cache with undefined values
        if (cachedCountryCode) {
            // Cache for longer since IP geolocation doesn't change frequently
            localCache.set(geoIpCacheKey, cachedCountryCode, 300); // 5 minutes
        }
    }

    return cachedCountryCode;
}

// Permissive by default: only reject known non-browser clients or a missing
// User-Agent (real browsers always send one). This avoids blocking real
// browsers whose UA string doesn't match a hardcoded allow-list.
const NON_BROWSER_USER_AGENT_PATTERNS = [
    /curl/,
    /wget/,
    /python-requests/,
    /python-urllib/,
    /go-http-client/,
    /okhttp/,
    /axios/,
    /node-fetch/,
    /postmanruntime/,
    /insomnia/,
    /libwww-perl/,
    /java\//,
    /ruby/,
    /php/,
    /bot/,
    /spider/,
    /crawler/,
    /headlesschrome/,
    /phantomjs/,
    /httpclient/,
    /prometheus/,
    /go-resty/,
    /apache-httpclient/,
    /scrapy/
];

function isBrowserUserAgent(userAgent: string | undefined): boolean {
    if (!userAgent) {
        return false;
    }

    const ua = userAgent.toLowerCase();

    return !NON_BROWSER_USER_AGENT_PATTERNS.some((pattern) => pattern.test(ua));
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
