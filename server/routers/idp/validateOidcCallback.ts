import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, Org } from "@server/db";
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
    userOrgs,
    users
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import * as arctic from "arctic";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
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
import { FeatureId } from "@server/lib/billing";
import { usageService } from "@server/lib/billing/usageService";
import { build } from "@server/build";

const ensureTrailingSlash = (url: string): string => {
    return url;
};

const paramsSchema = z
    .object({
        idpId: z.coerce.number()
    })
    .strict();

const bodySchema = z.object({
    code: z.string().nonempty(),
    state: z.string().nonempty(),
    storedState: z.string().nonempty()
});

const querySchema = z.object({
    loginPageId: z.coerce.number().optional()
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

        const tokens = await client.validateAuthorizationCode(
            ensureTrailingSlash(existingIdp.idpOidcConfig.tokenUrl),
            code,
            codeVerifier
        );

        const idToken = tokens.idToken();
        logger.debug("ID token", { idToken });
        const claims = arctic.decodeIdToken(idToken);
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

            const userOrgInfo: { orgId: string; roleId: number }[] = [];
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

                let roleId: number | undefined = undefined;

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
                    const roleName = jmespath.search(claims, roleMapping);

                    if (!roleName) {
                        logger.error("Role name not found in the ID token", {
                            roleName
                        });
                        continue;
                    }

                    const [roleRes] = await db
                        .select()
                        .from(roles)
                        .where(
                            and(
                                eq(roles.orgId, org.orgId),
                                eq(roles.name, roleName)
                            )
                        );

                    if (!roleRes) {
                        logger.error("Role not found", {
                            orgId: org.orgId,
                            roleName
                        });
                        continue;
                    }

                    roleId = roleRes.roleId;

                    userOrgInfo.push({
                        orgId: org.orgId,
                        roleId
                    });
                }
            }

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
                        // delete the user
                        // await db
                        //     .delete(users)
                        //     .where(eq(users.userId, existingUser.userId));
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

            // sync the user with the orgs and roles
            await db.transaction(async (trx) => {
                let userId = existingUser?.userId;

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
                    await trx.delete(userOrgs).where(
                        and(
                            eq(userOrgs.userId, userId!),
                            inArray(
                                userOrgs.orgId,
                                orgsToDelete.map((org) => org.orgId)
                            )
                        )
                    );
                }

                // Update roles for existing auto-provisioned orgs where the role has changed
                const orgsToUpdate = autoProvisionedOrgs.filter(
                    (currentOrg) => {
                        const newOrg = userOrgInfo.find(
                            (newOrg) => newOrg.orgId === currentOrg.orgId
                        );
                        return newOrg && newOrg.roleId !== currentOrg.roleId;
                    }
                );

                if (orgsToUpdate.length > 0) {
                    for (const org of orgsToUpdate) {
                        const newRole = userOrgInfo.find(
                            (newOrg) => newOrg.orgId === org.orgId
                        );
                        if (newRole) {
                            await trx
                                .update(userOrgs)
                                .set({ roleId: newRole.roleId })
                                .where(
                                    and(
                                        eq(userOrgs.userId, userId!),
                                        eq(userOrgs.orgId, org.orgId)
                                    )
                                );
                        }
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
                    await trx.insert(userOrgs).values(
                        orgsToAdd.map((org) => ({
                            userId: userId!,
                            orgId: org.orgId,
                            roleId: org.roleId,
                            autoProvisioned: true,
                            dateCreated: new Date().toISOString()
                        }))
                    );
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

            for (const orgCount of orgUserCounts) {
                await usageService.updateDaily(
                    orgCount.orgId,
                    FeatureId.USERS,
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

            return response<ValidateOidcUrlCallbackResponse>(res, {
                data: {
                    redirectUrl: postAuthRedirectUrl
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
