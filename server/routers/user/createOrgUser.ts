import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { db, orgs, primaryDb } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { idp, idpOidcConfig, roles, userOrgs, users } from "@server/db";
import { generateId } from "@server/auth/sessions/app";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import { build } from "@server/build";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { isSubscribed } from "#dynamic/lib/isSubscribed";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import { assignUserToOrg } from "@server/lib/userOrg";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { isOrgRebuildRateLimited } from "@server/lib/rebuildClientAssociations";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z
    .strictObject({
        email: z.string().email().toLowerCase().optional(),
        username: z.string().nonempty().toLowerCase(),
        name: z.string().optional(),
        type: z.enum(["internal", "oidc"]).optional(),
        idpId: z.number().optional(),
        roleIds: z.array(z.number().int().positive()).min(1).optional(),
        roleId: z.number().int().positive().optional()
    })
    .refine(
        (d) => (d.roleIds != null && d.roleIds.length > 0) || d.roleId != null,
        { message: "roleIds or roleId is required", path: ["roleIds"] }
    )
    .transform((data) => ({
        email: data.email,
        username: data.username,
        name: data.name,
        type: data.type,
        idpId: data.idpId,
        roleIds: [
            ...new Set(
                data.roleIds && data.roleIds.length > 0
                    ? data.roleIds
                    : [data.roleId!]
            )
        ]
    }));

export type CreateOrgUserResponse = {};
const CreateOrgUserResponseDataSchema = z.object({});

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/user",
    description: "Create an organization user.",
    tags: [OpenAPITags.User],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        CreateOrgUserResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function createOrgUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const {
            username,
            email,
            name,
            type,
            idpId,
            roleIds: uniqueRoleIds
        } = parsedBody.data;

        if (build == "saas") {
            const usage = await usageService.getUsage(orgId, LimitId.USERS);
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectUsers = await usageService.checkLimitSet(
                orgId,

                LimitId.USERS,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                } // We need to add one to know if we are violating the limit
            );
            if (rejectUsers) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "User limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        if (type === "internal") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Internal users are not supported yet"
                )
            );
        } else if (type === "oidc") {
            if (build === "saas") {
                const subscribed = await isSubscribed(
                    orgId,
                    tierMatrix.orgOidc
                );
                if (!subscribed) {
                    return next(
                        createHttpError(
                            HttpCode.FORBIDDEN,
                            "This organization's current plan does not support this feature."
                        )
                    );
                }
            }

            if (!idpId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "IDP ID is required for OIDC users"
                    )
                );
            }

            const supportsMultiRole = await isLicensedOrSubscribed(
                orgId,
                tierMatrix[TierFeature.FullRbac]
            );
            if (!supportsMultiRole && uniqueRoleIds.length > 1) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Multiple roles per user require a subscription or license that includes full RBAC."
                    )
                );
            }

            const orgRoles = await db
                .select({ roleId: roles.roleId })
                .from(roles)
                .where(
                    and(
                        eq(roles.orgId, orgId),
                        inArray(roles.roleId, uniqueRoleIds)
                    )
                );

            if (orgRoles.length !== uniqueRoleIds.length) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid role ID or role does not belong to this organization"
                    )
                );
            }

            const [org] = await db
                .select()
                .from(orgs)
                .where(eq(orgs.orgId, orgId))
                .limit(1);

            if (!org) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "Organization not found"
                    )
                );
            }

            if (await isOrgRebuildRateLimited(org.orgId)) {
                return next(
                    createHttpError(
                        HttpCode.TOO_MANY_REQUESTS,
                        "Too many concurrent rebuild operations for this organization. Please retry after a moment."
                    )
                );
            }

            const [idpRes] = await db
                .select()
                .from(idp)
                .innerJoin(idpOidcConfig, eq(idp.idpId, idpOidcConfig.idpId))
                .where(eq(idp.idpId, idpId));

            if (!idpRes) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "IDP ID not found")
                );
            }

            if (idpRes.idp.type !== "oidc") {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "IDP ID is not of type OIDC"
                    )
                );
            }

            let userIdForClients: string | undefined;
            await db.transaction(async (trx) => {
                const [existingUser] = await trx
                    .select()
                    .from(users)
                    .where(
                        and(
                            eq(users.username, username),
                            eq(users.idpId, idpId)
                        )
                    );

                let userId: string | undefined;
                if (existingUser) {
                    userId = existingUser.userId;
                    const [existingOrgUser] = await trx
                        .select()
                        .from(userOrgs)
                        .where(
                            and(
                                eq(userOrgs.orgId, orgId),
                                eq(userOrgs.userId, existingUser.userId)
                            )
                        );

                    if (existingOrgUser) {
                        return next(
                            createHttpError(
                                HttpCode.BAD_REQUEST,
                                "User already exists in this organization"
                            )
                        );
                    }

                    await assignUserToOrg(
                        org,
                        {
                            orgId,
                            userId: existingUser.userId,
                            autoProvisioned: false
                        },
                        uniqueRoleIds,
                        trx
                    );
                } else {
                    userId = generateId(15);

                    const [newUser] = await trx
                        .insert(users)
                        .values({
                            userId: userId,
                            email,
                            username,
                            name,
                            type: "oidc",
                            idpId,
                            dateCreated: new Date().toISOString(),
                            emailVerified: true
                        })
                        .returning();

                    await assignUserToOrg(
                        org,
                        {
                            orgId,
                            userId: newUser.userId,
                            autoProvisioned: false
                        },
                        uniqueRoleIds,
                        trx
                    );
                }

                userIdForClients = userId;
            });

            if (userIdForClients) {
                calculateUserClientsForOrgs(userIdForClients).catch((e) => {
                    logger.error(
                        `Failed to calculate user clients after creating org user: ${e}`
                    );
                });
            }
        } else {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "User type is required")
            );
        }

        return response<CreateOrgUserResponse>(res, {
            data: {},
            success: true,
            error: false,
            message: "Org user created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
