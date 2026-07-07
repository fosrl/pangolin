import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { users, userOrgs, orgs, idpOrg, idp, idpOidcConfig } from "@server/db";
import { eq, or, sql, and, isNotNull, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { UserType } from "@server/types/UserTypes";

const lookupBodySchema = z.strictObject({
    identifier: z.string().min(1).toLowerCase()
});

export type LookupUserResponse = {
    found: boolean;
    identifier: string;
    accounts: Array<{
        userId: string;
        email: string | null;
        username: string;
        hasInternalAuth: boolean;
        orgs: Array<{
            orgId: string;
            orgName: string;
            idps: Array<{
                idpId: number;
                name: string;
                variant: string | null;
            }>;
            hasInternalAuth: boolean;
        }>;
    }>;
};

// registry.registerPath({
//     method: "post",
//     path: "/auth/lookup-user",
//     description: "Lookup user accounts by username or email and return available authentication methods.",
//     tags: [OpenAPITags.Auth],
//     request: {
//         body: lookupBodySchema
//     },
// responses: {
// 200: {
// description: "Successful response",
// content: {
// "application/json": {
// schema: z.object({
// data: z.record(z.string(), z.any()).nullable(),
// success: z.boolean(),
// error: z.boolean(),
// message: z.string(),
// status: z.number()
// })
// }
// }
// }
// }
// });

export async function lookupUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = lookupBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { identifier } = parsedBody.data;

        // Query users matching identifier (case-insensitive)
        // Match by username OR email
        const matchingUsers = await db
            .select({
                userId: users.userId,
                email: users.email,
                username: users.username,
                type: users.type,
                passwordHash: users.passwordHash,
                idpId: users.idpId
            })
            .from(users)
            .where(
                or(
                    sql`LOWER(${users.username}) = ${identifier}`,
                    sql`LOWER(${users.email}) = ${identifier}`
                )
            );

        if (!matchingUsers || matchingUsers.length === 0) {
            return response<LookupUserResponse>(res, {
                data: {
                    found: false,
                    identifier,
                    accounts: []
                },
                success: true,
                error: false,
                message: "No accounts found",
                status: HttpCode.OK
            });
        }

        // Get unique user IDs
        const userIds = [...new Set(matchingUsers.map((u) => u.userId))];

        // Get all org memberships for these users
        const orgMemberships = await db
            .select({
                userId: userOrgs.userId,
                orgId: userOrgs.orgId,
                orgName: orgs.name
            })
            .from(userOrgs)
            .innerJoin(orgs, eq(orgs.orgId, userOrgs.orgId))
            .where(inArray(userOrgs.userId, userIds));

        // Get unique org IDs
        const orgIds = [...new Set(orgMemberships.map((m) => m.orgId))];

        // Get all IdPs for these orgs
        const orgIdps =
            orgIds.length > 0
                ? await db
                      .select({
                          orgId: idpOrg.orgId,
                          idpId: idp.idpId,
                          idpName: idp.name,
                          variant: idpOidcConfig.variant
                      })
                      .from(idpOrg)
                      .innerJoin(idp, eq(idp.idpId, idpOrg.idpId))
                      .innerJoin(
                          idpOidcConfig,
                          eq(idpOidcConfig.idpId, idp.idpId)
                      )
                      .where(inArray(idpOrg.orgId, orgIds))
                : [];

        // Build response structure
        const accounts: LookupUserResponse["accounts"] = [];

        for (const user of matchingUsers) {
            const hasInternalAuth =
                user.type === UserType.Internal && user.passwordHash !== null;

            // Get orgs for this user
            const userOrgMemberships = orgMemberships.filter(
                (m) => m.userId === user.userId
            );

            // Deduplicate orgs (user might have multiple memberships in same org)
            const uniqueOrgs = new Map<
                string,
                (typeof userOrgMemberships)[0]
            >();
            for (const membership of userOrgMemberships) {
                if (!uniqueOrgs.has(membership.orgId)) {
                    uniqueOrgs.set(membership.orgId, membership);
                }
            }

            const orgsData = Array.from(uniqueOrgs.values()).map(
                (membership) => {
                    // Get IdPs for this org where the user (with the exact identifier) is authenticated via that IdP
                    // Only show IdPs where the user's idpId matches
                    // Internal users don't have an idpId, so they won't see any IdPs
                    const orgIdpsList = orgIdps
                        .filter((idp) => {
                            if (idp.orgId !== membership.orgId) {
                                return false;
                            }
                            // Only show IdPs where the user (with exact identifier) is authenticated via that IdP
                            // This means user.idpId must match idp.idpId
                            if (
                                user.idpId !== null &&
                                user.idpId === idp.idpId
                            ) {
                                return true;
                            }
                            return false;
                        })
                        .map((idp) => ({
                            idpId: idp.idpId,
                            name: idp.idpName,
                            variant: idp.variant
                        }));

                    // Check if user has internal auth for this org
                    // User has internal auth if they have an internal account type
                    const orgHasInternalAuth = hasInternalAuth;

                    return {
                        orgId: membership.orgId,
                        orgName: membership.orgName,
                        idps: orgIdpsList,
                        hasInternalAuth: orgHasInternalAuth
                    };
                }
            );

            accounts.push({
                userId: user.userId,
                email: user.email,
                username: user.username,
                hasInternalAuth,
                orgs: orgsData
            });
        }

        return response<LookupUserResponse>(res, {
            data: {
                found: true,
                identifier,
                accounts
            },
            success: true,
            error: false,
            message: "User lookup completed",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
