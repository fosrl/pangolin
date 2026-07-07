import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, idp, idpOidcConfig } from "@server/db";
import { roles, userOrgRoles, userOrgs, users } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { ActionsEnum, checkUserActionPermission } from "@server/auth/actions";
import { OpenAPITags, registry } from "@server/openApi";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { CheckOrgAccessPolicyResult } from "@server/lib/checkOrgAccessPolicy";

async function queryUser(orgId: string, userId: string) {
    const [userRow] = await db
        .select({
            orgId: userOrgs.orgId,
            userId: users.userId,
            email: users.email,
            username: users.username,
            name: users.name,
            type: users.type,
            isOwner: userOrgs.isOwner,
            twoFactorEnabled: users.twoFactorEnabled,
            autoProvisioned: userOrgs.autoProvisioned,
            idpId: users.idpId,
            idpName: idp.name,
            idpType: idp.type,
            idpVariant: idpOidcConfig.variant,
            idpAutoProvision: idp.autoProvision
        })
        .from(userOrgs)
        .leftJoin(users, eq(userOrgs.userId, users.userId))
        .leftJoin(idp, eq(users.idpId, idp.idpId))
        .leftJoin(idpOidcConfig, eq(idp.idpId, idpOidcConfig.idpId))
        .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
        .limit(1);

    if (!userRow) return undefined;

    const roleRows = await db
        .select({
            roleId: userOrgRoles.roleId,
            roleName: roles.name,
            isAdmin: roles.isAdmin
        })
        .from(userOrgRoles)
        .leftJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
        .where(
            and(eq(userOrgRoles.userId, userId), eq(userOrgRoles.orgId, orgId))
        );

    const isAdmin = roleRows.some((r) => r.isAdmin);

    return {
        ...userRow,
        isAdmin,
        roleIds: roleRows.map((r) => r.roleId),
        roles: roleRows.map((r) => ({
            roleId: r.roleId,
            name: r.roleName ?? ""
        }))
    };
}

export type CheckOrgUserAccessResponse = CheckOrgAccessPolicyResult;

const paramsSchema = z.object({
    userId: z.string(),
    orgId: z.string()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/user/{userId}/check",
    description: "Check a user's access in an organization.",
    tags: [OpenAPITags.Org, OpenAPITags.User],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function checkOrgUserAccess(
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

        const { orgId, userId } = parsedParams.data;

        if (userId !== req.user?.userId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "You do not have permission to check this user's access"
                )
            );
        }

        let user;
        user = await queryUser(orgId, userId);

        if (!user) {
            const [fullUser] = await db
                .select()
                .from(users)
                .where(eq(users.email, userId))
                .limit(1);

            if (fullUser) {
                user = await queryUser(orgId, fullUser.userId);
            }
        }

        if (!user) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `User with ID ${userId} not found in org`
                )
            );
        }

        const policyCheck = await checkOrgAccessPolicy({
            orgId,
            userId,
            session: req.session
        });

        // if we get here, the user has an org join, we just don't know if they pass the policies
        return response<CheckOrgUserAccessResponse>(res, {
            data: policyCheck,
            success: true,
            error: false,
            message: "User access checked successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
