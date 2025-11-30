import {
    sqliteTable,
    integer,
    text,
    real,
    index
} from "drizzle-orm/sqlite-core";
import { InferSelectModel } from "drizzle-orm";
import { domains, orgs, targets, users, exitNodes, sessions } from "./schema";
import { metadata } from "@app/app/[orgId]/settings/layout";

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
    dnsChallengeId: integer("dnsChallengeId").primaryKey({ autoIncrement: true }),
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
    subscriptionId: text("subscriptionId")
        .primaryKey()
        .notNull(),
    customerId: text("customerId")
        .notNull()
        .references(() => customers.customerId, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"), // active, past_due, canceled, unpaid
    canceledAt: integer("canceledAt"),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt"),
    billingCycleAnchor: integer("billingCycleAnchor")
});

export const subscriptionItems = sqliteTable("subscriptionItems", {
    subscriptionItemId: integer("subscriptionItemId").primaryKey({ autoIncrement: true }),
    subscriptionId: text("subscriptionId")
        .notNull()
        .references(() => subscriptions.subscriptionId, {
            onDelete: "cascade"
        }),
    planId: text("planId").notNull(),
    priceId: text("priceId"),
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
    description: text("description")
});

export const usageNotifications = sqliteTable("usageNotifications", {
    notificationId: integer("notificationId").primaryKey({ autoIncrement: true }),
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

export const actionAuditLog = sqliteTable("actionAuditLog", {
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
}, (table) => ([
    index("idx_actionAuditLog_timestamp").on(table.timestamp),
    index("idx_actionAuditLog_org_timestamp").on(table.orgId, table.timestamp)
]));

export const accessAuditLog = sqliteTable("accessAuditLog", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    timestamp: integer("timestamp").notNull(), // this is EPOCH time in seconds
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    actorType: text("actorType"),
    actor: text("actor"),
    actorId: text("actorId"),
    resourceId: integer("resourceId"),
    ip: text("ip"),
    location: text("location"),
    type: text("type").notNull(),
    action: integer("action", { mode: "boolean" }).notNull(),
    userAgent: text("userAgent"),
    metadata: text("metadata")
}, (table) => ([
    index("idx_identityAuditLog_timestamp").on(table.timestamp),
    index("idx_identityAuditLog_org_timestamp").on(table.orgId, table.timestamp)
]));

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
export type ActionAuditLog = InferSelectModel<typeof actionAuditLog>;
export type AccessAuditLog = InferSelectModel<typeof accessAuditLog>;