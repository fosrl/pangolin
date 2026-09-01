import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, orgs, roles, userOrgRoles, userOrgs, users } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq, inArray } from "drizzle-orm";
import config from "@server/lib/config";
import { getOrCreateUserVirtualApiKey } from "@server/lib/virtualApiKey";
import {
    sendVirtualApiKeyEmails,
    listOrgInferenceGatewayUrls,
    mapInBatches
} from "@server/lib/sendVirtualApiKeyEmail";
import type { EmailIdentityKeysResponse } from "@server/routers/virtualApiKey/types";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createStore } from "#dynamic/lib/rateLimitStore";

const EMAIL_IDENTITY_KEYS_WINDOW_MINUTES = 15;
const EMAIL_IDENTITY_KEYS_MAX = 3;

export const emailIdentityKeysRateLimit = rateLimit({
    windowMs: EMAIL_IDENTITY_KEYS_WINDOW_MINUTES * 60 * 1000,
    max: EMAIL_IDENTITY_KEYS_MAX,
    keyGenerator: (req) => {
        const actor =
            req.user?.userId ||
            req.apiKey?.apiKeyId ||
            ipKeyGenerator(req.ip || "");
        const orgId =
            typeof req.params.orgId === "string" ? req.params.orgId : "";
        return `emailIdentityKeys:${actor}:${orgId}`;
    },
    handler: (_req, _res, next) => {
        const message = `You can only email identity keys ${EMAIL_IDENTITY_KEYS_MAX} times every ${EMAIL_IDENTITY_KEYS_WINDOW_MINUTES} minutes. Please try again later.`;
        return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
    },
    store: createStore()
});

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z
    .strictObject({
        sendToAll: z.boolean().optional().default(false),
        userIds: z.array(z.string().nonempty()).optional().default([]),
        roleIds: z.array(z.number().int().positive()).optional().default([])
    })
    .superRefine((data, ctx) => {
        if (
            !data.sendToAll &&
            data.userIds.length === 0 &&
            data.roleIds.length === 0
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    "Select at least one user or role, or send to all users",
                path: ["userIds"]
            });
        }
    });

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/virtual-api-keys/email-identity-keys",
    description:
        "Email identity virtual API keys to selected organization members and roles, or to all members.",
    tags: [OpenAPITags.VirtualApiKey],
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
            description: "Successful response"
        }
    }
});

export async function emailIdentityKeys(
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

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        if (!config.getRawConfig().email) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Email is not configured on this server"
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { sendToAll, userIds, roleIds } = parsedBody.data;

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        const uniqueUserIds = [...new Set(userIds)];
        const uniqueRoleIds = [...new Set(roleIds)];

        if (!sendToAll && uniqueRoleIds.length > 0) {
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
                        "One or more roles are invalid for this organization"
                    )
                );
            }
        }

        let targetUserIds: string[] | null = null;
        if (!sendToAll) {
            let roleUserIds: string[] = [];
            if (uniqueRoleIds.length > 0) {
                const roleMembers = await db
                    .select({ userId: userOrgRoles.userId })
                    .from(userOrgRoles)
                    .where(
                        and(
                            eq(userOrgRoles.orgId, orgId),
                            inArray(userOrgRoles.roleId, uniqueRoleIds)
                        )
                    );
                roleUserIds = roleMembers.map((row) => row.userId);
            }

            targetUserIds = [...new Set([...uniqueUserIds, ...roleUserIds])];
            if (targetUserIds.length === 0) {
                return response<EmailIdentityKeysResponse>(res, {
                    data: { sent: 0, skipped: 0 },
                    success: true,
                    error: false,
                    message: "Identity keys emailed successfully",
                    status: HttpCode.OK
                });
            }
        }

        const memberConditions = [eq(userOrgs.orgId, orgId)];
        if (targetUserIds) {
            memberConditions.push(inArray(users.userId, targetUserIds));
        }

        const members = await db
            .select({ user: users })
            .from(users)
            .innerJoin(userOrgs, eq(userOrgs.userId, users.userId))
            .where(and(...memberConditions));

        if (!sendToAll && uniqueUserIds.length > 0) {
            const foundIds = new Set(members.map((row) => row.user.userId));
            if (uniqueUserIds.some((id) => !foundIds.has(id))) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "One or more users are not members of this organization"
                    )
                );
            }
        }

        const [org] = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);

        const orgName = org?.name || orgId;
        const gatewayUrls = await listOrgInferenceGatewayUrls(orgId);
        const recipients = members.flatMap(({ user }) =>
            user.email ? [{ user, email: user.email }] : []
        );
        let sent = 0;
        const skipped = members.length - recipients.length;

        await mapInBatches(recipients, async ({ user, email }) => {
            const { key, secret } = await getOrCreateUserVirtualApiKey({
                orgId,
                user,
                createdByUserId: req.user?.userId ?? null
            });

            await sendVirtualApiKeyEmails({
                recipients: [email],
                orgName,
                orgId,
                keyName: key.name,
                virtualApiKeyId: key.virtualApiKeyId,
                secret,
                allResources: true,
                isIdentityKey: true,
                accountLabel: email,
                gatewayUrls
            });
            sent += 1;
        });

        return response<EmailIdentityKeysResponse>(res, {
            data: { sent, skipped },
            success: true,
            error: false,
            message: "Identity keys emailed successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
