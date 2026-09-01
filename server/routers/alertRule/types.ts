export type ListAlertRulesResponse = {
    alertRules: {
        alertRuleId: number;
        orgId: string;
        name: string;
        eventType: string;
        enabled: boolean;
        cooldownSeconds: number;
        lastTriggeredAt: number | null;
        createdAt: number;
        updatedAt: number;
        siteIds: number[];
        healthCheckIds: number[];
        resourceIds: number[];
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};

export type CreateAlertRuleResponse = {
    alertRuleId: number;
};

export type GetAlertRuleResponse = {
    alertRuleId: number;
    orgId: string;
    name: string;
    eventType:
        | "site_online"
        | "site_offline"
        | "site_toggle"
        | "health_check_healthy"
        | "health_check_unhealthy"
        | "health_check_toggle"
        | "resource_healthy"
        | "resource_unhealthy"
        | "resource_degraded"
        | "resource_toggle";
    enabled: boolean;
    cooldownSeconds: number;
    lastTriggeredAt: number | null;
    createdAt: number;
    updatedAt: number;
    siteIds: number[];
    healthCheckIds: number[];
    resourceIds: number[];
    recipients: {
        recipientId: number;
        userId: string | null;
        roleId: number | null;
        email: string | null;
    }[];
    webhookActions: {
        webhookActionId: number;
        webhookUrl: string;
        enabled: boolean;
        lastSentAt: number | null;
        config: WebhookAlertConfig | null;
    }[];
};

/**
 * Stored as an encrypted JSON blob in `alertWebhookActions.config`.
 */
export interface WebhookAlertConfig {
    /** Authentication strategy for the webhook endpoint */
    authType: WebhookAuthType;
    /** Bearer token – used when authType === "bearer" */
    bearerToken?: string;
    /** Basic credentials – "username:password" – used when authType === "basic" */
    basicCredentials?: string;
    /** Custom header name – used when authType === "custom" */
    customHeaderName?: string;
    /** Custom header value – used when authType === "custom" */
    customHeaderValue?: string;
    /** Extra headers to send with every webhook request */
    headers?: Array<{ key: string; value: string }>;
    /** HTTP method (default POST) */
    method?: string;
    /** Whether to use a custom body template */
    useBodyTemplate?: boolean;
    /** Mustache-style body template with {{event}}, {{timestamp}}, {{status}}, {{data}} placeholders */
    bodyTemplate?: string;
}

// ---------------------------------------------------------------------------
// Alert event types
// ---------------------------------------------------------------------------

export type AlertEventType =
    | "site_online"
    | "site_offline"
    | "site_toggle"
    | "health_check_healthy"
    | "health_check_unhealthy"
    | "health_check_toggle"
    | "resource_healthy"
    | "resource_unhealthy"
    | "resource_degraded"
    | "resource_toggle";

// ---------------------------------------------------------------------------
// Webhook authentication config (stored as encrypted JSON in the DB)
// ---------------------------------------------------------------------------

export type WebhookAuthType = "none" | "bearer" | "basic" | "custom";

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
