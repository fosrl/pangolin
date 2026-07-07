import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    idp,
    idpOrg,
    resourcePolicies,
    rolePolicies,
    roles,
    userOrgs,
    users
} from "@server/db";
import { userPolicies } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq, inArray, ne } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const setResourcePolicyAcccessControlBodySchema = z.strictObject({
    sso: z.boolean(),
    userIds: z.array(z.string()),
    roleIds: z.array(z.int().positive()).openapi({
        type: "array"
    }),
    skipToIdpId: z.int().positive().optional().nullable().openapi({
        type: "integer",
        description: "Page number to retrieve"
    })
});

const setResourcePolicyAccessControlParamsSchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "post",
    path: "/resource-policy/{resourceId}/access-control",
    description:
        "Set access control users for a resource policy, including SSO, users, roles, Identity provider.",
    tags: [OpenAPITags.Policy, OpenAPITags.User],
    request: {
        params: setResourcePolicyAccessControlParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: setResourcePolicyAcccessControlBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function setResourcePolicyAccessControl(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = setResourcePolicyAcccessControlBodySchema.safeParse(
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

        const { userIds, roleIds, sso, skipToIdpId: idpId } = parsedBody.data;

        const parsedParams =
            setResourcePolicyAccessControlParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourcePolicyId } = parsedParams.data;

        const [policy] = await db
            .select()
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId))
            .limit(1);

        if (!policy) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Resource policy not found"
                )
            );
        }

        // Check if Identity provider in `skipToIdpId` exists
        if (idpId) {
            const [provider] = await db
                .select()
                .from(idp)
                .innerJoin(idpOrg, eq(idpOrg.idpId, idp.idpId))
                .where(
                    and(eq(idp.idpId, idpId), eq(idpOrg.orgId, policy.orgId))
                )
                .limit(1);

            if (!provider) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Identity provider not found in this organization"
                    )
                );
            }
        }

        // Check if any of the roleIds are admin roles
        const rolesToCheck = await db
            .select()
            .from(roles)
            .where(
                and(
                    inArray(roles.roleId, roleIds),
                    eq(roles.orgId, policy.orgId)
                )
            );

        const hasAdminRole = rolesToCheck.some((role) => role.isAdmin);

        if (hasAdminRole) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Admin role cannot be assigned to resources"
                )
            );
        }

        // Get all admin role IDs for this org to exclude from deletion
        const adminRoles = await db
            .select()
            .from(roles)
            .where(and(eq(roles.isAdmin, true), eq(roles.orgId, policy.orgId)));
        const adminRoleIds = adminRoles.map((role) => role.roleId);

        const existingUsers = await db
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(userOrgs.userId, users.userId))
            .where(
                and(
                    eq(userOrgs.orgId, policy.orgId),
                    inArray(users.userId, userIds)
                )
            );

        const existingRoles = await db
            .select()
            .from(roles)
            .where(
                and(
                    eq(roles.orgId, policy.orgId),
                    inArray(roles.roleId, roleIds)
                )
            );

        await db.transaction(async (trx) => {
            // Update SSO status
            await trx
                .update(resourcePolicies)
                .set({
                    sso,
                    idpId
                })
                .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId));

            // Update roles
            if (adminRoleIds.length > 0) {
                await trx.delete(rolePolicies).where(
                    and(
                        eq(rolePolicies.resourcePolicyId, resourcePolicyId),
                        ne(rolePolicies.roleId, adminRoleIds[0]) // delete all but the admin role
                    )
                );
            } else {
                await trx
                    .delete(rolePolicies)
                    .where(eq(rolePolicies.resourcePolicyId, resourcePolicyId));
            }

            const rolesToAdd = existingRoles.map(({ roleId }) => ({
                roleId,
                resourcePolicyId
            }));

            if (rolesToAdd.length > 0) {
                await trx.insert(rolePolicies).values(rolesToAdd);
            }

            // Update users
            await trx
                .delete(userPolicies)
                .where(eq(userPolicies.resourcePolicyId, resourcePolicyId));

            const usersToAdd = existingUsers.map(({ user }) => ({
                userId: user.userId,
                resourcePolicyId: resourcePolicyId
            }));

            if (usersToAdd.length > 0) {
                await trx.insert(userPolicies).values(usersToAdd);
            }
        });

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Resource policy succesfully updated",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
