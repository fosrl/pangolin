import {
    pgTable,
    serial,
    varchar,
    boolean,
    integer,
    bigint,
    real,
    text,
    index
} from "drizzle-orm/pg-core";
import { InferSelectModel } from "drizzle-orm";
import { domains, orgs, targets, users, exitNodes, sessions } from "./schema";

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
    billingCycleAnchor: bigint("billingCycleAnchor", { mode: "number" })
});

export const subscriptionItems = pgTable("subscriptionItems", {
    subscriptionItemId: serial("subscriptionItemId").primaryKey(),
    subscriptionId: varchar("subscriptionId", { length: 255 })
        .notNull()
        .references(() => subscriptions.subscriptionId, {
            onDelete: "cascade"
        }),
    planId: varchar("planId", { length: 255 }).notNull(),
    priceId: varchar("priceId", { length: 255 }),
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

export const remoteExitNodeSessions = pgTable("remoteExitNodeSession", {
    sessionId: varchar("id").primaryKey(),
    remoteExitNodeId: varchar("remoteExitNodeId")
        .notNull()
        .references(() => remoteExitNodes.remoteExitNodeId, {
            onDelete: "cascade"
        }),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const loginPage = pgTable("loginPage", {
    loginPageId: serial("loginPageId").primaryKey(),
    subdomain: varchar("subdomain"),
    fullDomain: varchar("fullDomain"),
    exitNodeId: integer("exitNodeId").references(() => exitNodes.exitNodeId, {
        onDelete: "set null"
    }),
    domainId: varchar("domainId").references(() => domains.domainId, {
        onDelete: "set null"
    })
});

export const loginPageOrg = pgTable("loginPageOrg", {
    loginPageId: integer("loginPageId")
        .notNull()
        .references(() => loginPage.loginPageId, { onDelete: "cascade" }),
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

export const actionAuditLog = pgTable("actionAuditLog", {
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
}, (table) => ([
    index("idx_actionAuditLog_timestamp").on(table.timestamp),
    index("idx_actionAuditLog_org_timestamp").on(table.orgId, table.timestamp)
]));

export const accessAuditLog = pgTable("accessAuditLog", {
    id: serial("id").primaryKey(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(), // this is EPOCH time in seconds
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    actorType: varchar("actorType", { length: 50 }),
    actor: varchar("actor", { length: 255 }),
    actorId: varchar("actorId", { length: 255 }),
    resourceId: integer("resourceId"),
    ip: varchar("ip", { length: 45 }),
    type: varchar("type", { length: 100 }).notNull(),
    action: boolean("action").notNull(),
    location: text("location"),
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