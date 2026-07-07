import {
    pgTable,
    serial,
    varchar,
    unique,
    boolean,
    integer,
    bigint,
    real,
    text,
    index,
    primaryKey,
    uniqueIndex
} from "drizzle-orm/pg-core";
import { InferSelectModel, sql } from "drizzle-orm";
import {
    domains,
    orgs,
    targets,
    roles,
    users,
    exitNodes,
    resources,
    siteResources,
    targetHealthCheck,
    sites,
    clients,
    sessions,
    labels
} from "./schema";

export const certificates = pgTable("certificates", {
    certId: serial("certId").primaryKey(),
    domain: varchar("domain", { length: 255 }).notNull().unique(),
    domainId: varchar("domainId").references(() => domains.domainId, {
        onDelete: "cascade"
    }),
    wildcard: boolean("wildcard").default(false),
    status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, requested, valid, expired, failed
    expiresAt: bigint("expiresAt", { mode: "number" }),
    lastRenewalAttempt: bigint("lastRenewalAttempt", { mode: "number" }),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
    orderId: varchar("orderId", { length: 500 }),
    errorMessage: text("errorMessage"),
    renewalCount: integer("renewalCount").default(0),
    certFile: text("certFile"),
    keyFile: text("keyFile")
});

export const dnsChallenge = pgTable("dnsChallenges", {
    dnsChallengeId: serial("dnsChallengeId").primaryKey(),
    domain: varchar("domain", { length: 255 }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    keyAuthorization: varchar("keyAuthorization", { length: 1000 }).notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
    completed: boolean("completed").default(false)
});

export const account = pgTable("account", {
    accountId: serial("accountId").primaryKey(),
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" })
});

export const customers = pgTable("customers", {
    customerId: varchar("customerId", { length: 255 }).primaryKey().notNull(),
    orgId: varchar("orgId", { length: 255 })
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    // accountId: integer("accountId")
    //     .references(() => account.accountId, { onDelete: "cascade" }), // Optional, if using accounts
    email: varchar("email", { length: 255 }),
    name: varchar("name", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    address: text("address"),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
});

export const subscriptions = pgTable("subscriptions", {
    subscriptionId: varchar("subscriptionId", { length: 255 })
        .primaryKey()
        .notNull(),
    customerId: varchar("customerId", { length: 255 })
        .notNull()
        .references(() => customers.customerId, { onDelete: "cascade" }),
    status: varchar("status", { length: 50 }).notNull().default("active"), // active, past_due, canceled, unpaid
    canceledAt: bigint("canceledAt", { mode: "number" }),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }),
    version: integer("version"),
    billingCycleAnchor: bigint("billingCycleAnchor", { mode: "number" }),
    expiresAt: bigint("expiresAt", { mode: "number" }),
    trial: boolean("trial").default(false),
    type: varchar("type", { length: 50 }) // tier1, tier2, tier3, or license
});

export const subscriptionItems = pgTable("subscriptionItems", {
    subscriptionItemId: serial("subscriptionItemId").primaryKey(),
    stripeSubscriptionItemId: varchar("stripeSubscriptionItemId", {
        length: 255
    }),
    subscriptionId: varchar("subscriptionId", { length: 255 })
        .notNull()
        .references(() => subscriptions.subscriptionId, {
            onDelete: "cascade"
        }),
    planId: varchar("planId", { length: 255 }).notNull(),
    priceId: varchar("priceId", { length: 255 }),
    featureId: varchar("featureId", { length: 255 }),
    meterId: varchar("meterId", { length: 255 }),
    unitAmount: real("unitAmount"),
    tiers: text("tiers"),
    interval: varchar("interval", { length: 50 }),
    currentPeriodStart: bigint("currentPeriodStart", { mode: "number" }),
    currentPeriodEnd: bigint("currentPeriodEnd", { mode: "number" }),
    name: varchar("name", { length: 255 })
});

