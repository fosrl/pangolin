import { InferSelectModel } from "drizzle-orm";
import {
    index,
    integer,
    primaryKey,
    real,
    sqliteTable,
    text,
    uniqueIndex
} from "drizzle-orm/sqlite-core";
import {
    clients,
    domains,
    exitNodes,
    labels,
    orgs,
    resources,
    roles,
    sessions,
    siteResources,
    sites,
    targetHealthCheck,
    users
} from "./schema";

export const certificates = sqliteTable("certificates", {
    certId: integer("certId").primaryKey({ autoIncrement: true }),
    domain: text("domain").notNull().unique(),
    domainId: text("domainId").references(() => domains.domainId, {
        onDelete: "cascade"
    }),
    wildcard: integer("wildcard", { mode: "boolean" }).default(false),
    status: text("status").notNull().default("pending"), // pending, requested, valid, expired, failed
    expiresAt: integer("expiresAt"),
    lastRenewalAttempt: integer("lastRenewalAttempt"),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull(),
    orderId: text("orderId"),
    errorMessage: text("errorMessage"),
    renewalCount: integer("renewalCount").default(0),
    certFile: text("certFile"),
    keyFile: text("keyFile")
});

export const dnsChallenge = sqliteTable("dnsChallenges", {
    dnsChallengeId: integer("dnsChallengeId").primaryKey({
        autoIncrement: true
    }),
    domain: text("domain").notNull(),
    token: text("token").notNull(),
    keyAuthorization: text("keyAuthorization").notNull(),
    createdAt: integer("createdAt").notNull(),
    expiresAt: integer("expiresAt").notNull(),
    completed: integer("completed", { mode: "boolean" }).default(false)
});

export const account = sqliteTable("account", {
    accountId: integer("accountId").primaryKey({ autoIncrement: true }),
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" })
});

export const customers = sqliteTable("customers", {
    customerId: text("customerId").primaryKey().notNull(),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    // accountId: integer("accountId")
    //     .references(() => account.accountId, { onDelete: "cascade" }), // Optional, if using accounts
    email: text("email"),
    name: text("name"),
    phone: text("phone"),
    address: text("address"),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull()
});

