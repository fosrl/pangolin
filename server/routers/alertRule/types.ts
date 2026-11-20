import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { LimitOffsetPaginationSchema } from "@server/lib/openapi/pagination";
import {
    alertEmailRecipients,
    alertRules,
    alertWebhookActions
} from "@server/db";

// ---------------------------------------------------------------------------
// Alert event types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Webhook authentication config (stored as encrypted JSON in the DB)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal alert event passed through the processing pipeline
// ---------------------------------------------------------------------------

export interface AlertContext {
    eventType: AlertEventType;
    orgId: string;
    /** Set for site_online / site_offline events */
    siteId?: number;
    /** Set for health_check_* events */
    healthCheckId?: number;
    /** Set for resource_* events */
    resourceId?: number;
    /** Human-readable context data included in emails and webhook payloads */
    data: Record<string, unknown>;
}

export type EmailAlertAction = {
    type: "email";
    userIds?: string[];
    roleIds?: number[];
    emails?: string[];
};

export type WebhookAlertAction = {
    type: "webhook";
    webhookUrl: string;
    enabled: boolean;
    config?: string | undefined;
};

export type AlertAction = EmailAlertAction | WebhookAlertAction;
export interface TestAlertContext {
    eventType: AlertEventType;
    actions: AlertAction[];
    orgId: string;
    /** Human-readable context data included in emails and webhook payloads */
    data: Record<string, unknown>;
}

export const AlertEventTypeSchema = z
    .enum([
        "site_online",
        "site_offline",
        "site_toggle",
        "health_check_healthy",
        "health_check_unhealthy",
        "health_check_toggle",
        "resource_healthy",
        "resource_unhealthy",
        "resource_degraded",
        "resource_toggle"
    ])
    .openapi({
        description:
            "The event that triggers the alert. Toggle events fire on any change of state."
    });
export type AlertEventType = z.infer<typeof AlertEventTypeSchema>;

export const WebhookAuthTypeSchema = z.enum([
    "none",
    "bearer",
    "basic",
    "custom"
]);
export type WebhookAuthType = z.infer<typeof WebhookAuthTypeSchema>;

/** Stored as an encrypted JSON blob in `alertWebhookActions.config`. */
export const WebhookAlertConfigSchema = z.object({
    authType: WebhookAuthTypeSchema.openapi({
        description: "Authentication strategy for the webhook endpoint."
    }),
    bearerToken: z.string().optional().openapi({
        description: 'Bearer token, used when authType is "bearer".'
    }),
    basicCredentials: z.string().optional().openapi({
        description:
            'Credentials as "username:password", used when authType is "basic".'
    }),
    customHeaderName: z.string().optional().openapi({
        description: 'Custom header name, used when authType is "custom".'
    }),
    customHeaderValue: z.string().optional().openapi({
        description: 'Custom header value, used when authType is "custom".'
    }),
    headers: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .optional()
        .openapi({
            description: "Extra headers sent with every webhook request."
        }),
    method: z.string().optional().openapi({
        description: "HTTP method. Defaults to POST."
    }),
    useBodyTemplate: z.boolean().optional().openapi({
        description: "Whether to send a custom body template."
    }),
    bodyTemplate: z.string().optional().openapi({
        description:
            "Mustache-style body template with {{event}}, {{timestamp}}, {{status}} and {{data}} placeholders."
    })
});
export type WebhookAlertConfig = z.infer<typeof WebhookAlertConfigSchema>;

const ids = (description: string) =>
    z.array(z.number().int()).openapi({ description });