export const accountDomains = pgTable("accountDomains", {
    accountId: integer("accountId")
        .notNull()
        .references(() => account.accountId, { onDelete: "cascade" }),
    domainId: varchar("domainId")
        .notNull()
        .references(() => domains.domainId, { onDelete: "cascade" })
});

export const usage = pgTable("usage", {
    usageId: varchar("usageId", { length: 255 }).primaryKey(),
    featureId: varchar("featureId", { length: 255 }).notNull(),
    orgId: varchar("orgId")
        .references(() => orgs.orgId, { onDelete: "cascade" })
        .notNull(),
    meterId: varchar("meterId", { length: 255 }),
    instantaneousValue: real("instantaneousValue"),
    latestValue: real("latestValue").notNull(),
    previousValue: real("previousValue"),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
    rolledOverAt: bigint("rolledOverAt", { mode: "number" }),
    nextRolloverAt: bigint("nextRolloverAt", { mode: "number" })
});

export const limits = pgTable("limits", {
    limitId: varchar("limitId", { length: 255 }).primaryKey(),
    featureId: varchar("featureId", { length: 255 }).notNull(),
    orgId: varchar("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull(),
    value: real("value"),
    override: boolean("override").default(false),
    description: text("description")
});

export const usageNotifications = pgTable("usageNotifications", {
    notificationId: serial("notificationId").primaryKey(),
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    featureId: varchar("featureId", { length: 255 }).notNull(),
    limitId: varchar("limitId", { length: 255 }).notNull(),
    notificationType: varchar("notificationType", { length: 50 }).notNull(),
    sentAt: bigint("sentAt", { mode: "number" }).notNull()
});

export const domainNamespaces = pgTable("domainNamespaces", {
    domainNamespaceId: varchar("domainNamespaceId", {
        length: 255
    }).primaryKey(),
    domainId: varchar("domainId")
        .references(() => domains.domainId, {
            onDelete: "set null"
        })
        .notNull()
});

export const exitNodeOrgs = pgTable("exitNodeOrgs", {
    exitNodeId: integer("exitNodeId")
        .notNull()
        .references(() => exitNodes.exitNodeId, { onDelete: "cascade" }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const remoteExitNodes = pgTable("remoteExitNode", {
    remoteExitNodeId: varchar("id").primaryKey(),
    secretHash: varchar("secretHash").notNull(),
    dateCreated: varchar("dateCreated").notNull(),
    version: varchar("version"),
    secondaryVersion: varchar("secondaryVersion"), // This is to detect the new nodes after the transition to pangolin-node
    exitNodeId: integer("exitNodeId").references(() => exitNodes.exitNodeId, {
        onDelete: "cascade"
    })
});

export const remoteExitNodeResources = pgTable("remoteExitNodeResources", {
    remoteExitNodeResourceId: serial("remoteExitNodeResourceId").primaryKey(),
    remoteExitNodeId: varchar("remoteExitNodeId")
        .notNull()
        .references(() => remoteExitNodes.remoteExitNodeId, {
            onDelete: "cascade"
        }),
    destination: varchar("destination").notNull() // a cidr range
});

export const remoteExitNodePreferenceLabels = pgTable(
    // this controls what sites are enforced to connect to this node
    "remoteExitNodePreferenceLabels",
    {
        remoteExitNodePreferenceLabelId: serial(
            "remoteExitNodePreferenceLabelId"
        ).primaryKey(),
        remoteExitNodeId: varchar("remoteExitNodeId")
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
        unique("remote_exit_node_preference_label_uniq").on(
            t.remoteExitNodeId,
            t.labelId
        )
    ]
);

export const remoteExitNodeSessions = pgTable("remoteExitNodeSession", {
    sessionId: varchar("id").primaryKey(),
    remoteExitNodeId: varchar("remoteExitNodeId")
        .notNull()
        .references(() => remoteExitNodes.remoteExitNodeId, {
            onDelete: "cascade"
        }),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const loginPage = pgTable(
    "loginPage",
    {
        loginPageId: serial("loginPageId").primaryKey(),
        subdomain: varchar("subdomain"),
        fullDomain: varchar("fullDomain"),
        exitNodeId: integer("exitNodeId").references(
            () => exitNodes.exitNodeId,
            {
                onDelete: "set null"
            }
        ),
        domainId: varchar("domainId").references(() => domains.domainId, {
            onDelete: "set null"
        })
    },
    (t) => [
        index("idx_loginpage_fulldomain")
            .on(t.fullDomain)
            .where(sql`${t.fullDomain} IS NOT NULL`)
    ]
);

export const loginPageOrg = pgTable("loginPageOrg", {
    loginPageId: integer("loginPageId")
        .notNull()
        .references(() => loginPage.loginPageId, { onDelete: "cascade" }),
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const loginPageBranding = pgTable("loginPageBranding", {
    loginPageBrandingId: serial("loginPageBrandingId").primaryKey(),
    logoUrl: text("logoUrl"),
    logoWidth: integer("logoWidth").notNull(),
    logoHeight: integer("logoHeight").notNull(),
    primaryColor: text("primaryColor"),
    resourceTitle: text("resourceTitle").notNull(),
    resourceSubtitle: text("resourceSubtitle"),
    orgTitle: text("orgTitle"),
    orgSubtitle: text("orgSubtitle")
});

export const loginPageBrandingOrg = pgTable("loginPageBrandingOrg", {
    loginPageBrandingId: integer("loginPageBrandingId")
        .notNull()
        .references(() => loginPageBranding.loginPageBrandingId, {
            onDelete: "cascade"
        }),
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const sessionTransferToken = pgTable("sessionTransferToken", {
    token: varchar("token").primaryKey(),
    sessionId: varchar("sessionId")
        .notNull()
        .references(() => sessions.sessionId, {
            onDelete: "cascade"
        }),
    encryptedSession: text("encryptedSession").notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const actionAuditLog = pgTable(
    "actionAuditLog",
    {
        id: serial("id").primaryKey(),
        timestamp: bigint("timestamp", { mode: "number" }).notNull(), // this is EPOCH time in seconds
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        actorType: varchar("actorType", { length: 50 }).notNull(),
        actor: varchar("actor", { length: 255 }).notNull(),
        actorId: varchar("actorId", { length: 255 }).notNull(),
        action: varchar("action", { length: 100 }).notNull(),
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

export const accessAuditLog = pgTable(
    "accessAuditLog",
    {
        id: serial("id").primaryKey(),
        timestamp: bigint("timestamp", { mode: "number" }).notNull(), // this is EPOCH time in seconds
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        actorType: varchar("actorType", { length: 50 }),
        actor: varchar("actor", { length: 255 }),
        actorId: varchar("actorId", { length: 255 }),
        resourceId: integer("resourceId"),
        siteResourceId: integer("siteResourceId"),
        ip: varchar("ip", { length: 45 }),
        type: varchar("type", { length: 100 }).notNull(),
        action: boolean("action").notNull(),
        location: text("location"),
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

export const connectionAuditLog = pgTable(
    "connectionAuditLog",
    {
        id: serial("id").primaryKey(),
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

export const approvals = pgTable("approvals", {
    approvalId: serial("approvalId").primaryKey(),
    timestamp: integer("timestamp").notNull(), // this is EPOCH time in seconds
    orgId: varchar("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull(),
    clientId: integer("clientId").references(() => clients.clientId, {
        onDelete: "cascade"
    }), // clients reference user devices (in this case)
    userId: varchar("userId")
        .references(() => users.userId, {
            // optionally tied to a user and in this case delete when the user deletes
            onDelete: "cascade"
        })
        .notNull(),
    decision: varchar("decision")
        .$type<"approved" | "denied" | "pending">()
        .default("pending")
        .notNull(),
    type: varchar("type")
        .$type<"user_device" /*| 'proxy' // for later */>()
        .notNull()
});

export const bannedEmails = pgTable("bannedEmails", {
    email: varchar("email", { length: 255 }).primaryKey()
});

export const bannedIps = pgTable("bannedIps", {
    ip: varchar("ip", { length: 255 }).primaryKey()
});

export const siteProvisioningKeys = pgTable("siteProvisioningKeys", {
    siteProvisioningKeyId: varchar("siteProvisioningKeyId", {
        length: 255
    }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    siteProvisioningKeyHash: text("siteProvisioningKeyHash").notNull(),
    lastChars: varchar("lastChars", { length: 4 }).notNull(),
    createdAt: varchar("dateCreated", { length: 255 }).notNull(),
    lastUsed: varchar("lastUsed", { length: 255 }),
    maxBatchSize: integer("maxBatchSize"), // null = no limit
    numUsed: integer("numUsed").notNull().default(0),
    validUntil: varchar("validUntil", { length: 255 }),
    approveNewSites: boolean("approveNewSites").notNull().default(true)
});

export const siteProvisioningKeyOrg = pgTable(
    "siteProvisioningKeyOrg",
    {
        siteProvisioningKeyId: varchar("siteProvisioningKeyId", {
            length: 255
        })
            .notNull()
            .references(() => siteProvisioningKeys.siteProvisioningKeyId, {
                onDelete: "cascade"
            }),
        orgId: varchar("orgId", { length: 255 })
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" })
    },
    (table) => [
        primaryKey({
            columns: [table.siteProvisioningKeyId, table.orgId]
        })
    ]
);

export const eventStreamingDestinations = pgTable(
    "eventStreamingDestinations",
    {
        destinationId: serial("destinationId").primaryKey(),
        orgId: varchar("orgId", { length: 255 })
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        sendConnectionLogs: boolean("sendConnectionLogs")
            .notNull()
            .default(false),
        sendRequestLogs: boolean("sendRequestLogs").notNull().default(false),
        sendActionLogs: boolean("sendActionLogs").notNull().default(false),
        sendAccessLogs: boolean("sendAccessLogs").notNull().default(false),
        type: varchar("type", { length: 50 }).notNull(), // e.g. "http", "kafka", etc.
        config: text("config").notNull(), // JSON string with the configuration for the destination
        enabled: boolean("enabled").notNull().default(true),
        lastError: text("lastError"), // last send error message, null if healthy
        lastErrorAt: bigint("lastErrorAt", { mode: "number" }), // epoch ms of last error, null if healthy
        createdAt: bigint("createdAt", { mode: "number" }).notNull(),
        updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
    }
);

export const eventStreamingCursors = pgTable(
    "eventStreamingCursors",
    {
        cursorId: serial("cursorId").primaryKey(),
        destinationId: integer("destinationId")
            .notNull()
            .references(() => eventStreamingDestinations.destinationId, {
                onDelete: "cascade"
            }),
        logType: varchar("logType", { length: 50 }).notNull(), // "request" | "action" | "access" | "connection"
        lastSentId: bigint("lastSentId", { mode: "number" })
            .notNull()
            .default(0),
        lastSentAt: bigint("lastSentAt", { mode: "number" }) // epoch milliseconds, null if never sent
    },
    (table) => [
        uniqueIndex("idx_eventStreamingCursors_dest_type").on(
            table.destinationId,
            table.logType
        )
    ]
);

export const alertRules = pgTable("alertRules", {
    alertRuleId: serial("alertRuleId").primaryKey(),
    orgId: varchar("orgId", { length: 255 })
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // Single field encodes both source and trigger - no redundancy
    eventType: varchar("eventType", { length: 100 })
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
    // Nullable depending on eventType
    enabled: boolean("enabled").notNull().default(true),
    cooldownSeconds: integer("cooldownSeconds").notNull().default(300),
    allSites: boolean("allSites").notNull().default(false),
    allHealthChecks: boolean("allHealthChecks").notNull().default(false),
    allResources: boolean("allResources").notNull().default(false),
    lastTriggeredAt: bigint("lastTriggeredAt", { mode: "number" }), // nullable
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
});

export const alertSites = pgTable("alertSites", {
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    siteId: integer("siteId")
        .notNull()
        .references(() => sites.siteId, { onDelete: "cascade" })
});

export const alertHealthChecks = pgTable("alertHealthChecks", {
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    healthCheckId: integer("healthCheckId")
        .notNull()
        .references(() => targetHealthCheck.targetHealthCheckId, {
            onDelete: "cascade"
        })
});

export const alertResources = pgTable("alertResources", {
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

// Separating channels by type avoids the mixed-shape problem entirely
export const alertEmailActions = pgTable("alertEmailActions", {
    emailActionId: serial("emailActionId").primaryKey(),
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    lastSentAt: bigint("lastSentAt", { mode: "number" }) // nullable
});

export const alertEmailRecipients = pgTable("alertEmailRecipients", {
    recipientId: serial("recipientId").primaryKey(),
    emailActionId: integer("emailActionId")
        .notNull()
        .references(() => alertEmailActions.emailActionId, {
            onDelete: "cascade"
        }),
    // At least one of these should be set - enforced at app level
    userId: varchar("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    roleId: integer("roleId").references(() => roles.roleId, {
        onDelete: "cascade"
    }),
    email: varchar("email", { length: 255 }) // external emails not tied to a user
});

export const alertWebhookActions = pgTable("alertWebhookActions", {
    webhookActionId: serial("webhookActionId").primaryKey(),
    alertRuleId: integer("alertRuleId")
        .notNull()
        .references(() => alertRules.alertRuleId, { onDelete: "cascade" }),
    webhookUrl: text("webhookUrl").notNull(),
    config: text("config"), // encrypted JSON with auth config (authType, credentials)
    enabled: boolean("enabled").notNull().default(true),
    lastSentAt: bigint("lastSentAt", { mode: "number" }) // nullable
});

export const trialNotifications = pgTable("trialNotifications", {
    notificationId: serial("notificationId").primaryKey(),
    subscriptionId: varchar("subscriptionId", { length: 255 })
        .notNull()
        .references(() => subscriptions.subscriptionId, {
            onDelete: "cascade"
        }),
    notificationType: varchar("notificationType", { length: 50 }).notNull(), // trial_ending_5d, trial_ending_24h, trial_ended
    sentAt: bigint("sentAt", { mode: "number" }).notNull()
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
export type SessionTransferToken = InferSelectModel<
    typeof sessionTransferToken
>;
export type BannedEmail = InferSelectModel<typeof bannedEmails>;
export type BannedIp = InferSelectModel<typeof bannedIps>;
export type SiteProvisioningKey = InferSelectModel<typeof siteProvisioningKeys>;
export type SiteProvisioningKeyOrg = InferSelectModel<
    typeof siteProvisioningKeyOrg
>;
export type EventStreamingDestination = InferSelectModel<
    typeof eventStreamingDestinations
>;
export type EventStreamingCursor = InferSelectModel<
    typeof eventStreamingCursors
>;
export type AlertResources = InferSelectModel<typeof alertResources>;
export type AlertHealthChecks = InferSelectModel<typeof alertHealthChecks>;
export type AlertSites = InferSelectModel<typeof alertSites>;
export type AlertRules = InferSelectModel<typeof alertRules>;
export type AlertEmailActions = InferSelectModel<typeof alertEmailActions>;
export type AlertEmailRecipients = InferSelectModel<
    typeof alertEmailRecipients
>;
export type AlertWebhookActions = InferSelectModel<typeof alertWebhookActions>;
export type TrialNotification = InferSelectModel<typeof trialNotifications>;