export const subscriptions = sqliteTable("subscriptions", {
    subscriptionId: text("subscriptionId").primaryKey().notNull(),
    customerId: text("customerId")
        .notNull()
        .references(() => customers.customerId, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"), // active, past_due, canceled, unpaid
    canceledAt: integer("canceledAt"),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt"),
    version: integer("version"),
    expiresAt: integer("expiresAt"),
    trial: integer("trial", { mode: "boolean" }).default(false),
    billingCycleAnchor: integer("billingCycleAnchor"),
    type: text("type") // tier1, tier2, tier3, or license
});

export const subscriptionItems = sqliteTable("subscriptionItems", {
    subscriptionItemId: integer("subscriptionItemId").primaryKey({
        autoIncrement: true
    }),
    stripeSubscriptionItemId: text("stripeSubscriptionItemId"),
    subscriptionId: text("subscriptionId")
        .notNull()
        .references(() => subscriptions.subscriptionId, {
            onDelete: "cascade"
        }),
    planId: text("planId").notNull(),
    priceId: text("priceId"),
    featureId: text("featureId"),
    meterId: text("meterId"),
    unitAmount: real("unitAmount"),
    tiers: text("tiers"),
    interval: text("interval"),
    currentPeriodStart: integer("currentPeriodStart"),
    currentPeriodEnd: integer("currentPeriodEnd"),
    name: text("name")
});

export const accountDomains = sqliteTable("accountDomains", {
    accountId: integer("accountId")
        .notNull()
        .references(() => account.accountId, { onDelete: "cascade" }),
    domainId: text("domainId")
        .notNull()
        .references(() => domains.domainId, { onDelete: "cascade" })
});

export const usage = sqliteTable("usage", {
    usageId: text("usageId").primaryKey(),
    featureId: text("featureId").notNull(),
    orgId: text("orgId")
        .references(() => orgs.orgId, { onDelete: "cascade" })
        .notNull(),
    meterId: text("meterId"),
    instantaneousValue: real("instantaneousValue"),
    latestValue: real("latestValue").notNull(),
    previousValue: real("previousValue"),
    updatedAt: integer("updatedAt").notNull(),
    rolledOverAt: integer("rolledOverAt"),
    nextRolloverAt: integer("nextRolloverAt")
});

export const limits = sqliteTable("limits", {
    limitId: text("limitId").primaryKey(),
    featureId: text("featureId").notNull(),
    orgId: text("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull(),
    value: real("value"),
    override: integer("override", { mode: "boolean" }).default(false),
    description: text("description")
});

export const usageNotifications = sqliteTable("usageNotifications", {
    notificationId: integer("notificationId").primaryKey({
        autoIncrement: true
    }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    featureId: text("featureId").notNull(),
    limitId: text("limitId").notNull(),
    notificationType: text("notificationType").notNull(),
    sentAt: integer("sentAt").notNull()
});

export const domainNamespaces = sqliteTable("domainNamespaces", {
    domainNamespaceId: text("domainNamespaceId").primaryKey(),
    domainId: text("domainId")
        .references(() => domains.domainId, {
            onDelete: "set null"
        })
        .notNull()
});

export const exitNodeOrgs = sqliteTable("exitNodeOrgs", {
    exitNodeId: integer("exitNodeId")
        .notNull()
        .references(() => exitNodes.exitNodeId, { onDelete: "cascade" }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const remoteExitNodes = sqliteTable("remoteExitNode", {
    remoteExitNodeId: text("id").primaryKey(),
    secretHash: text("secretHash").notNull(),
    dateCreated: text("dateCreated").notNull(),
    version: text("version"),
    secondaryVersion: text("secondaryVersion"), // This is to detect the new nodes after the transition to pangolin-node
    exitNodeId: integer("exitNodeId").references(() => exitNodes.exitNodeId, {
        onDelete: "cascade"
    })
});

export const remoteExitNodeResources = sqliteTable("remoteExitNodeResources", {
    remoteExitNodeResourceId: integer("remoteExitNodeResourceId").primaryKey({
        autoIncrement: true
    }),
    remoteExitNodeId: text("remoteExitNodeId")
        .notNull()
        .references(() => remoteExitNodes.remoteExitNodeId, {
            onDelete: "cascade"
        }),
    destination: text("destination").notNull() // a cidr range
});

export const remoteExitNodePreferenceLabels = sqliteTable(
    // this controls what sites are enforced to connect to this node
    "remoteExitNodePreferenceLabels",
    {
        remoteExitNodePreferenceLabelId: integer(
            "remoteExitNodePreferenceLabelId"
        ).primaryKey({ autoIncrement: true }),
        remoteExitNodeId: text("remoteExitNodeId")
            .references(() => remoteExitNodes.remoteExitNodeId, {
                onDelete: "cascade"
            })
            .notNull(),
        labelId: integer("labelId")
            .references(() => labels.labelId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [
        uniqueIndex("remote_exit_node_preference_label_uniq").on(
            t.remoteExitNodeId,
            t.labelId
        )
    ]
);

export const remoteExitNodeSessions = sqliteTable("remoteExitNodeSession", {
    sessionId: text("id").primaryKey(),
    remoteExitNodeId: text("remoteExitNodeId")
        .notNull()
        .references(() => remoteExitNodes.remoteExitNodeId, {
            onDelete: "cascade"
        }),
    expiresAt: integer("expiresAt").notNull()
});

export const loginPage = sqliteTable("loginPage", {
    loginPageId: integer("loginPageId").primaryKey({ autoIncrement: true }),
    subdomain: text("subdomain"),
    fullDomain: text("fullDomain"),
    exitNodeId: integer("exitNodeId").references(() => exitNodes.exitNodeId, {
        onDelete: "set null"
    }),
    domainId: text("domainId").references(() => domains.domainId, {
        onDelete: "set null"
    })
});

export const loginPageOrg = sqliteTable("loginPageOrg", {
    loginPageId: integer("loginPageId")
        .notNull()
        .references(() => loginPage.loginPageId, { onDelete: "cascade" }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const loginPageBranding = sqliteTable("loginPageBranding", {
    loginPageBrandingId: integer("loginPageBrandingId").primaryKey({
        autoIncrement: true
    }),
    logoUrl: text("logoUrl"),
    logoWidth: integer("logoWidth").notNull(),
    logoHeight: integer("logoHeight").notNull(),
    primaryColor: text("primaryColor"),
    resourceTitle: text("resourceTitle").notNull(),
    resourceSubtitle: text("resourceSubtitle"),
    orgTitle: text("orgTitle"),
    orgSubtitle: text("orgSubtitle")
});

export const loginPageBrandingOrg = sqliteTable("loginPageBrandingOrg", {
    loginPageBrandingId: integer("loginPageBrandingId")
        .notNull()
        .references(() => loginPageBranding.loginPageBrandingId, {
            onDelete: "cascade"
        }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const sessionTransferToken = sqliteTable("sessionTransferToken", {
    token: text("token").primaryKey(),
    sessionId: text("sessionId")
        .notNull()
        .references(() => sessions.sessionId, {
            onDelete: "cascade"
        }),
    encryptedSession: text("encryptedSession").notNull(),
    expiresAt: integer("expiresAt").notNull()
});

export const actionAuditLog = sqliteTable(
    "actionAuditLog",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        timestamp: integer("timestamp").notNull(), // this is EPOCH time in seconds
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        actorType: text("actorType").notNull(),
        actor: text("actor").notNull(),
        actorId: text("actorId").notNull(),
        action: text("action").notNull(),
        metadata: text("metadata")
    },
    (table) => [
        index("idx_actionAuditLog_timestamp").on(table.timestamp),
        index("idx_actionAuditLog_org_timestamp").on(
            table.orgId,
            table.timestamp
        )
    ]
);

export const accessAuditLog = sqliteTable(
    "accessAuditLog",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        timestamp: integer("timestamp").notNull(), // this is EPOCH time in seconds
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        actorType: text("actorType"),
        actor: text("actor"),
        actorId: text("actorId"),
        resourceId: integer("resourceId"),
        siteResourceId: integer("siteResourceId"),
        ip: text("ip"),
        location: text("location"),
        type: text("type").notNull(),
        action: integer("action", { mode: "boolean" }).notNull(),
        userAgent: text("userAgent"),
        metadata: text("metadata")
    },
    (table) => [
        index("idx_identityAuditLog_timestamp").on(table.timestamp),
        index("idx_identityAuditLog_org_timestamp").on(
            table.orgId,
            table.timestamp
        )
    ]
);

export const connectionAuditLog = sqliteTable(
    "connectionAuditLog",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        sessionId: text("sessionId").notNull(),
        siteResourceId: integer("siteResourceId").references(
            () => siteResources.siteResourceId,
            { onDelete: "cascade" }
        ),
        orgId: text("orgId").references(() => orgs.orgId, {
            onDelete: "cascade"
        }),
        siteId: integer("siteId").references(() => sites.siteId, {
            onDelete: "cascade"
        }),
        clientId: integer("clientId").references(() => clients.clientId, {
            onDelete: "cascade"
        }),
        clientEndpoint: text("clientEndpoint"),
        userId: text("userId").references(() => users.userId, {
            onDelete: "cascade"
        }),
        sourceAddr: text("sourceAddr").notNull(),
        destAddr: text("destAddr").notNull(),
        protocol: text("protocol").notNull(),
        startedAt: integer("startedAt").notNull(),
        endedAt: integer("endedAt"),
        bytesTx: integer("bytesTx"),
        bytesRx: integer("bytesRx")
    },
    (table) => [
        index("idx_accessAuditLog_startedAt").on(table.startedAt),
        index("idx_accessAuditLog_org_startedAt").on(
            table.orgId,
            table.startedAt
        ),
        index("idx_accessAuditLog_siteResourceId").on(table.siteResourceId)
    ]
);

export const approvals = sqliteTable("approvals", {
    approvalId: integer("approvalId").primaryKey({ autoIncrement: true }),
    timestamp: integer("timestamp").notNull(), // this is EPOCH time in seconds
    orgId: text("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull(),
    clientId: integer("clientId").references(() => clients.clientId, {
        onDelete: "cascade"
    }), // olms reference user devices clients
    userId: text("userId").references(() => users.userId, {
        // optionally tied to a user and in this case delete when the user deletes
        onDelete: "cascade"
    }),
    decision: text("decision")
        .$type<"approved" | "denied" | "pending">()
        .default("pending")
        .notNull(),
    type: text("type")
        .$type<"user_device" /*| 'proxy' // for later */>()
        .notNull()
});

export const bannedEmails = sqliteTable("bannedEmails", {
    email: text("email").primaryKey()
});

export const bannedIps = sqliteTable("bannedIps", {
    ip: text("ip").primaryKey()
});

export const siteProvisioningKeys = sqliteTable("siteProvisioningKeys", {
    siteProvisioningKeyId: text("siteProvisioningKeyId").primaryKey(),
    name: text("name").notNull(),
    siteProvisioningKeyHash: text("siteProvisioningKeyHash").notNull(),
    lastChars: text("lastChars").notNull(),
    createdAt: text("dateCreated").notNull(),
    lastUsed: text("lastUsed"),
    maxBatchSize: integer("maxBatchSize"), // null = no limit
    numUsed: integer("numUsed").notNull().default(0),
    validUntil: text("validUntil"),
    approveNewSites: integer("approveNewSites", { mode: "boolean" })
        .notNull()
        .default(true)
});

export const siteProvisioningKeyOrg = sqliteTable(
    "siteProvisioningKeyOrg",
    {
        siteProvisioningKeyId: text("siteProvisioningKeyId")
            .notNull()
            .references(() => siteProvisioningKeys.siteProvisioningKeyId, {
                onDelete: "cascade"
            }),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" })
    },
    (table) => [
        primaryKey({
            columns: [table.siteProvisioningKeyId, table.orgId]
        })
    ]
);

export const eventStreamingDestinations = sqliteTable(
    "eventStreamingDestinations",
    {
        destinationId: integer("destinationId").primaryKey({
            autoIncrement: true
        }),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        sendConnectionLogs: integer("sendConnectionLogs", { mode: "boolean" })
            .notNull()
            .default(false),
        sendRequestLogs: integer("sendRequestLogs", { mode: "boolean" })
            .notNull()
            .default(false),
        sendActionLogs: integer("sendActionLogs", { mode: "boolean" })
            .notNull()
            .default(false),
        sendAccessLogs: integer("sendAccessLogs", { mode: "boolean" })
            .notNull()
            .default(false),
        type: text("type").notNull(), // e.g. "http", "kafka", etc.
        config: text("config").notNull(), // JSON string with the configuration for the destination
        enabled: integer("enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        lastError: text("lastError"), // last send error message, null if healthy
        lastErrorAt: integer("lastErrorAt"), // epoch ms of last error, null if healthy
        createdAt: integer("createdAt").notNull(),
        updatedAt: integer("updatedAt").notNull()
    }
);

export const eventStreamingCursors = sqliteTable(
    "eventStreamingCursors",
    {
        cursorId: integer("cursorId").primaryKey({ autoIncrement: true }),
        destinationId: integer("destinationId")
            .notNull()
            .references(() => eventStreamingDestinations.destinationId, {
                onDelete: "cascade"
            }),
        logType: text("logType").notNull(), // "request" | "action" | "access" | "connection"
        lastSentId: integer("lastSentId").notNull().default(0),
        lastSentAt: integer("lastSentAt") // epoch milliseconds, null if never sent
    },
    (table) => [
        uniqueIndex("idx_eventStreamingCursors_dest_type").on(
            table.destinationId,
            table.logType
        )
    ]
);

export const alertRules = sqliteTable("alertRules", {
    alertRuleId: integer("alertRuleId").primaryKey({ autoIncrement: true }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eventType: text("eventType")
        .$type<
            | "site_online"
            | "site_offline"
            | "site_toggle"
            | "health_check_healthy"
            | "health_check_unhealthy"
            | "health_check_toggle"
            | "resource_healthy"
            | "resource_unhealthy"
            | "resource_degraded"
            | "resource_toggle"
        >()
        .notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    cooldownSeconds: integer("cooldownSeconds").notNull().default(300),
    allSites: integer("allSites", { mode: "boolean" }).notNull().default(false),
    allHealthChecks: integer("allHealthChecks", { mode: "boolean" })
        .notNull()
        .default(false),
    allResources: integer("allResources", { mode: "boolean" })
        .notNull()
        .default(false),
    lastTriggeredAt: integer("lastTriggeredAt"),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull()
});

export const alertSites = sqliteTable("alertSites", {
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    siteId: integer("siteId")
        .notNull()
        .references(() => sites.siteId, { onDelete: "cascade" })
});

export const alertHealthChecks = sqliteTable("alertHealthChecks", {
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    healthCheckId: integer("healthCheckId")
        .notNull()
        .references(() => targetHealthCheck.targetHealthCheckId, {
            onDelete: "cascade"
        })
});

export const alertResources = sqliteTable("alertResources", {
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

export const alertEmailActions = sqliteTable("alertEmailActions", {
    emailActionId: integer("emailActionId").primaryKey({ autoIncrement: true }),
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastSentAt: integer("lastSentAt")
});

export const alertEmailRecipients = sqliteTable("alertEmailRecipients", {
    recipientId: integer("recipientId").primaryKey({ autoIncrement: true }),
    emailActionId: integer("emailActionId")
        .notNull()
        .references(() => alertEmailActions.emailActionId, {
            onDelete: "cascade"
        }),
    userId: text("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    roleId: integer("roleId").references(() => roles.roleId, {
        onDelete: "cascade"
    }),
    email: text("email")
});

export const alertWebhookActions = sqliteTable("alertWebhookActions", {
    webhookActionId: integer("webhookActionId").primaryKey({
        autoIncrement: true
    }),
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    webhookUrl: text("webhookUrl").notNull(),
    config: text("config"), // encrypted JSON with auth config (authType, credentials)
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastSentAt: integer("lastSentAt")
});

export const trialNotifications = sqliteTable("trialNotifications", {
    notificationId: integer("notificationId").primaryKey({
        autoIncrement: true
    }),
    subscriptionId: text("subscriptionId")
        .notNull()
        .references(() => subscriptions.subscriptionId, {
            onDelete: "cascade"
        }),
    notificationType: text("notificationType").notNull(), // trial_ending_5d, trial_ending_24h, trial_ended
    sentAt: integer("sentAt").notNull()
});

export type Approval = InferSelectModel<typeof approvals>;
export type Limit = InferSelectModel<typeof limits>;
export type Account = InferSelectModel<typeof account>;
export type Certificate = InferSelectModel<typeof certificates>;
export type DnsChallenge = InferSelectModel<typeof dnsChallenge>;
export type Customer = InferSelectModel<typeof customers>;
export type Subscription = InferSelectModel<typeof subscriptions>;
export type SubscriptionItem = InferSelectModel<typeof subscriptionItems>;
export type Usage = InferSelectModel<typeof usage>;
export type UsageLimit = InferSelectModel<typeof limits>;
export type AccountDomain = InferSelectModel<typeof accountDomains>;
export type UsageNotification = InferSelectModel<typeof usageNotifications>;
export type RemoteExitNode = InferSelectModel<typeof remoteExitNodes>;
export type RemoteExitNodeSession = InferSelectModel<
    typeof remoteExitNodeSessions
>;
export type ExitNodeOrg = InferSelectModel<typeof exitNodeOrgs>;
export type LoginPage = InferSelectModel<typeof loginPage>;
export type LoginPageBranding = InferSelectModel<typeof loginPageBranding>;
export type ActionAuditLog = InferSelectModel<typeof actionAuditLog>;
export type AccessAuditLog = InferSelectModel<typeof accessAuditLog>;
export type ConnectionAuditLog = InferSelectModel<typeof connectionAuditLog>;
export type BannedEmail = InferSelectModel<typeof bannedEmails>;
export type BannedIp = InferSelectModel<typeof bannedIps>;
export type SiteProvisioningKey = InferSelectModel<typeof siteProvisioningKeys>;
export type EventStreamingDestination = InferSelectModel<
    typeof eventStreamingDestinations
>;
export type EventStreamingCursor = InferSelectModel<
    typeof eventStreamingCursors
>;
export type AlertResources = InferSelectModel<typeof alertResources>;
export type AlertHealthChecks = InferSelectModel<typeof alertHealthChecks>;
export type AlertSites = InferSelectModel<typeof alertSites>;
export type AlertRule = InferSelectModel<typeof alertRules>;
export type AlertEmailAction = InferSelectModel<typeof alertEmailActions>;
export type AlertEmailRecipient = InferSelectModel<typeof alertEmailRecipients>;
export type AlertWebhookAction = InferSelectModel<typeof alertWebhookActions>;
export type TrialNotification = InferSelectModel<typeof trialNotifications>;
