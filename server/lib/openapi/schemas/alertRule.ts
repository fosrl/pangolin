import "@server/extendZod";
import { z } from "zod";

const ids = (description: string) =>
    z.array(z.number().int()).openapi({ description });

export const AlertRuleEventTypeSchema = z
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

export const AlertRuleListItemSchema = z.object({
    alertRuleId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the alert rule." }),
    orgId: z.string().openapi({ description: "ID of the organization." }),
    name: z.string().openapi({ description: "Alert rule name." }),
    eventType: AlertRuleEventTypeSchema,
    enabled: z
        .boolean()
        .openapi({ description: "Whether the rule is active." }),
    cooldownSeconds: z.number().int().openapi({
        description: "Minimum seconds between two alerts from this rule."
    }),
    lastTriggeredAt: z.number().int().nullable().openapi({
        description: "Epoch milliseconds when the rule last fired."
    }),
    createdAt: z.number().int().openapi({
        description: "Epoch milliseconds when the rule was created."
    }),
    updatedAt: z.number().int().openapi({
        description: "Epoch milliseconds when the rule was last updated."
    }),
    allSites: z.boolean().openapi({
        description:
            "Whether the rule applies to every site, including future ones."
    }),
    allHealthChecks: z.boolean().openapi({
        description:
            "Whether the rule applies to every health check, including future ones."
    }),
    allResources: z.boolean().openapi({
        description:
            "Whether the rule applies to every resource, including future ones."
    }),
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
            z.object({
                recipientId: z.number().int().openapi({
                    description: "Numeric ID of the recipient."
                }),
                userId: z.string().nullable().openapi({
                    description:
                        "ID of the user to notify, for user recipients."
                }),
                roleId: z.number().int().nullable().openapi({
                    description:
                        "ID of the role whose members are notified, for role recipients."
                }),
                email: z.string().nullable().openapi({
                    description:
                        "Email address to notify, for email recipients."
                })
            })
        )
        .openapi({ description: "Who is notified when the rule fires." })
});

export const AlertRuleCreatedSchema = z.object({
    alertRuleId: AlertRuleListItemSchema.shape.alertRuleId
});
