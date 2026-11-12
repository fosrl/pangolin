import { enrichClaimsWithIdpGroups } from "#dynamic/lib/idp/enrichClaimsWithIdpGroups";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import {
    createSession,
    generateId,
    generateSessionToken,
    serializeSessionCookie
} from "@server/auth/sessions/app";
import { build } from "@server/build";
import {
    db,
    idp,
    idpOidcConfig,
    idpOrg,
    Org,
    orgs,
    userOrgRoles,
    userOrgs,
    users
} from "@server/db";
import { LimitId } from "@server/lib/billing";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { usageService } from "@server/lib/billing/usageService";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import {
    createRoles,
    resolveOrgMembership
} from "@server/lib/idp/resolveOrgMembership";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import response from "@server/lib/response";
import { assignUserToOrg, removeUserFromOrg } from "@server/lib/userOrg";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { UserType } from "@server/types/UserTypes";
import * as arctic from "arctic";
import { and, eq, inArray } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import jmespath from "jmespath";
import jsonwebtoken from "jsonwebtoken";
import { z } from "zod";
import { fromError } from "zod-validation-error";

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
    storedState: z.string().nonempty()
});

const querySchema = z.object({
    loginPageId: z.coerce.number<number>().optional()
});

export type ValidateOidcUrlCallbackResponse = {
    redirectUrl: string;
};

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

        const { storedState, code, state: expectedState } = parsedBody.data;

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

        const redirectUrl = await generateOidcRedirectUrl(
            existingIdp.idp.idpId,
            undefined,
            loginPageId
        );
        const client = new arctic.OAuth2Client(
            decryptedClientId,
            decryptedClientSecret,
            redirectUrl
        );

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
            redirectUrl: postAuthRedirectUrl
        } = stateObj.data;

        if (state !== expectedState) {
            logger.error("State mismatch", { expectedState, state });
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "State mismatch")
            );
        }

        logger.debug("State verified", {
            urL: ensureTrailingSlash(existingIdp.idpOidcConfig.tokenUrl),
            expectedState,
            state
        });

        let tokens: arctic.OAuth2Tokens;
        try {
            tokens = await client.validateAuthorizationCode(
                ensureTrailingSlash(existingIdp.idpOidcConfig.tokenUrl),
                code,
                codeVerifier
            );
        } catch (err: unknown) {
            if (err instanceof arctic.OAuth2RequestError) {
                logger.warn("OIDC provider rejected the authorization code", {
                    error: err.code,
                    description: err.description,
                    uri: err.uri,
                    state: err.state
                });
                return next(
                    createHttpError(
                        HttpCode.UNAUTHORIZED,
                        err.description ||
                            `OIDC provider rejected the request (${err.code})`
                    )
                );
            }

            if (err instanceof arctic.UnexpectedResponseError) {
                logger.error(
                    "OIDC provider returned an unexpected response during token exchange",
                    { status: err.status }
                );
                return next(
                    createHttpError(
                        HttpCode.BAD_GATEWAY,
                        "Received an unexpected response from the identity provider while exchanging the authorization code."
                    )
                );
            }

            if (err instanceof arctic.UnexpectedErrorResponseBodyError) {
                logger.error(
                    "OIDC provider returned an unexpected error payload during token exchange",
                    { status: err.status, data: err.data }
                );
                return next(
                    createHttpError(
                        HttpCode.BAD_GATEWAY,
                        "Identity provider returned an unexpected error payload while exchanging the authorization code."
                    )
                );
            }

            if (err instanceof arctic.ArcticFetchError) {
                logger.error(
                    "Failed to reach OIDC provider while exchanging authorization code",
                    { error: err.message }
                );
                return next(
                    createHttpError(
                        HttpCode.BAD_GATEWAY,
                        "Unable to reach the identity provider while exchanging the authorization code. Please try again."
                    )
                );
            }

            throw err;
        }

        const idToken = tokens.idToken();
        logger.debug("ID token", { idToken });
        const claims = await enrichClaimsWithIdpGroups(
            existingIdp,
            arctic.decodeIdToken(idToken) as Record<string, unknown>
        );

        logger.debug("ID token claims", { claims });

        let userIdentifier = jmespath.search(
            claims,
            existingIdp.idpOidcConfig.identifierPath
        ) as string | null;

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
        let name = null;
        try {
            if (existingIdp.idpOidcConfig.emailPath) {
                email = jmespath.search(
                    claims,
                    existingIdp.idpOidcConfig.emailPath
                );
            }

            if (existingIdp.idpOidcConfig.namePath) {
                name = jmespath.search(
                    claims,
                    existingIdp.idpOidcConfig.namePath || ""
                );
            }
        } catch (error) {}

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

            const userOrgInfo: {
                orgId: string;
                roleIds: number[];
                /** created in the transaction below */
                missingRoleNames: string[];
            }[] = [];
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
                const roleMapping =
                    idpOrgRes?.roleMapping || defaultRoleMapping;
                // follows the role mapping: the org policy's flag, or the IdP default
                const createMissingRoles = idpOrgRes?.roleMapping
                    ? idpOrgRes.createMissingRoles
                    : existingIdp.idp.defaultCreateMissingRoles;

                // without a role mapping, the user is never provisioned in the org
                if (!roleMapping) {
                    continue;
                }

                const membership = await resolveOrgMembership({
                    claims,
                    orgId: org.orgId,
                    orgMapping,
                    roleMapping,
                    supportsMultiRole: await isLicensedOrSubscribed(
                        org.orgId,
                        tierMatrix.fullRbac
                    ),
                    createMissingRoles
                });

                if (!membership.matched) {
                    if (membership.reason === "noRoleNames") {
                        logger.error("Role mapping returned no valid roles", {
                            roleMapping
                        });
                    } else if (membership.reason === "noMatchingRoles") {
                        logger.error("No mapped roles found in organization", {
                            orgId: org.orgId,
                            roleNames: membership.roleNames
                        });
                    }
                    continue;
                }

                userOrgInfo.push({
                    orgId: org.orgId,
                    roleIds: membership.roles.map((r) => r.roleId),
                    missingRoleNames: membership.missingRoleNames
                });
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
                                eq(userOrgs.autoManaged, false)
                            )
                        );

                    if (!existingUserOrgs.length) {
                        // delete all auto-provisioned user orgs
                        const autoManagedUserOrgs = await db
                            .select()
                            .from(userOrgs)
                            .where(
                                and(
                                    eq(userOrgs.userId, existingUser.userId),
                                    eq(userOrgs.autoManaged, true)
                                )
                            );
                        const orgIdsToRemove = autoManagedUserOrgs.map(
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
                // create the mapped roles missing from their org ("create missing roles")
                for (const info of userOrgInfo) {
                    if (info.missingRoleNames.length === 0) continue;
                    const createdRoles = await createRoles(
                        info.orgId,
                        info.missingRoleNames,
                        trx
                    );
                    info.roleIds = [
                        ...new Set([
                            ...info.roleIds,
                            ...createdRoles.map((r) => r.roleId)
                        ])
                    ];
                }

                // create user if not exists
                if (!existingUser) {
                    // upsert: directory sync can create the same user concurrently
                    const [createdUser] = await trx
                        .insert(users)
                        .values({
                            userId: generateId(15),
                            username: userIdentifier,
                            email: email || null,
                            name: name || null,
                            type: UserType.OIDC,
                            idpId: existingIdp.idp.idpId,
                            emailVerified: true, // OIDC users are always verified
                            dateCreated: new Date().toISOString()
                        })
                        .onConflictDoUpdate({
                            target: [users.idpId, users.username],
                            set: {
                                email: email || null,
                                name: name || null
                            }
                        })
                        .returning({ userId: users.userId });
                    userId = createdUser.userId;
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
                const autoManagedOrgs = currentUserOrgs.filter(
                    (org) => org.autoManaged === true
                );

                // Delete auto-provisioned orgs that are no longer valid
                const orgsToDelete = autoManagedOrgs.filter(
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
                for (const currentOrg of autoManagedOrgs) {
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
                                    autoManaged: true
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
