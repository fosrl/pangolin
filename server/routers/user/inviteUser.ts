import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import {
    orgs,
    roles,
    userInviteRoles,
    userInvites,
    userOrgs,
    users
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { alphabet, generateRandomString } from "oslo/crypto";
import { createDate, TimeSpan } from "oslo";
import config from "@server/lib/config";
import { hashPassword } from "@server/auth/password";
import { fromError } from "zod-validation-error";
import { sendEmail } from "@server/emails";
import SendInviteLink from "@server/emails/templates/SendInviteLink";
import { OpenAPITags, registry } from "@server/openApi";
import { UserType } from "@server/types/UserTypes";
import { usageService } from "@server/lib/billing/usageService";
import { FeatureId } from "@server/lib/billing";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import { build } from "@server/build";
import cache from "#dynamic/lib/cache";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";

const inviteUserParamsSchema = z.strictObject({
    orgId: z.string()
});

const inviteUserBodySchema = z
    .strictObject({
        email: z.email().toLowerCase(),
        roleIds: z.array(z.number().int().positive()).min(1).optional(),
        roleId: z.number().int().positive().optional(),
        validHours: z.number().gt(0).lte(168),
        sendEmail: z.boolean().optional(),
        regenerate: z.boolean().optional()
    })
    .refine(
        (d) => (d.roleIds != null && d.roleIds.length > 0) || d.roleId != null,
        { message: "roleIds or roleId is required", path: ["roleIds"] }
    )
    .transform((data) => ({
        email: data.email,
        validHours: data.validHours,
        sendEmail: data.sendEmail,
        regenerate: data.regenerate,
        roleIds: [
            ...new Set(
                data.roleIds && data.roleIds.length > 0
                    ? data.roleIds
                    : [data.roleId!]
            )
        ]
    }));

export type InviteUserBody = z.input<typeof inviteUserBodySchema>;

export type InviteUserResponse = {
    inviteLink: string;
    expiresAt: number;
};

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/create-invite",
    description: "Invite a user to join an organization.",
    tags: [OpenAPITags.Invitation],
    request: {
        params: inviteUserParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: inviteUserBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function inviteUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = inviteUserParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = inviteUserBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const {
            email,
            validHours,
            roleIds: uniqueRoleIds,
            sendEmail: doEmail,
            regenerate
        } = parsedBody.data;

        // Check if the organization exists
        const org = await db
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId))
            .limit(1);
        if (!org.length) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Organization not found")
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

        if (build == "saas") {
            const usage = await usageService.getUsage(orgId, FeatureId.USERS);
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
                FeatureId.USERS,
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

        // Check if the user already exists in the `users` table
        const existingUser = await db
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
            .where(
                and(
                    eq(users.email, email),
                    eq(userOrgs.orgId, orgId),
                    eq(users.type, UserType.Internal)
                )
            )
            .limit(1);

        if (existingUser.length) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "This user is already a member of the organization."
                )
            );
        }

        // Check if an invitation already exists
        const existingInvite = await db
            .select()
            .from(userInvites)
            .where(
                and(eq(userInvites.email, email), eq(userInvites.orgId, orgId))
            )
            .limit(1);

        if (existingInvite.length && !regenerate) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "An invitation for this user already exists."
                )
            );
        }

        if (existingInvite.length) {
            const attempts =
                (await cache.get<number>("regenerateInvite:" + email)) || 0;
            if (attempts >= 3) {
                return next(
                    createHttpError(
                        HttpCode.TOO_MANY_REQUESTS,
                        "You have exceeded the limit of 3 regenerations per hour."
                    )
                );
            }

            await cache.set("regenerateInvite:" + email, attempts + 1, 3600);

            const inviteId = existingInvite[0].inviteId; // Retrieve the original inviteId
            const token = generateRandomString(
                32,
                alphabet("a-z", "A-Z", "0-9")
            );
            const expiresAt = createDate(
                new TimeSpan(validHours, "h")
            ).getTime();
            const tokenHash = await hashPassword(token);

            await db
                .update(userInvites)
                .set({
                    tokenHash,
                    expiresAt
                })
                .where(
                    and(
                        eq(userInvites.email, email),
                        eq(userInvites.orgId, orgId)
                    )
                );

            const inviteLink = `${config.getRawConfig().app.dashboard_url}/invite?token=${inviteId}-${token}&email=${email}`;

            if (doEmail) {
                await sendEmail(
                    SendInviteLink({
                        email,
                        inviteLink,
                        expiresInDays: (validHours / 24).toString(),
                        orgName: org[0].name || orgId,
                        inviterName: req.user?.email || req.user?.username
                    }),
                    {
                        to: email,
                        from: config.getNoReplyEmail(),
                        subject: "Your invitation has been regenerated"
                    }
                );
            }

            return response<InviteUserResponse>(res, {
                data: {
                    inviteLink,
                    expiresAt
                },
                success: true,
                error: false,
                message: "Invitation regenerated successfully",
                status: HttpCode.OK
            });
        }

        // Create a new invite if none exists
        const inviteId = generateRandomString(
            10,
            alphabet("a-z", "A-Z", "0-9")
        );
        const token = generateRandomString(32, alphabet("a-z", "A-Z", "0-9"));
        const expiresAt = createDate(new TimeSpan(validHours, "h")).getTime();

        const tokenHash = await hashPassword(token);

        await db.transaction(async (trx) => {
            await trx.insert(userInvites).values({
                inviteId,
                orgId,
                email,
                expiresAt,
                tokenHash
            });
            await trx
                .insert(userInviteRoles)
                .values(uniqueRoleIds.map((roleId) => ({ inviteId, roleId })));
        });

        const inviteLink = `${config.getRawConfig().app.dashboard_url}/invite?token=${inviteId}-${token}&email=${email}`;

        if (doEmail) {
            await sendEmail(
                SendInviteLink({
                    email,
                    inviteLink,
                    expiresInDays: (validHours / 24).toString(),
                    orgName: org[0].name || orgId,
                    inviterName: req.user?.email || req.user?.username
                }),
                {
                    to: email,
                    from: config.getNoReplyEmail(),
                    subject: `You're invited to join ${org[0].name || orgId}`
                }
            );
        }

        return response<InviteUserResponse>(res, {
            data: {
                inviteLink,
                expiresAt
            },
            success: true,
            error: false,
            message: "User invited successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
