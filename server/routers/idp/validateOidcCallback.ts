import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, Org, primaryDb } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    idp,
    idpOidcConfig,
    idpOrg,
    orgs,
    Role,
    roles,
    userOrgRoles,
    userOrgs,
    users
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import * as client from "openid-client";
import jmespath from "jmespath";
import jsonwebtoken from "jsonwebtoken";
import config from "@server/lib/config";
import {
    createSession,
    generateId,
    generateSessionToken,
    serializeSessionCookie
} from "@server/auth/sessions/app";
import { decrypt } from "@server/lib/crypto";
import { UserType } from "@server/types/UserTypes";
import { LimitId } from "@server/lib/billing";
import { usageService } from "@server/lib/billing/usageService";
import { build } from "@server/build";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { isSubscribed } from "#dynamic/lib/isSubscribed";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { assignUserToOrg, removeUserFromOrg } from "@server/lib/userOrg";
import { unwrapRoleMapping } from "@app/lib/idpRoleMapping";
import { ResponseBodyError } from "openid-client";
import { pullEnv } from "@/lib/pullEnv";

const ensureTrailingSlash = (url: string): string => {
    return url;
};

const paramsSchema = z
    .object({
        idpId: z.coerce.number<number>()
    })
    .strict();

const bodySchema = z.object({
    code: z.string().nonempty(),
    state: z.string().nonempty(),
    storedState: z.string().nonempty(),
    issuer: z.string().optional(),
});

const querySchema = z.object({
    loginPageId: z.coerce.number<number>().optional()
});

export type ValidateOidcUrlCallbackResponse = {
    redirectUrl: string;
};

function buildCallbackUrl(
    idpId: number,
    code: string,
    state: string,
    scopes: string,
    issuer: string | undefined
): URL {
    const env = pullEnv();
    const url = new URL(
        `${env.app.dashboardUrl}/auth/idp/${idpId}/oidc/callback`
    );
    url.searchParams.append("code", code);
    url.searchParams.append("state", state);
    url.searchParams.append("scope", scopes);
    if (issuer) {
        url.searchParams.append("iss", issuer ?? "");
    }
    return url;
}

