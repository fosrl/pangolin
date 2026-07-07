/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { db } from "@server/db";
import {
    alertRules,
    alertSites,
    alertHealthChecks,
    alertResources,
    alertEmailActions,
    alertEmailRecipients,
    alertWebhookActions
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { HC_EVENT_TYPES, SITE_EVENT_TYPES, RESOURCE_EVENT_TYPES } from "./createAlertRule";
import { invalidateAllRemoteExitNodeSessions } from "@server/private/auth/sessions/remoteExitNode";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        alertRuleId: z.coerce.number<number>()
    })
    .strict();

const webhookActionSchema = z.strictObject({
    webhookUrl: z.string().url(),
    config: z.string().optional(),
    enabled: z.boolean().optional().default(true)
});

const bodySchema = z
    .strictObject({
        // Alert rule fields - all optional for partial updates
        name: z.string().nonempty().optional(),
        eventType: z
            .enum([
                ...HC_EVENT_TYPES,
                ...SITE_EVENT_TYPES,
                ...RESOURCE_EVENT_TYPES
            ])
            .optional(),
        enabled: z.boolean().optional(),
        cooldownSeconds: z.number().int().nonnegative().optional(),
        // Source join tables - if provided the full set is replaced
        siteIds: z.array(z.number().int().positive()).optional(),
        allSites: z.boolean().optional(),
        healthCheckIds: z.array(z.number().int().positive()).optional(),
        allHealthChecks: z.boolean().optional(),
        resourceIds: z.array(z.number().int().positive()).optional(),
        allResources: z.boolean().optional(),
        // Recipient arrays - if any are provided the full recipient set is replaced
        userIds: z.array(z.string().nonempty()).optional(),
        roleIds: z.array(z.number()).optional(),
        emails: z.array(z.string().email()).optional(),
        // Webhook actions - if provided the full webhook set is replaced
        webhookActions: z.array(webhookActionSchema).optional()
    })
    .superRefine((val, ctx) => {
        if (!val.eventType) return;

        const isSiteEvent = (SITE_EVENT_TYPES as readonly string[]).includes(
            val.eventType
        );
        const isHcEvent = (HC_EVENT_TYPES as readonly string[]).includes(
            val.eventType
        );
        const isResourceEvent = (RESOURCE_EVENT_TYPES as readonly string[]).includes(
            val.eventType
        );

        if (isSiteEvent && val.siteIds !== undefined && val.siteIds.length === 0 && !val.allSites) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "At least one siteId is required for site event types when allSites is false",
                path: ["siteIds"]
            });
        }

        if (isHcEvent && val.healthCheckIds !== undefined && val.healthCheckIds.length === 0 && !val.allHealthChecks) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "At least one healthCheckId is required for health check event types when allHealthChecks is false",
                path: ["healthCheckIds"]
            });
        }

        if (isResourceEvent && val.resourceIds !== undefined && val.resourceIds.length === 0 && !val.allResources) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "At least one resourceId is required for resource event types when allResources is false",
                path: ["resourceIds"]
            });
        }

        if (isSiteEvent && val.healthCheckIds !== undefined && val.healthCheckIds.length > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "healthCheckIds must not be set for site event types",
                path: ["healthCheckIds"]
            });
        }

        if (isHcEvent && val.siteIds !== undefined && val.siteIds.length > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "siteIds must not be set for health check event types",
                path: ["siteIds"]
            });
        }

        if (isResourceEvent && val.siteIds !== undefined && val.siteIds.length > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "siteIds must not be set for resource event types",
                path: ["siteIds"]
            });
        }

        if (isResourceEvent && val.healthCheckIds !== undefined && val.healthCheckIds.length > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "healthCheckIds must not be set for resource event types",
                path: ["healthCheckIds"]
            });
        }
    });

export type UpdateAlertRuleResponse = {
    alertRuleId: number;
};
const UpdateAlertRuleResponseDataSchema = z.object({
    alertRuleId: z.number()
});


registry.registerPath({
    method: "post",
    path: "/org/{orgId}/alert-rule/{alertRuleId}",
    description: "Update an alert rule for a specific organization.",
    tags: [OpenAPITags.Org],
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
                    schema: createApiResponseSchema(UpdateAlertRuleResponseDataSchema)
                }
            }
        }
    }
});

