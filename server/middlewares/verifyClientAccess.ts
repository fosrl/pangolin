import { Request, Response, NextFunction } from "express";
import { Client, db } from "@server/db";
import { userOrgs, clients, roleClients, userClients } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import logger from "@server/logger";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

export async function verifyClientAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId; // Assuming you have user information in the request
    const clientIdStr =
        req.params?.clientId || req.body?.clientId || req.query?.clientId;
    const niceId = req.params?.niceId || req.body?.niceId || req.query?.niceId;
    const orgId = req.params?.orgId || req.body?.orgId || req.query?.orgId;

    try {
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        let client: Client | null = null;

        if (niceId && orgId) {
            const [clientRes] = await db
                .select()
                .from(clients)
                .where(
                    and(eq(clients.niceId, niceId), eq(clients.orgId, orgId))
                )
                .limit(1);
            client = clientRes;
        } else {
            const clientId = parseInt(clientIdStr);
            if (isNaN(clientId)) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid client ID")
                );
            }

            // Get the client
            const [clientRes] = await db
                .select()
                .from(clients)
                .where(eq(clients.clientId, clientId))
                .limit(1);
            client = clientRes;
        }

        if (!client) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Client with ID ${niceId || clientIdStr} not found`
                )
            );
        }

        if (!client.orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Client with ID ${niceId || clientIdStr} does not have an organization ID`
                )
            );
        }

        if (!req.userOrg || req.userOrg?.orgId !== client.orgId) {
            // Get user's role ID in the organization
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, client.orgId)
                    )
                )
                .limit(1);
            req.userOrg = userOrgRole[0];
        }

        if (!req.userOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        if (req.orgPolicyAllowed === undefined && req.userOrg.orgId) {
            const policyCheck = await checkOrgAccessPolicy({
                orgId: req.userOrg.orgId,
                userId,
                session: req.session
            });
            req.orgPolicyAllowed = policyCheck.allowed;
            if (!policyCheck.allowed || policyCheck.error) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "" + (policyCheck.error || "Unknown error")
                    )
                );
            }
        }

        req.userOrgRoleIds = await getUserOrgRoleIds(
            req.userOrg.userId,
            client.orgId
        );
        req.userOrgId = client.orgId;

        // Check role-based client access (any of user's roles)
        const roleClientAccessList =
            (req.userOrgRoleIds?.length ?? 0) > 0
                ? await db
                      .select()
                      .from(roleClients)
                      .where(
                          and(
                              eq(roleClients.clientId, client.clientId),
                              inArray(roleClients.roleId, req.userOrgRoleIds!)
                          )
                      )
                      .limit(1)
                : [];
        const [roleClientAccess] = roleClientAccessList;

        if (roleClientAccess) {
            // User has access to the site through their role
            return next();
        }

        // If role doesn't have access, check user-specific site access
        const [userClientAccess] = await db
            .select()
            .from(userClients)
            .where(
                and(
                    eq(userClients.userId, userId),
                    eq(userClients.clientId, client.clientId)
                )
            )
            .limit(1);

        if (userClientAccess) {
            // User has direct access to the site
            return next();
        }

        // If we reach here, the user doesn't have access to the site
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have access to this client"
            )
        );
    } catch (error) {
        logger.error("Error verifying client access", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying site access"
            )
        );
    }
}
