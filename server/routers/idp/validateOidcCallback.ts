import { storeIdpRefreshToken } from "#dynamic/auth/sessions/idpRevalidation";
import { enrichClaimsWithIdpGroups } from "#dynamic/lib/idp/enrichClaimsWithIdpGroups";
import {
    createSession,
    generateId,
    generateSessionToken,
    serializeSessionCookie
} from "@server/auth/sessions/app";
import { getRequestClientInfo } from "@server/auth/sessions/clientInfo";
import {
    db,
    idp,
    idpOidcConfig,
    orgs,
    userOrgRoles,
    userOrgs,
    users
} from "@server/db";
import { LimitId } from "@server/lib/billing";
import { usageService } from "@server/lib/billing/usageService";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { pushClientIdentitiesForUser } from "@server/lib/clientIdentities";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import {
    evaluateAutoProvisioning,
    getAutoProvisionCandidates,
    isLoginDenied,
    planMembershipChanges,
    resolveIdpIdentity,
    type DesiredMembership
} from "@server/lib/idp/evaluateIdpLogin";
import { previewIdpLogin } from "@server/lib/idp/previewIdpLogin";
import { createRoles } from "@server/lib/idp/resolveOrgMembership";
import { changedClaimKeys, saveLoginClaims } from "@server/lib/idp/loginClaims";
import {
    completeTestLink,
    getTestLink,
    testLinkStatus
} from "@server/lib/idp/testLinks";
import response from "@server/lib/response";
import { assignUserToOrg, removeUserFromOrg } from "@server/lib/userOrg";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { UserType } from "@server/types/UserTypes";
import * as arctic from "arctic";
import { and, eq, inArray } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
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
                codeVerifier: z.string(),
                // a test login from a test link: nothing is changed
                test: z.object({ linkId: z.string() }).optional()
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
            redirectUrl: postAuthRedirectUrl,
            test
        } = stateObj.data;

        if (state !== expectedState) {
            logger.error("State mismatch", { expectedState, state });
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "State mismatch")
            );
        }

        // a shared link works once, until it expires
        if (test) {
            const link = await getTestLink(test.linkId);
            if (
                !link ||
                link.idpId !== existingIdp.idp.idpId ||
                testLinkStatus(link) !== "pending"
            ) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "This test link has expired or was already used. Ask your administrator for a new one."
                    )
                );
            }
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
        const idTokenClaims = arctic.decodeIdToken(idToken) as Record<
            string,
            unknown
        >;
        const claims = await enrichClaimsWithIdpGroups(
            existingIdp,
            idTokenClaims
        );

        logger.debug("ID token claims", { claims });

        const enrichedClaimKeys = changedClaimKeys(idTokenClaims, claims);

        if (test) {
            // dry run for the admins who shared the link: the user only sees that it worked
            const link = await getTestLink(test.linkId);
            const testResult = await previewIdpLogin({
                existingIdp,
                claims,
                enrichedClaimKeys,
                onlyOrgId: link?.orgId ?? undefined
            });
            if (!(await completeTestLink(test.linkId, testResult))) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "This test link was already used. Ask your administrator for a new one."
                    )
                );
            }
            return response<ValidateOidcUrlCallbackResponse>(res, {
                data: { redirectUrl: postAuthRedirectUrl },
                success: true,
                error: false,
                message: "OIDC test login completed",
                status: HttpCode.OK
            });
        }

        const {
            identifier: userIdentifier,
            email,
            name
        } = resolveIdpIdentity(claims, existingIdp.idpOidcConfig);

        if (!userIdentifier) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User identifier not found in the ID token"
                )
            );
        }

        logger.debug("User identifier", { userIdentifier });
        logger.debug("User email", { email });
        logger.debug("User name", { name });

        const [existingUser] = await db
            .select()
            .from(users)
            .where(
                and(
                    eq(users.username, userIdentifier),
                    eq(users.idpId, existingIdp.idp.idpId)
                )
            );

        if (existingUser) {
            // kept even if the login is refused below: that's when admins need them
            await saveLoginClaims({
                idp: existingIdp.idp,
                userId: existingUser.userId,
                claims,
                enrichedClaimKeys
            });
        }

        const { shouldAutoProvision, candidates } =
            await getAutoProvisionCandidates(existingIdp.idp);

        if (shouldAutoProvision) {
            const evaluations = await evaluateAutoProvisioning(
                claims,
                existingIdp.idp,
                candidates
            );

            const userOrgInfo: DesiredMembership[] = [];
            for (const evaluation of evaluations) {
                const membership = evaluation.membership;
                if (!membership) {
                    continue;
                }

                if (!membership.matched) {
                    if (membership.reason === "noRoleNames") {
                        logger.error("Role mapping returned no valid roles", {
                            roleMapping: evaluation.roleMapping
                        });
                    } else if (membership.reason === "noMatchingRoles") {
                        logger.error("No mapped roles found in organization", {
                            orgId: evaluation.orgId,
                            roleNames: membership.roleNames
                        });
                    }
                    continue;
                }

                userOrgInfo.push({
                    orgId: evaluation.orgId,
                    roleIds: membership.roles.map((r) => r.roleId),
                    missingRoleNames: membership.missingRoleNames
                });
            }

            // These are the orgs that the user should be provisioned into based on the IdP mappings and the token claims
            logger.debug("User org info", { userOrgInfo });

            const autoProvisionCandidateOrgIds = new Set(
                candidates.map((c) => c.org.orgId)
            );

            let existingUserId = existingUser?.userId;

            if (!userOrgInfo.length) {
                const existingUserOrgs = existingUser
                    ? await db
                          .select()
                          .from(userOrgs)
                          .where(eq(userOrgs.userId, existingUser.userId))
                    : null;

                if (
                    isLoginDenied({
                        currentMemberships: existingUserOrgs,
                        desired: userOrgInfo,
                        candidateOrgIds: autoProvisionCandidateOrgIds
                    })
                ) {
                    if (existingUser && existingUserOrgs) {
                        // delete all auto-managed user orgs, all in candidate orgs here
                        const orgIdsToRemove = existingUserOrgs
                            .filter((uo) => uo.autoManaged === true)
                            .map((uo) => uo.orgId);
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
                    }

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

                // Only auto-managed memberships in orgs that currently have
                // auto-provision enabled are synced. Manual memberships, and orgs
                // with auto-provision off, keep their existing memberships.
                const changes = planMembershipChanges({
                    currentMemberships: currentUserOrgs,
                    desired: userOrgInfo,
                    candidateOrgIds: autoProvisionCandidateOrgIds
                });

                // Delete auto-provisioned orgs that are no longer valid
                if (changes.remove.length > 0) {
                    const fullOrgsToRemove = await trx
                        .select()
                        .from(orgs)
                        .where(inArray(orgs.orgId, changes.remove));
                    for (const org of fullOrgsToRemove) {
                        await removeUserFromOrg(org, userId!, trx);
                    }
                }

                // Sync roles 1:1 with IdP policy for existing auto-provisioned orgs
                for (const update of changes.updateRoles) {
                    await trx
                        .delete(userOrgRoles)
                        .where(
                            and(
                                eq(userOrgRoles.userId, userId!),
                                eq(userOrgRoles.orgId, update.orgId)
                            )
                        );

                    for (const roleId of update.roleIds) {
                        await trx.insert(userOrgRoles).values({
                            userId: userId!,
                            orgId: update.orgId,
                            roleId
                        });
                    }
                }

                // Add new orgs that don't exist yet (these will be auto-provisioned)
                for (const org of changes.add) {
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

            if (!existingUser) {
                await saveLoginClaims({
                    idp: existingIdp.idp,
                    userId: userId!,
                    claims,
                    enrichedClaimKeys
                });
            }

            calculateUserClientsForOrgs(userId!).catch((err) => {
                logger.error(
                    "Error calculating user clients after syncing orgs and roles for OIDC user",
                    { error: err }
                );
            });

            if (existingUser) {
                // The sync above may have changed the user's name, email or
                // roles, all of which newt forwards as Remote-* headers.
                pushClientIdentitiesForUser(userId!).catch((err) => {
                    logger.error(
                        "Error pushing client identities after syncing OIDC user",
                        { error: err }
                    );
                });
            }

            for (const orgCount of orgUserCounts) {
                await usageService.updateCount(
                    orgCount.orgId,
                    LimitId.USERS,
                    orgCount.userCount
                );
            }

            const token = generateSessionToken();
            const sess = await createSession(
                token,
                existingUserId!,
                getRequestClientInfo(req)
            );
            await storeIdpRefreshToken(
                sess.sessionId,
                existingIdp.idp.idpId,
                tokens
            );
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
            const sess = await createSession(
                token,
                existingUser.userId,
                getRequestClientInfo(req)
            );
            await storeIdpRefreshToken(
                sess.sessionId,
                existingIdp.idp.idpId,
                tokens
            );
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