export const AlertRuleListItemSchema = createSelectSchema(alertRules, {
    alertRuleId: (s) =>
        s.openapi({ description: "Numeric ID of the alert rule." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    name: (s) => s.openapi({ description: "Alert rule name." }),
    eventType: z
        .enum([
            "site_online",
            "site_offline",
            "site_toggle",
            "health_check_healthy",
            "health_check_unhealthy",
            "health_check_toggle",
            "resource_healthy",
            "resource_unhealthy",
            "resource_degraded",
            "resource_toggle"
        ])
        .openapi({
            description:
                "The event that triggers the alert. Toggle events fire on any change of state."
        }),
    enabled: (s) => s.openapi({ description: "Whether the rule is active." }),
    cooldownSeconds: (s) =>
        s.openapi({
            description: "Minimum seconds between two alerts from this rule."
        }),
    lastTriggeredAt: (s) =>
        s.openapi({
            description: "Epoch milliseconds when the rule last fired."
        }),
    createdAt: (s) =>
        s.openapi({
            description: "Epoch milliseconds when the rule was created."
        }),
    updatedAt: (s) =>
        s.openapi({
            description: "Epoch milliseconds when the rule was last updated."
        }),
    allSites: (s) =>
        s.openapi({
            description:
                "Whether the rule applies to every site, including future ones."
        }),
    allHealthChecks: (s) =>
        s.openapi({
            description:
                "Whether the rule applies to every health check, including future ones."
        }),
    allResources: (s) =>
        s.openapi({
            description:
                "Whether the rule applies to every resource, including future ones."
        })
})
    .pick({
        alertRuleId: true,
        orgId: true,
        name: true,
        eventType: true,
        enabled: true,
        cooldownSeconds: true,
        lastTriggeredAt: true,
        createdAt: true,
        updatedAt: true,
        allSites: true,
        allHealthChecks: true,
        allResources: true
    })
    .extend({
        siteIds: ids("Sites the rule applies to when allSites is false."),
        healthCheckIds: ids(
            "Health checks the rule applies to when allHealthChecks is false."
        ),
        resourceIds: ids(
            "Resources the rule applies to when allResources is false."
        ),
        labelIds: ids("Labels whose items the rule applies to.")
    });

export const AlertRuleDetailSchema = AlertRuleListItemSchema.extend({
    recipients: z
        .array(
            createSelectSchema(alertEmailRecipients, {
                recipientId: (s) =>
                    s.openapi({ description: "Numeric ID of the recipient." }),
                userId: (s) =>
                    s.openapi({
                        description:
                            "ID of the user to notify, for user recipients."
                    }),
                roleId: (s) =>
                    s.openapi({
                        description:
                            "ID of the role whose members are notified, for role recipients."
                    }),
                email: (s) =>
                    s.openapi({
                        description:
                            "Email address to notify, for email recipients."
                    })
            }).pick({
                recipientId: true,
                userId: true,
                roleId: true,
                email: true
            })
        )
        .openapi({ description: "Who is notified when the rule fires." }),
    webhookActions: z
        .array(
            createSelectSchema(alertWebhookActions, {
                webhookActionId: (s) =>
                    s.openapi({
                        description: "Numeric ID of the webhook action."
                    }),
                webhookUrl: (s) =>
                    s.openapi({ description: "URL the alert is sent to." }),
                enabled: (s) =>
                    s.openapi({
                        description: "Whether the webhook is called."
                    }),
                lastSentAt: (s) =>
                    s.openapi({
                        description:
                            "Epoch milliseconds when the webhook was last called."
                    })
            })
                .pick({
                    webhookActionId: true,
                    webhookUrl: true,
                    enabled: true,
                    lastSentAt: true
                })
                .extend({
                    config: WebhookAlertConfigSchema.nullable().openapi({
                        description: "Webhook settings, decrypted."
                    })
                })
        )
        .openapi({ description: "Webhooks called when the rule fires." })
});
export type GetAlertRuleResponse = z.infer<typeof AlertRuleDetailSchema>;

export const AlertRuleCreatedSchema = AlertRuleListItemSchema.pick({
    alertRuleId: true
});
export type CreateAlertRuleResponse = z.infer<typeof AlertRuleCreatedSchema>;

export const ListAlertRulesResponseDataSchema = z.object({
    alertRules: z.array(AlertRuleListItemSchema),
    pagination: LimitOffsetPaginationSchema
});
export type ListAlertRulesResponse = z.infer<
    typeof ListAlertRulesResponseDataSchema
>;
