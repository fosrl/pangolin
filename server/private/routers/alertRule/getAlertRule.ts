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
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import {
    GetAlertRuleResponse,
    WebhookAlertConfig
} from "@server/routers/alertRule/types";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        alertRuleId: z.coerce.number<number>()
    })
    .strict();

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/alert-rule/{alertRuleId}",
    description: "Get a specific alert rule for an organization.",
    tags: [OpenAPITags.Org],
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

export async function getAlertRule(
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

        const [rule] = await db
            .select()
            .from(alertRules)
            .where(
                and(
                    eq(alertRules.alertRuleId, alertRuleId),
                    eq(alertRules.orgId, orgId)
                )
            );

        if (!rule) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Alert rule not found")
            );
        }

        // Fetch site associations
        const siteRows = await db
            .select()
            .from(alertSites)
            .where(eq(alertSites.alertRuleId, alertRuleId));

        // Fetch health check associations
        const healthCheckRows = await db
            .select()
            .from(alertHealthChecks)
            .where(eq(alertHealthChecks.alertRuleId, alertRuleId));

        // Fetch resource associations
        const resourceRows = await db
            .select()
            .from(alertResources)
            .where(eq(alertResources.alertRuleId, alertRuleId));

        // Resolve the single email action row for this rule, then collect all
        // recipients into a flat list. The emailAction pivot row is an internal
        // implementation detail and is not surfaced to callers.
        const [emailAction] = await db
            .select()
            .from(alertEmailActions)
            .where(eq(alertEmailActions.alertRuleId, alertRuleId));

        let recipients: GetAlertRuleResponse["recipients"] = [];
        if (emailAction) {
            const rows = await db
                .select()
                .from(alertEmailRecipients)
                .where(
                    eq(
                        alertEmailRecipients.emailActionId,
                        emailAction.emailActionId
                    )
                );

            recipients = rows.map((r) => ({
                recipientId: r.recipientId,
                userId: r.userId ?? null,
                roleId: r.roleId ?? null,
                email: r.email ?? null
            }));
        }

        // Fetch webhook actions
        const webhooks = await db
            .select()
            .from(alertWebhookActions)
            .where(eq(alertWebhookActions.alertRuleId, alertRuleId));

        return response<GetAlertRuleResponse>(res, {
            data: {
                alertRuleId: rule.alertRuleId,
                orgId: rule.orgId,
                name: rule.name,
                eventType: rule.eventType,
                enabled: rule.enabled,
                cooldownSeconds: rule.cooldownSeconds,
                lastTriggeredAt: rule.lastTriggeredAt ?? null,
                createdAt: rule.createdAt,
                updatedAt: rule.updatedAt,
                siteIds: siteRows.map((r) => r.siteId),
                healthCheckIds: healthCheckRows.map((r) => r.healthCheckId),
                resourceIds: resourceRows.map((r) => r.resourceId),
                recipients,
                webhookActions: webhooks.map((w) => {
                    let parsedConfig: WebhookAlertConfig | null = null;
                    if (w.config) {
                        try {
                            const serverSecret =
                                config.getRawConfig().server.secret!;
                            const decrypted = decrypt(w.config, serverSecret);
                            parsedConfig = JSON.parse(
                                decrypted
                            ) as WebhookAlertConfig;
                        } catch {
                            // best-effort – return null if decryption fails
                        }
                    }
                    return {
                        webhookActionId: w.webhookActionId,
                        webhookUrl: w.webhookUrl,
                        enabled: w.enabled,
                        lastSentAt: w.lastSentAt ?? null,
                        config: parsedConfig
                    };
                })
            },
            success: true,
            error: false,
            message: "Alert rule retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