export async function updateAlertRule(
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

        const { orgId, alertRuleId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const [existing] = await db
            .select()
            .from(alertRules)
            .where(
                and(
                    eq(alertRules.alertRuleId, alertRuleId),
                    eq(alertRules.orgId, orgId)
                )
            );

        if (!existing) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Alert rule not found")
            );
        }

        const {
            name,
            eventType,
            enabled,
            cooldownSeconds,
            siteIds,
            allSites,
            healthCheckIds,
            allHealthChecks,
            resourceIds,
            allResources,
            userIds,
            roleIds,
            emails,
            webhookActions
        } = parsedBody.data;

        // --- Update rule fields ---
        const updateData: Record<string, unknown> = {
            updatedAt: Date.now()
        };

        if (name !== undefined) updateData.name = name;
        if (eventType !== undefined) updateData.eventType = eventType;
        if (enabled !== undefined) updateData.enabled = enabled;
        if (cooldownSeconds !== undefined) updateData.cooldownSeconds = cooldownSeconds;
        if (allSites !== undefined) updateData.allSites = allSites;
        if (allHealthChecks !== undefined) updateData.allHealthChecks = allHealthChecks;
        if (allResources !== undefined) updateData.allResources = allResources;

        await db
            .update(alertRules)
            .set(updateData)
            .where(
                and(
                    eq(alertRules.alertRuleId, alertRuleId),
                    eq(alertRules.orgId, orgId)
                )
            );

        // --- Full-replace site associations if siteIds was provided ---
        if (siteIds !== undefined || allSites !== undefined) {
            await db
                .delete(alertSites)
                .where(eq(alertSites.alertRuleId, alertRuleId));

            // Only insert junction rows when allSites is not true
            const effectiveAllSites = allSites ?? false;
            if (!effectiveAllSites && siteIds !== undefined && siteIds.length > 0) {
                await db.insert(alertSites).values(
                    siteIds.map((siteId) => ({
                        alertRuleId,
                        siteId
                    }))
                );
            }
        }

        // --- Full-replace health check associations if healthCheckIds was provided ---
        if (healthCheckIds !== undefined || allHealthChecks !== undefined) {
            await db
                .delete(alertHealthChecks)
                .where(eq(alertHealthChecks.alertRuleId, alertRuleId));

            const effectiveAllHealthChecks = allHealthChecks ?? false;
            if (!effectiveAllHealthChecks && healthCheckIds !== undefined && healthCheckIds.length > 0) {
                await db.insert(alertHealthChecks).values(
                    healthCheckIds.map((healthCheckId) => ({
                        alertRuleId,
                        healthCheckId
                    }))
                );
            }
        }

        // --- Full-replace resource associations if resourceIds was provided ---
        if (resourceIds !== undefined || allResources !== undefined) {
            await db
                .delete(alertResources)
                .where(eq(alertResources.alertRuleId, alertRuleId));

            const effectiveAllResources = allResources ?? false;
            if (!effectiveAllResources && resourceIds !== undefined && resourceIds.length > 0) {
                await db.insert(alertResources).values(
                    resourceIds.map((resourceId) => ({
                        alertRuleId,
                        resourceId
                    }))
                );
            }
        }

        // --- Full-replace recipients if any recipient array was provided ---
        const recipientsProvided =
            userIds !== undefined ||
            roleIds !== undefined ||
            emails !== undefined;

        if (recipientsProvided) {
            const newRecipients = [
                ...(userIds ?? []).map((userId) => ({
                    userId,
                    roleId: null as number | null,
                    email: null as string | null
                })),
                ...(roleIds ?? []).map((roleId) => ({
                    userId: null as string | null,
                    roleId,
                    email: null as string | null
                })),
                ...(emails ?? []).map((email) => ({
                    userId: null as string | null,
                    roleId: null as number | null,
                    email
                }))
            ];

            const [existingEmailAction] = await db
                .select()
                .from(alertEmailActions)
                .where(eq(alertEmailActions.alertRuleId, alertRuleId));

            if (existingEmailAction) {
                await db
                    .delete(alertEmailRecipients)
                    .where(
                        eq(
                            alertEmailRecipients.emailActionId,
                            existingEmailAction.emailActionId
                        )
                    );

                if (newRecipients.length > 0) {
                    await db.insert(alertEmailRecipients).values(
                        newRecipients.map((r) => ({
                            emailActionId: existingEmailAction.emailActionId,
                            ...r
                        }))
                    );
                }
            } else if (newRecipients.length > 0) {
                const [emailActionRow] = await db
                    .insert(alertEmailActions)
                    .values({ alertRuleId, enabled: true })
                    .returning();

                await db.insert(alertEmailRecipients).values(
                    newRecipients.map((r) => ({
                        emailActionId: emailActionRow.emailActionId,
                        ...r
                    }))
                );
            }
        }

        // --- Full-replace webhook actions if the array was provided ---
        if (webhookActions !== undefined) {
            await db
                .delete(alertWebhookActions)
                .where(eq(alertWebhookActions.alertRuleId, alertRuleId));

            if (webhookActions.length > 0) {
                const serverSecret = config.getRawConfig().server.secret!;
                await db.insert(alertWebhookActions).values(
                    webhookActions.map((wa) => ({
                        alertRuleId,
                        webhookUrl: wa.webhookUrl,
                        config: wa.config != null ? encrypt(wa.config, serverSecret) : null,
                        enabled: wa.enabled
                    }))
                );
            }
        }

        return response<UpdateAlertRuleResponse>(res, {
            data: {
                alertRuleId
            },
            success: true,
            error: false,
            message: "Alert rule updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