export async function validateOidcCallback(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { idpId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { loginPageId } = parsedQuery.data;

        const { storedState, code, state: expectedState, issuer } = parsedBody.data;

        const [existingIdp] = await db
            .select()
            .from(idp)
            .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
            .where(and(eq(idp.type, "oidc"), eq(idp.idpId, idpId)));

        if (!existingIdp) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "IdP not found for the organization"
                )
            );
        }

        const key = config.getRawConfig().server.secret!;

        const decryptedClientId = decrypt(
            existingIdp.idpOidcConfig.clientId,
            key
        );
        const decryptedClientSecret = decrypt(
            existingIdp.idpOidcConfig.clientSecret,
            key
        );

        const authConfig: client.Configuration = await client.discovery(
            new URL(existingIdp.idpOidcConfig.discoveryUrl),
            decryptedClientId,
            decryptedClientSecret
        );

        // noinspection JSVoidFunctionReturnValueUsed
        const statePayload = jsonwebtoken.verify(
            storedState,
            config.getRawConfig().server.secret!,
            function (err, decoded) {
                if (err) {
                    logger.error("Error verifying state JWT", { err });
                    return next(
                        createHttpError(
                            HttpCode.BAD_REQUEST,
                            "Invalid state JWT"
                        )
                    );
                }
                return decoded;
            }
        );

        const stateObj = z
            .object({
                redirectUrl: z.string(),
                state: z.string(),
                nonce: z.string(),
                codeVerifier: z.string()
            })
            .safeParse(statePayload);

        if (!stateObj.success) {
            logger.error("Error parsing state JWT");
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(stateObj.error).toString()
                )
            );
        }

        const {
            codeVerifier,
            state,
            nonce,
            redirectUrl: postAuthRedirectUrl
        } = stateObj.data;

        if (state !== expectedState) {
            logger.error("State mismatch", { expectedState, state });
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "State mismatch")
            );
        }

        logger.debug("State verified", {
            expectedState,
            state
        });

        // openid-client parses the callback url to validate the exchange
        const currentUrl = buildCallbackUrl(
            idpId,
            code,
            state,
            existingIdp.idpOidcConfig.scopes,
            issuer,
        );
        logger.debug("URL", {
            currentUrl,
        });

        let tokens: client.TokenEndpointResponse;
        try {
            tokens = await client.authorizationCodeGrant(
                authConfig,
                currentUrl,
                {
                    pkceCodeVerifier: codeVerifier,
                    expectedState: state,
                    expectedNonce: nonce,
                }
            );
        } catch (err: unknown) {
            if (err instanceof client.ClientError) {
                logger.warn("Encountered client error", {
                    error: err.code,
                    cause: err.cause,
                    name: err.name,
                    message: err.message,
                    stack: err.stack,
                });
                return next(createHttpError(HttpCode.BAD_GATEWAY,
                    err.code || "unknown error"));
            }

            if (err instanceof ResponseBodyError) {
                logger.warn("Encountered error in response body", {
                    error: err.code,
                    cause: err.cause,
                    name: err.name,
                    message: err.message,
                    stack: err.stack,
                    resp: err.response.body
                });
                return next(createHttpError(HttpCode.INTERNAL_SERVER_ERROR, err.code || "unknown error"));
            }

            throw err;
        }

        logger.debug("Token endpoint response", { tokens });

        // @ts-ignore
        const claims = tokens.claims()!;
        logger.debug("ID token claims", { claims });

        const userInfo = await client.fetchUserInfo(
            authConfig,
            tokens.access_token,
            claims.sub,
        );

        logger.debug("userinfo response", { userInfo });

        let userIdentifier = jmespath.search(
            claims,
            existingIdp.idpOidcConfig.identifierPath
        );

        if (!userIdentifier) {
            userIdentifier = userInfo[existingIdp.idpOidcConfig.identifierPath];
        }

        if (!userIdentifier) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User identifier not found in the ID token"
                )
            );
        }

        userIdentifier = userIdentifier.toLowerCase();

        logger.debug("User identifier", { userIdentifier });

        let email = null;
        if (existingIdp.idpOidcConfig.emailPath) {
            email =
                jmespath.search(claims, existingIdp.idpOidcConfig.emailPath) ??
                userInfo.email;
        }

        let name = null;
        if (existingIdp.idpOidcConfig.namePath) {
            name =
                jmespath.search(
                    claims,
                    existingIdp.idpOidcConfig.namePath || ""
                ) ?? userInfo.name;
        }

        logger.debug("User email", { email });
        logger.debug("User name", { name });

        if (email) {
            email = email.toLowerCase();
        }

        const [existingUser] = await db
            .select()
            .from(users)
            .where(
                and(
                    eq(users.username, userIdentifier),
                    eq(users.idpId, existingIdp.idp.idpId)
                )
            );

        if (existingIdp.idp.autoProvision) {
            let allOrgs: Org[] = [];

            if (build === "saas") {
                const idpOrgs = await db
                    .select()
                    .from(idpOrg)
                    .where(eq(idpOrg.idpId, existingIdp.idp.idpId))
                    .innerJoin(orgs, eq(orgs.orgId, idpOrg.orgId));
                allOrgs = idpOrgs.map((o) => o.orgs);
            } else {
                allOrgs = await db.select().from(orgs);
            }

            const defaultRoleMapping = existingIdp.idp.defaultRoleMapping;
            const defaultOrgMapping = existingIdp.idp.defaultOrgMapping;

            const userOrgInfo: { orgId: string; roleIds: number[] }[] = [];
            for (const org of allOrgs) {
                const [idpOrgRes] = await db
                    .select()
                    .from(idpOrg)
                    .where(
                        and(
                            eq(idpOrg.idpId, existingIdp.idp.idpId),
                            eq(idpOrg.orgId, org.orgId)
                        )
                    );

                const orgMapping = idpOrgRes?.orgMapping || defaultOrgMapping;
                const hydratedOrgMapping = hydrateOrgMapping(
                    orgMapping,
                    org.orgId
                );

                if (hydratedOrgMapping) {
                    logger.debug("Hydrated Org Mapping", {
                        hydratedOrgMapping
                    });
                    const orgId = jmespath.search(claims, hydratedOrgMapping);
                    logger.debug("Extraced Org ID", { orgId });
                    if (orgId !== true && orgId !== org.orgId) {
                        // user not allowed to access this org
                        continue;
                    }
                }

                // user could be allowed in this org, now find the role

                const roleMapping =
                    idpOrgRes?.roleMapping || defaultRoleMapping;
                if (roleMapping) {
                    logger.debug("Role Mapping", { roleMapping });
                    const roleMappingJmes =
                        unwrapRoleMapping(roleMapping).evaluationExpression;
                    const roleMappingResult = jmespath.search(
                        claims,
                        roleMappingJmes
                    );
                    const roleNames =
                        normalizeRoleMappingResult(roleMappingResult);

                    const supportsMultiRole = await isLicensedOrSubscribed(
                        org.orgId,
                        tierMatrix.fullRbac
                    );
                    const effectiveRoleNames = supportsMultiRole
                        ? roleNames
                        : roleNames.slice(0, 1);

                    if (!effectiveRoleNames.length) {
                        logger.error("Role mapping returned no valid roles", {
                            roleMappingResult
                        });
                        continue;
                    }

                    const roleRes = await db
                        .select()
                        .from(roles)
                        .where(
                            and(
                                eq(roles.orgId, org.orgId),
                                inArray(roles.name, effectiveRoleNames)
                            )
                        );

                    if (!roleRes.length) {
                        logger.error("No mapped roles found in organization", {
                            orgId: org.orgId,
                            roleNames: effectiveRoleNames
                        });
                        continue;
                    }

                    const roleIds = [...new Set(roleRes.map((r) => r.roleId))];

                    userOrgInfo.push({
                        orgId: org.orgId,
                        roleIds
                    });
                }
            }

            // These are the orgs that the user should be provisioned into based on the IdP mappings and the token claims
            logger.debug("User org info", { userOrgInfo });

            let existingUserId = existingUser?.userId;

            if (!userOrgInfo.length) {
                if (existingUser) {
                    // get existing user orgs
                    const existingUserOrgs = await db
                        .select()
                        .from(userOrgs)
                        .where(
                            and(
                                eq(userOrgs.userId, existingUser.userId),
                                eq(userOrgs.autoProvisioned, false)
                            )
                        );

                    if (!existingUserOrgs.length) {
                        // delete all auto-provisioned user orgs
                        const autoProvisionedUserOrgs = await db
                            .select()
                            .from(userOrgs)
                            .where(
                                and(
                                    eq(userOrgs.userId, existingUser.userId),
                                    eq(userOrgs.autoProvisioned, true)
                                )
                            );
                        const orgIdsToRemove = autoProvisionedUserOrgs.map(
                            (uo) => uo.orgId
                        );
                        if (orgIdsToRemove.length > 0) {
                            const orgsToRemove = await db
                                .select()
                                .from(orgs)
                                .where(inArray(orgs.orgId, orgIdsToRemove));
                            for (const org of orgsToRemove) {
                                await removeUserFromOrg(
                                    org,
                                    existingUser.userId,
                                    db
                                );
                            }
                        }

                        calculateUserClientsForOrgs(existingUser.userId).catch(
                            (err) => {
                                logger.error(
                                    "Error calculating user clients after removing all orgs for user with no valid IdP mappings",
                                    { error: err }
                                );
                            }
                        );

                        return next(
                            createHttpError(
                                HttpCode.UNAUTHORIZED,
                                `No policies matched for ${userIdentifier}. This user must be added to an organization before logging in.`
                            )
                        );
                    }
                } else {
                    // no orgs to provision and user doesn't exist
                    return next(
                        createHttpError(
                            HttpCode.UNAUTHORIZED,
                            `No policies matched for ${userIdentifier}. This user must be added to an organization before logging in.`
                        )
                    );
                }
            }

            const orgUserCounts: { orgId: string; userCount: number }[] = [];

            let userId = existingUser?.userId;
            // sync the user with the orgs and roles
            await db.transaction(async (trx) => {
                // create user if not exists
                if (!existingUser) {
                    userId = generateId(15);

                    await trx.insert(users).values({
                        userId,
                        username: userIdentifier,
                        email: email || null,
                        name: name || null,
                        type: UserType.OIDC,
                        idpId: existingIdp.idp.idpId,
                        emailVerified: true, // OIDC users are always verified
                        dateCreated: new Date().toISOString()
                    });
                } else {
                    // set the name and email
                    await trx
                        .update(users)
                        .set({
                            username: userIdentifier,
                            email: email || null,
                            name: name || null
                        })
                        .where(eq(users.userId, userId!));
                }

                existingUserId = userId;

                // get all current user orgs
                const currentUserOrgs = await trx
                    .select()
                    .from(userOrgs)
                    .where(eq(userOrgs.userId, userId!));

                // Filter to only auto-provisioned orgs for CRUD operations
                const autoProvisionedOrgs = currentUserOrgs.filter(
                    (org) => org.autoProvisioned === true
                );

                // Delete auto-provisioned orgs that are no longer valid
                const orgsToDelete = autoProvisionedOrgs.filter(
                    (currentOrg) =>
                        !userOrgInfo.some(
                            (newOrg) => newOrg.orgId === currentOrg.orgId
                        )
                );

                if (orgsToDelete.length > 0) {
                    const orgIdsToRemove = orgsToDelete.map((org) => org.orgId);
                    const fullOrgsToRemove = await trx
                        .select()
                        .from(orgs)
                        .where(inArray(orgs.orgId, orgIdsToRemove));
                    for (const org of fullOrgsToRemove) {
                        await removeUserFromOrg(org, userId!, trx);
                    }
                }

                // Sync roles 1:1 with IdP policy for existing auto-provisioned orgs
                for (const currentOrg of autoProvisionedOrgs) {
                    const newRole = userOrgInfo.find(
                        (newOrg) => newOrg.orgId === currentOrg.orgId
                    );
                    if (!newRole) continue;

                    await trx
                        .delete(userOrgRoles)
                        .where(
                            and(
                                eq(userOrgRoles.userId, userId!),
                                eq(userOrgRoles.orgId, currentOrg.orgId)
                            )
                        );

                    for (const roleId of newRole.roleIds) {
                        await trx.insert(userOrgRoles).values({
                            userId: userId!,
                            orgId: currentOrg.orgId,
                            roleId
                        });
                    }
                }

                // Add new orgs that don't exist yet (these will be auto-provisioned)
                const orgsToAdd = userOrgInfo.filter(
                    (newOrg) =>
                        !currentUserOrgs.some(
                            (currentOrg) => currentOrg.orgId === newOrg.orgId
                        )
                );

                if (orgsToAdd.length > 0) {
                    for (const org of orgsToAdd) {
                        if (org.roleIds.length === 0) {
                            continue;
                        }

                        const [fullOrg] = await trx
                            .select()
                            .from(orgs)
                            .where(eq(orgs.orgId, org.orgId));
                        if (fullOrg) {
                            await assignUserToOrg(
                                fullOrg,
                                {
                                    orgId: org.orgId,
                                    userId: userId!,
                                    autoProvisioned: true
                                },
                                org.roleIds,
                                trx
                            );
                        }
                    }
                }

                // Loop through all the orgs and get the total number of users from the userOrgs table
                // Use all current user orgs (both auto-provisioned and manually added) for counting
                for (const org of currentUserOrgs) {
                    const userCount = await trx
                        .select()
                        .from(userOrgs)
                        .where(eq(userOrgs.orgId, org.orgId));

                    orgUserCounts.push({
                        orgId: org.orgId,
                        userCount: userCount.length
                    });
                }
            });

            calculateUserClientsForOrgs(userId!).catch((err) => {
                logger.error(
                    "Error calculating user clients after syncing orgs and roles for OIDC user",
                    { error: err }
                );
            });

            for (const orgCount of orgUserCounts) {
                await usageService.updateCount(
                    orgCount.orgId,
                    LimitId.USERS,
                    orgCount.userCount
                );
            }

            const token = generateSessionToken();
            const sess = await createSession(token, existingUserId!);
            const isSecure = req.protocol === "https";
            const cookie = serializeSessionCookie(
                token,
                isSecure,
                new Date(sess.expiresAt)
            );

            res.appendHeader("Set-Cookie", cookie);

            let finalRedirectUrl = postAuthRedirectUrl;
            if (loginPageId) {
                finalRedirectUrl = `/auth/org/?redirect=${encodeURIComponent(
                    postAuthRedirectUrl
                )}`;
            }

            logger.debug("Final redirect URL", { finalRedirectUrl });

            return response<ValidateOidcUrlCallbackResponse>(res, {
                data: {
                    redirectUrl: finalRedirectUrl
                },
                success: true,
                error: false,
                message: "OIDC callback validated successfully",
                status: HttpCode.CREATED
            });
        } else {
            if (!existingUser) {
                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        `User with username ${userIdentifier} is unprovisioned. This user must be added to an organization before logging in.`
                    )
                );
            }

            // check for existing user orgs
            const existingUserOrgs = await db
                .select()
                .from(userOrgs)
                .where(and(eq(userOrgs.userId, existingUser.userId)));

            if (!existingUserOrgs.length) {
                logger.debug(
                    "No existing user orgs found for non-auto-provisioned IdP"
                );
                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        `User with username ${userIdentifier} is unprovisioned. This user must be added to an organization before logging in.`
                    )
                );
            }

            const token = generateSessionToken();
            const sess = await createSession(token, existingUser.userId);
            const isSecure = req.protocol === "https";
            const cookie = serializeSessionCookie(
                token,
                isSecure,
                new Date(sess.expiresAt)
            );

            res.appendHeader("Set-Cookie", cookie);

            return response<ValidateOidcUrlCallbackResponse>(res, {
                data: {
                    redirectUrl: postAuthRedirectUrl
                },
                success: true,
                error: false,
                message: "OIDC callback validated successfully",
                status: HttpCode.CREATED
            });
        }
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

function hydrateOrgMapping(
    orgMapping: string | null,
    orgId: string
): string | undefined {
    if (!orgMapping) {
        return undefined;
    }
    return orgMapping.split("{{orgId}}").join(orgId);
}

function normalizeRoleMappingResult(result: unknown): string[] {
    if (typeof result === "string") {
        const role = result.trim();
        return role ? [role] : [];
    }

    if (Array.isArray(result)) {
        return [
            ...new Set(
                result
                    .filter(
                        (value): value is string => typeof value === "string"
                    )
                    .map((value) => value.trim())
                    .filter(Boolean)
            )
        ];
    }

    return [];
}
