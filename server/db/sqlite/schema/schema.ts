import { randomUUID } from "crypto";
import { InferSelectModel, sql } from "drizzle-orm";
import {
    index,
    integer,
    primaryKey,
    real,
    sqliteTable,
    text,
    unique,
    uniqueIndex
} from "drizzle-orm/sqlite-core";
import type { ClientAuthenticationMethod } from "@server/lib/oauth/clientAuthMethods";

export const domains = sqliteTable("domains", {
    domainId: text("domainId").primaryKey(),
    baseDomain: text("baseDomain").notNull(),
    configManaged: integer("configManaged", { mode: "boolean" })
        .notNull()
        .default(false),
    type: text("type").$type<"ns" | "cname" | "wildcard">(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    failed: integer("failed", { mode: "boolean" }).notNull().default(false),
    tries: integer("tries").notNull().default(0),
    certResolver: text("certResolver"),
    customCertResolver: text("customCertResolver"),
    preferWildcardCert: integer("preferWildcardCert", { mode: "boolean" }),
    errorMessage: text("errorMessage"),
    lastCheckedAt: integer("lastCheckedAt")
});

export const dnsRecords = sqliteTable("dnsRecords", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    domainId: text("domainId")
        .notNull()
        .references(() => domains.domainId, { onDelete: "cascade" }),

    recordType: text("recordType").notNull(), // "NS" | "CNAME" | "A" | "TXT"
    baseDomain: text("baseDomain"),
    value: text("value").notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false)
});

export const orgs = sqliteTable("orgs", {
    orgId: text("orgId").primaryKey(),
    name: text("name").notNull(),
    subnet: text("subnet"),
    utilitySubnet: text("utilitySubnet"), // this is the subnet for utility addresses
    createdAt: text("createdAt"),
    requireTwoFactor: integer("requireTwoFactor", { mode: "boolean" }),
    maxSessionLengthHours: integer("maxSessionLengthHours"), // hours
    passwordExpiryDays: integer("passwordExpiryDays"), // days
    settingsLogRetentionDaysRequest: integer("settingsLogRetentionDaysRequest") // where 0 = dont keep logs and -1 = keep forever and 9001 = end of the following year
        .notNull()
        .default(7),
    settingsLogRetentionDaysAccess: integer("settingsLogRetentionDaysAccess") // where 0 = dont keep logs and -1 = keep forever and 9001 = end of the following year
        .notNull()
        .default(0),
    settingsLogRetentionDaysAction: integer("settingsLogRetentionDaysAction") // where 0 = dont keep logs and -1 = keep forever and 9001 = end of the following year
        .notNull()
        .default(0),
    settingsLogRetentionDaysConnection: integer(
        "settingsLogRetentionDaysConnection"
    ) // where 0 = dont keep logs and -1 = keep forever and 9001 = end of the following year
        .notNull()
        .default(0),
    settingsLogRetentionDaysAISessions: integer(
        "settingsLogRetentionDaysAISessions"
    ) // where 0 = dont keep logs and -1 = keep forever and 9001 = end of the following year
        .notNull()
        .default(7),
    sshCaPrivateKey: text("sshCaPrivateKey"), // Encrypted SSH CA private key (PEM format)
    sshCaPublicKey: text("sshCaPublicKey"), // SSH CA public key (OpenSSH format)
    isBillingOrg: integer("isBillingOrg", { mode: "boolean" }),
    billingOrgId: text("billingOrgId"),
    settingsEnableGlobalNewtAutoUpdate: integer(
        "settingsEnableGlobalNewtAutoUpdate",
        { mode: "boolean" }
    )
        .notNull()
        .default(false)
});

export const userDomains = sqliteTable("userDomains", {
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    domainId: text("domainId")
        .notNull()
        .references(() => domains.domainId, { onDelete: "cascade" })
});

export const orgDomains = sqliteTable("orgDomains", {
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    domainId: text("domainId")
        .notNull()
        .references(() => domains.domainId, { onDelete: "cascade" })
});

export const sites = sqliteTable(
    "sites",
    {
        siteId: integer("siteId").primaryKey({ autoIncrement: true }),
        orgId: text("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        niceId: text("niceId").notNull(),
        exitNodeId: integer("exitNode").references(() => exitNodes.exitNodeId, {
            onDelete: "set null"
        }),
        networkId: integer("networkId").references(() => networks.networkId, {
            onDelete: "set null"
        }),
        name: text("name").notNull(),
        pubKey: text("pubKey"),
        exitNodeSubnet: text("exitNodeSubnet"),
        megabytesIn: integer("bytesIn").default(0),
        megabytesOut: integer("bytesOut").default(0),
        lastBandwidthUpdate: text("lastBandwidthUpdate"),
        type: text("type").notNull(), // "newt" or "wireguard"
        online: integer("online", { mode: "boolean" }).notNull().default(false),
        lastPing: integer("lastPing"),

        // exit node stuff that is how to connect to the site when it has a wg server
        address: text("address"), // this is the address of the wireguard interface in newt
        endpoint: text("endpoint"), // this is how to reach gerbil externally - gets put into the wireguard config
        localEndpoints: text("localEndpoints"), // JSON encoded list of string ips on the local machine to try to connect to
        publicKey: text("publicKey"), // TODO: Fix typo in publicKey
        lastHolePunch: integer("lastHolePunch"),
        listenPort: integer("listenPort"),
        dockerSocketEnabled: integer("dockerSocketEnabled", { mode: "boolean" })
            .notNull()
            .default(true),
        autoUpdateEnabled: integer("autoUpdateEnabled", { mode: "boolean" })
            .notNull()
            .default(false),
        autoUpdateOverrideOrg: integer("autoUpdateOverrideOrg", {
            mode: "boolean"
        })
            .notNull()
            .default(false),
        status: text("status")
            .$type<"pending" | "approved">()
            .default("approved")
    },
    (table) => [index("idx_sites_orgId").on(table.orgId)]
);

export const resources = sqliteTable(
    "resources",
    {
        resourceId: integer("resourceId").primaryKey({ autoIncrement: true }),
        resourcePolicyId: integer("resourcePolicyId").references(
            () => resourcePolicies.resourcePolicyId,
            { onDelete: "set null" }
        ),
        defaultResourcePolicyId: integer("defaultResourcePolicyId").references(
            () => resourcePolicies.resourcePolicyId,
            {
                onDelete: "restrict"
            }
        ),
        resourceGuid: text("resourceGuid", { length: 36 })
            .unique()
            .notNull()
            .$defaultFn(() => randomUUID()),
        orgId: text("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        niceId: text("niceId").notNull(),
        name: text("name").notNull(),
        subdomain: text("subdomain"),
        fullDomain: text("fullDomain"),
        domainId: text("domainId").references(() => domains.domainId, {
            onDelete: "set null"
        }),
        ssl: integer("ssl", { mode: "boolean" }).notNull().default(false),
        blockAccess: integer("blockAccess", { mode: "boolean" })
            .notNull()
            .default(false),
        proxyPort: integer("proxyPort"),
        sso: integer("sso", { mode: "boolean" }),
        emailWhitelistEnabled: integer("emailWhitelistEnabled", {
            mode: "boolean"
        }),
        applyRules: integer("applyRules", { mode: "boolean" }),
        enabled: integer("enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        stickySession: integer("stickySession", { mode: "boolean" })
            .notNull()
            .default(false),
        tlsServerName: text("tlsServerName"),
        setHostHeader: text("setHostHeader"),
        enableProxy: integer("enableProxy", { mode: "boolean" }).default(true),
        skipToIdpId: integer("skipToIdpId").references(() => idp.idpId, {
            onDelete: "set null"
        }),
        headers: text("headers"), // comma-separated list of headers to add to the request
        proxyProtocol: integer("proxyProtocol", { mode: "boolean" })
            .notNull()
            .default(false),
        proxyProtocolVersion: integer("proxyProtocolVersion").default(1),
        maintenanceModeEnabled: integer("maintenanceModeEnabled", {
            mode: "boolean"
        })
            .notNull()
            .default(false),
        maintenanceModeType: text("maintenanceModeType", {
            enum: ["forced", "automatic"]
        }).default("forced"), // "forced" = always show, "automatic" = only when down
        maintenanceTitle: text("maintenanceTitle"),
        maintenanceMessage: text("maintenanceMessage"),
        maintenanceEstimatedTime: text("maintenanceEstimatedTime"),
        postAuthPath: text("postAuthPath"),
        health: text("health").default("unknown"), // "healthy", "unhealthy", "unknown"
        wildcard: integer("wildcard", { mode: "boolean" })
            .notNull()
            .default(false),
        mode: text("mode")
            .default("http")
            .$type<
                "rdp" | "ssh" | "http" | "vnc" | "inference" | "tcp" | "udp"
            >()
            .notNull(), // rdp, ssh, http, vnc, inference
        pamMode: text("pamMode")
            .$type<"passthrough" | "push">()
            .default("passthrough"),
        authDaemonMode: text("authDaemonMode")
            .$type<"site" | "remote" | "native">()
            .default("site"),
        authDaemonPort: integer("authDaemonPort").default(22123),
        status: text("status")
            .$type<"pending" | "approved">()
            .default("approved")
    },
    (table) => [index("idx_resources_orgId").on(table.orgId)]
);

export const resourceAiProviders = sqliteTable(
    "resourceAiProviders",
    {
        resourceId: integer("resourceId")
            .notNull()
            .references(() => resources.resourceId, { onDelete: "cascade" }),
        providerId: integer("providerId")
            .notNull()
            .references(() => aiProviders.providerId, { onDelete: "cascade" }),
        accessMode: text("accessMode")
            .$type<"inherit" | "select">()
            .notNull()
            .default("inherit"),
        enabled: integer("enabled", { mode: "boolean" }).notNull().default(true)
    },
    (t) => [primaryKey({ columns: [t.resourceId, t.providerId] })]
);

export const resourceAiModels = sqliteTable(
    "resourceAiModels",
    {
        resourceId: integer("resourceId")
            .notNull()
            .references(() => resources.resourceId, { onDelete: "cascade" }),
        modelId: integer("modelId")
            .notNull()
            .references(() => aiModels.modelId, { onDelete: "cascade" }),
        listType: text("listType")
            .$type<"allow" | "block">()
            .notNull()
            .default("allow")
    },
    (t) => [primaryKey({ columns: [t.resourceId, t.modelId] })]
);

export const labels = sqliteTable(
    "labels",
    {
        labelId: integer("labelId").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
        color: text("color").notNull(),
        orgId: text("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (table) => [index("idx_labels_orgId").on(table.orgId)]
);

export const launcherViews = sqliteTable("launcherViews", {
    viewId: integer("viewId").primaryKey({ autoIncrement: true }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    userId: text("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    name: text("name").notNull(),
    config: text("config").notNull(),
    isDefault: integer("isDefault", { mode: "boolean" })
        .notNull()
        .default(false),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
});

export const siteLabels = sqliteTable(
    "siteLabels",
    {
        siteLabelId: integer("siteLabelId").primaryKey({ autoIncrement: true }),
        siteId: integer("siteId")
            .references(() => sites.siteId, {
                onDelete: "cascade"
            })
            .notNull(),
        labelId: integer("labelId")
            .references(() => labels.labelId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [unique("site_label_uniq").on(t.siteId, t.labelId)]
);

export const resourceLabels = sqliteTable(
    "resourceLabels",
    {
        resourceLabelId: integer("resourceLabelId").primaryKey({
            autoIncrement: true
        }),
        resourceId: integer("resourceId")
            .references(() => resources.resourceId, {
                onDelete: "cascade"
            })
            .notNull(),
        labelId: integer("labelId")
            .references(() => labels.labelId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [unique("resource_label_uniq").on(t.resourceId, t.labelId)]
);

export const siteResourceLabels = sqliteTable(
    "siteResourceLabels",
    {
        siteResourceLabelId: integer("siteResourceLabelId").primaryKey({
            autoIncrement: true
        }),
        siteResourceId: integer("siteResourceId")
            .references(() => siteResources.siteResourceId, {
                onDelete: "cascade"
            })
            .notNull(),
        labelId: integer("labelId")
            .references(() => labels.labelId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [unique("site_resource_label_uniq").on(t.siteResourceId, t.labelId)]
);

export const clientLabels = sqliteTable(
    "clientLabels",
    {
        clientLabelId: integer("clientLabelId").primaryKey({
            autoIncrement: true
        }),
        clientId: integer("clientId")
            .references(() => clients.clientId, {
                onDelete: "cascade"
            })
            .notNull(),
        labelId: integer("labelId")
            .references(() => labels.labelId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [unique("client_label_uniq").on(t.clientId, t.labelId)]
);

export const targets = sqliteTable(
    "targets",
    {
        targetId: integer("targetId").primaryKey({ autoIncrement: true }),
        resourceId: integer("resourceId").references(
            () => resources.resourceId,
            { onDelete: "cascade" }
        ),
        providerId: integer("providerId").references(
            () => aiProviders.providerId,
            { onDelete: "cascade" }
        ),
        siteId: integer("siteId")
            .references(() => sites.siteId, {
                onDelete: "cascade"
            })
            .notNull(),
        ip: text("ip").notNull(),
        method: text("method"),
        port: integer("port").notNull(),
        internalPort: integer("internalPort"),
        enabled: integer("enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        path: text("path"),
        pathMatchType: text("pathMatchType"), // exact, prefix, regex
        rewritePath: text("rewritePath"), // if set, rewrites the path to this value before sending to the target
        rewritePathType: text("rewritePathType"), // exact, prefix, regex, stripPrefix
        priority: integer("priority").notNull().default(100),
        mode: text("mode")
            .$type<"http" | "tcp" | "udp" | "ssh" | "rdp" | "vnc">()
            .notNull()
            .default("http"),
        authToken: text("authToken")
    },
    (table) => [
        index("idx_targets_resourceId").on(table.resourceId),
        index("idx_targets_siteId").on(table.siteId)
    ]
);

export const targetHealthCheck = sqliteTable("targetHealthCheck", {
    targetHealthCheckId: integer("targetHealthCheckId").primaryKey({
        autoIncrement: true
    }),
    targetId: integer("targetId").references(() => targets.targetId, {
        onDelete: "cascade"
    }),
    orgId: text("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull(),
    siteId: integer("siteId")
        .references(() => sites.siteId, {
            onDelete: "cascade"
        })
        .notNull(),
    name: text("name"),
    hcEnabled: integer("hcEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    hcPath: text("hcPath"),
    hcScheme: text("hcScheme"),
    hcMode: text("hcMode").default("http"),
    hcHostname: text("hcHostname"),
    hcPort: integer("hcPort"),
    hcInterval: integer("hcInterval").default(30), // in seconds
    hcUnhealthyInterval: integer("hcUnhealthyInterval").default(30), // in seconds
    hcTimeout: integer("hcTimeout").default(5), // in seconds
    hcHeaders: text("hcHeaders"),
    hcFollowRedirects: integer("hcFollowRedirects", {
        mode: "boolean"
    }).default(true),
    hcMethod: text("hcMethod").default("GET"),
    hcStatus: integer("hcStatus"), // http code
    hcHealth: text("hcHealth")
        .$type<"unknown" | "healthy" | "unhealthy">()
        .default("unknown"), // "unknown", "healthy", "unhealthy"
    hcTlsServerName: text("hcTlsServerName"),
    hcHealthyThreshold: integer("hcHealthyThreshold").default(1),
    hcUnhealthyThreshold: integer("hcUnhealthyThreshold").default(1)
});

export const exitNodes = sqliteTable("exitNodes", {
    exitNodeId: integer("exitNodeId").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    address: text("address").notNull(), // this is the address of the wireguard interface in gerbil
    endpoint: text("endpoint").notNull(), // this is how to reach gerbil externally - gets put into the wireguard config
    publicKey: text("publicKey").notNull(),
    listenPort: integer("listenPort").notNull(),
    reachableAt: text("reachableAt"), // this is the internal address of the gerbil http server for command control
    maxConnections: integer("maxConnections"),
    online: integer("online", { mode: "boolean" }).notNull().default(false),
    lastPing: integer("lastPing"),
    type: text("type").default("gerbil"), // gerbil, remoteExitNode
    region: text("region")
});

export const siteResources = sqliteTable("siteResources", {
    // this is for the clients
    siteResourceId: integer("siteResourceId").primaryKey({
        autoIncrement: true
    }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    networkId: integer("networkId").references(() => networks.networkId, {
        onDelete: "set null"
    }),
    defaultNetworkId: integer("defaultNetworkId").references(
        () => networks.networkId,
        { onDelete: "restrict" }
    ),
    requiresExitNodeConnection: integer("requiresExitNodeConnection", {
        mode: "boolean"
    })
        .notNull()
        .default(false),
    niceId: text("niceId").notNull(),
    name: text("name").notNull(),
    ssl: integer("ssl", { mode: "boolean" }).notNull().default(false),
    mode: text("mode")
        .$type<"host" | "cidr" | "http" | "ssh" | "inference">()
        .notNull(), // "host" | "cidr" | "http"
    scheme: text("scheme").$type<"http" | "https">(), // only for when we are doing https or http mode
    proxyPort: integer("proxyPort"), // only for port mode
    destinationPort: integer("destinationPort"), // only for port mode
    destination: text("destination"), // ip, cidr, hostname
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    alias: text("alias"),
    aliasAddress: text("aliasAddress"),
    tcpPortRangeString: text("tcpPortRangeString").notNull().default("*"),
    udpPortRangeString: text("udpPortRangeString").notNull().default("*"),
    disableIcmp: integer("disableIcmp", { mode: "boolean" })
        .notNull()
        .default(false),
    authDaemonPort: integer("authDaemonPort").default(22123),
    pamMode: text("pamMode")
        .$type<"passthrough" | "push">()
        .default("passthrough"),
    authDaemonMode: text("authDaemonMode")
        .$type<"site" | "remote" | "native">()
        .default("site"),
    domainId: text("domainId").references(() => domains.domainId, {
        onDelete: "set null"
    }),
    subdomain: text("subdomain"),
    fullDomain: text("fullDomain"),
    status: text("status").$type<"pending" | "approved">().default("approved")
});

export const siteResourceAiProviders = sqliteTable(
    "siteResourceAiProviders",
    {
        siteResourceId: integer("siteResourceId")
            .notNull()
            .references(() => siteResources.siteResourceId, {
                onDelete: "cascade"
            }),
        providerId: integer("providerId")
            .notNull()
            .references(() => aiProviders.providerId, { onDelete: "cascade" }),
        accessMode: text("accessMode")
            .$type<"inherit" | "select">()
            .notNull()
            .default("inherit"),
        enabled: integer("enabled", { mode: "boolean" }).notNull().default(true)
    },
    (t) => [primaryKey({ columns: [t.siteResourceId, t.providerId] })]
);

export const siteResourceAiModels = sqliteTable(
    "siteResourceAiModels",
    {
        siteResourceId: integer("siteResourceId")
            .notNull()
            .references(() => siteResources.siteResourceId, {
                onDelete: "cascade"
            }),
        modelId: integer("modelId")
            .notNull()
            .references(() => aiModels.modelId, { onDelete: "cascade" }),
        listType: text("listType")
            .$type<"allow" | "block">()
            .notNull()
            .default("allow")
    },
    (t) => [primaryKey({ columns: [t.siteResourceId, t.modelId] })]
);

export const networks = sqliteTable("networks", {
    networkId: integer("networkId").primaryKey({ autoIncrement: true }),
    niceId: text("niceId"),
    name: text("name"),
    scope: text("scope")
        .$type<"global" | "resource">()
        .notNull()
        .default("global"),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const siteNetworks = sqliteTable("siteNetworks", {
    siteId: integer("siteId")
        .notNull()
        .references(() => sites.siteId, {
            onDelete: "cascade"
        }),
    networkId: integer("networkId")
        .notNull()
        .references(() => networks.networkId, { onDelete: "cascade" })
});

export const clientSiteResources = sqliteTable("clientSiteResources", {
    clientId: integer("clientId")
        .notNull()
        .references(() => clients.clientId, { onDelete: "cascade" }),
    siteResourceId: integer("siteResourceId")
        .notNull()
        .references(() => siteResources.siteResourceId, { onDelete: "cascade" })
});

export const roleSiteResources = sqliteTable("roleSiteResources", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    siteResourceId: integer("siteResourceId")
        .notNull()
        .references(() => siteResources.siteResourceId, { onDelete: "cascade" })
});

export const userSiteResources = sqliteTable("userSiteResources", {
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    siteResourceId: integer("siteResourceId")
        .notNull()
        .references(() => siteResources.siteResourceId, { onDelete: "cascade" })
});

export const users = sqliteTable("user", {
    userId: text("id").primaryKey(),
    email: text("email"),
    username: text("username").notNull(),
    name: text("name"),
    type: text("type").notNull(), // "internal", "oidc"
    idpId: integer("idpId").references(() => idp.idpId, {
        onDelete: "cascade"
    }),
    passwordHash: text("passwordHash"),
    twoFactorEnabled: integer("twoFactorEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    twoFactorSetupRequested: integer("twoFactorSetupRequested", {
        mode: "boolean"
    }).default(false),
    twoFactorSecret: text("twoFactorSecret"),
    emailVerified: integer("emailVerified", { mode: "boolean" })
        .notNull()
        .default(false),
    dateCreated: text("dateCreated").notNull(),
    termsAcceptedTimestamp: text("termsAcceptedTimestamp"),
    termsVersion: text("termsVersion"),
    marketingEmailConsent: integer("marketingEmailConsent", {
        mode: "boolean"
    }).default(false),
    serverAdmin: integer("serverAdmin", { mode: "boolean" })
        .notNull()
        .default(false),
    lastPasswordChange: integer("lastPasswordChange"),
    locale: text("locale")
});

export const securityKeys = sqliteTable("webauthnCredentials", {
    credentialId: text("credentialId").primaryKey(),
    userId: text("userId")
        .notNull()
        .references(() => users.userId, {
            onDelete: "cascade"
        }),
    publicKey: text("publicKey").notNull(),
    signCount: integer("signCount").notNull(),
    transports: text("transports"),
    name: text("name"),
    lastUsed: text("lastUsed").notNull(),
    dateCreated: text("dateCreated").notNull()
});

export const webauthnChallenge = sqliteTable("webauthnChallenge", {
    sessionId: text("sessionId").primaryKey(),
    challenge: text("challenge").notNull(),
    securityKeyName: text("securityKeyName"),
    userId: text("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    expiresAt: integer("expiresAt").notNull() // Unix timestamp
});

export const setupTokens = sqliteTable("setupTokens", {
    tokenId: text("tokenId").primaryKey(),
    token: text("token").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    dateCreated: text("dateCreated").notNull(),
    dateUsed: text("dateUsed")
});

export const newts = sqliteTable(
    "newt",
    {
        newtId: text("id").primaryKey(),
        secretHash: text("secretHash").notNull(),
        dateCreated: text("dateCreated").notNull(),
        version: text("version"),
        siteId: integer("siteId").references(() => sites.siteId, {
            onDelete: "cascade"
        })
    },
    (table) => [index("idx_newts_siteId").on(table.siteId)]
);

export const clients = sqliteTable(
    "clients",
    {
        clientId: integer("clientId").primaryKey({ autoIncrement: true }),
        orgId: text("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        exitNodeId: integer("exitNode").references(() => exitNodes.exitNodeId, {
            onDelete: "set null"
        }),
        userId: text("userId").references(() => users.userId, {
            // optionally tied to a user and in this case delete when the user deletes
            onDelete: "cascade"
        }),
        niceId: text("niceId").notNull(),
        name: text("name").notNull(),
        pubKey: text("pubKey"),
        olmId: text("olmId"), // to lock it to a specific olm optionally
        subnet: text("subnet").notNull(),
        exitNodeSubnet: text("exitNodeSubnet"), // this is the subnet when connecting to an exit node
        megabytesIn: integer("bytesIn"),
        megabytesOut: integer("bytesOut"),
        lastBandwidthUpdate: text("lastBandwidthUpdate"),
        lastPing: integer("lastPing"),
        type: text("type").notNull(), // "olm"
        online: integer("online", { mode: "boolean" }).notNull().default(false),
        // endpoint: text("endpoint"),
        lastHolePunch: integer("lastHolePunch"),
        archived: integer("archived", { mode: "boolean" })
            .notNull()
            .default(false),
        blocked: integer("blocked", { mode: "boolean" })
            .notNull()
            .default(false),
        approvalState: text("approvalState").$type<
            "pending" | "approved" | "denied"
        >()
    },
    (table) => [
        index("idx_clients_orgId").on(table.orgId),
        index("idx_clients_userId").on(table.userId)
    ]
);

export const clientSitesAssociationsCache = sqliteTable(
    "clientSitesAssociationsCache",
    {
        clientId: integer("clientId") // not a foreign key here so after its deleted the rebuild function can delete it and send the message
            .notNull(),
        siteId: integer("siteId").notNull(),
        isRelayed: integer("isRelayed", { mode: "boolean" })
            .notNull()
            .default(false),
        isJitMode: integer("isJitMode", { mode: "boolean" })
            .notNull()
            .default(false),
        endpoint: text("endpoint"),
        publicKey: text("publicKey") // this will act as the session's public key for hole punching so we can track when it changes
    }
);

export const clientSiteResourcesAssociationsCache = sqliteTable(
    "clientSiteResourcesAssociationsCache",
    {
        clientId: integer("clientId") // not a foreign key here so after its deleted the rebuild function can delete it and send the message
            .notNull(),
        siteResourceId: integer("siteResourceId").notNull()
    }
);

export const olms = sqliteTable(
    "olms",
    {
        olmId: text("id").primaryKey(),
        secretHash: text("secretHash").notNull(),
        dateCreated: text("dateCreated").notNull(),
        version: text("version"),
        agent: text("agent"),
        name: text("name"),
        clientId: integer("clientId").references(() => clients.clientId, {
            // we will switch this depending on the current org it wants to connect to
            onDelete: "set null"
        }),
        userId: text("userId").references(() => users.userId, {
            // optionally tied to a user and in this case delete when the user deletes
            onDelete: "cascade"
        }),
        archived: integer("archived", { mode: "boolean" })
            .notNull()
            .default(false)
    },
    (table) => [index("idx_olms_userId").on(table.userId)]
);

export const currentFingerprint = sqliteTable("currentFingerprint", {
    fingerprintId: integer("id").primaryKey({ autoIncrement: true }),

    olmId: text("olmId")
        .references(() => olms.olmId, { onDelete: "cascade" })
        .notNull(),

    firstSeen: integer("firstSeen").notNull(),
    lastSeen: integer("lastSeen").notNull(),
    lastCollectedAt: integer("lastCollectedAt").notNull(),

    username: text("username"),
    hostname: text("hostname"),
    platform: text("platform"),
    osVersion: text("osVersion"),
    kernelVersion: text("kernelVersion"),
    arch: text("arch"),
    deviceModel: text("deviceModel"),
    serialNumber: text("serialNumber"),
    platformFingerprint: text("platformFingerprint"),

    // Platform-agnostic checks

    biometricsEnabled: integer("biometricsEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    diskEncrypted: integer("diskEncrypted", { mode: "boolean" })
        .notNull()
        .default(false),
    firewallEnabled: integer("firewallEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    autoUpdatesEnabled: integer("autoUpdatesEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    tpmAvailable: integer("tpmAvailable", { mode: "boolean" })
        .notNull()
        .default(false),

    // Windows-specific posture check information

    windowsAntivirusEnabled: integer("windowsAntivirusEnabled", {
        mode: "boolean"
    })
        .notNull()
        .default(false),

    // macOS-specific posture check information

    macosSipEnabled: integer("macosSipEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    macosGatekeeperEnabled: integer("macosGatekeeperEnabled", {
        mode: "boolean"
    })
        .notNull()
        .default(false),
    macosFirewallStealthMode: integer("macosFirewallStealthMode", {
        mode: "boolean"
    })
        .notNull()
        .default(false),

    // Linux-specific posture check information

    linuxAppArmorEnabled: integer("linuxAppArmorEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    linuxSELinuxEnabled: integer("linuxSELinuxEnabled", {
        mode: "boolean"
    })
        .notNull()
        .default(false)
});

export const fingerprintSnapshots = sqliteTable("fingerprintSnapshots", {
    snapshotId: integer("id").primaryKey({ autoIncrement: true }),

    fingerprintId: integer("fingerprintId").references(
        () => currentFingerprint.fingerprintId,
        {
            onDelete: "set null"
        }
    ),

    username: text("username"),
    hostname: text("hostname"),
    platform: text("platform"),
    osVersion: text("osVersion"),
    kernelVersion: text("kernelVersion"),
    arch: text("arch"),
    deviceModel: text("deviceModel"),
    serialNumber: text("serialNumber"),
    platformFingerprint: text("platformFingerprint"),

    // Platform-agnostic checks

    biometricsEnabled: integer("biometricsEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    diskEncrypted: integer("diskEncrypted", { mode: "boolean" })
        .notNull()
        .default(false),
    firewallEnabled: integer("firewallEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    autoUpdatesEnabled: integer("autoUpdatesEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    tpmAvailable: integer("tpmAvailable", { mode: "boolean" })
        .notNull()
        .default(false),

    // Windows-specific posture check information

    windowsAntivirusEnabled: integer("windowsAntivirusEnabled", {
        mode: "boolean"
    })
        .notNull()
        .default(false),

    // macOS-specific posture check information

    macosSipEnabled: integer("macosSipEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    macosGatekeeperEnabled: integer("macosGatekeeperEnabled", {
        mode: "boolean"
    })
        .notNull()
        .default(false),
    macosFirewallStealthMode: integer("macosFirewallStealthMode", {
        mode: "boolean"
    })
        .notNull()
        .default(false),

    // Linux-specific posture check information

    linuxAppArmorEnabled: integer("linuxAppArmorEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    linuxSELinuxEnabled: integer("linuxSELinuxEnabled", {
        mode: "boolean"
    })
        .notNull()
        .default(false),

    hash: text("hash").notNull(),
    collectedAt: integer("collectedAt").notNull()
});

export const twoFactorBackupCodes = sqliteTable("twoFactorBackupCodes", {
    codeId: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    codeHash: text("codeHash").notNull()
});

export const sessions = sqliteTable(
    "session",
    {
        sessionId: text("id").primaryKey(),
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        expiresAt: integer("expiresAt").notNull(),
        issuedAt: integer("issuedAt"),
        deviceAuthUsed: integer("deviceAuthUsed", { mode: "boolean" })
            .notNull()
            .default(false)
    },
    (table) => [index("idx_sessions_userId").on(table.userId)]
);

export const newtSessions = sqliteTable("newtSession", {
    sessionId: text("id").primaryKey(),
    newtId: text("newtId")
        .notNull()
        .references(() => newts.newtId, { onDelete: "cascade" }),
    expiresAt: integer("expiresAt").notNull()
});

export const olmSessions = sqliteTable("clientSession", {
    sessionId: text("id").primaryKey(),
    olmId: text("olmId")
        .notNull()
        .references(() => olms.olmId, { onDelete: "cascade" }),
    expiresAt: integer("expiresAt").notNull()
});

export const userOrgs = sqliteTable(
    "userOrgs",
    {
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        orgId: text("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        isOwner: integer("isOwner", { mode: "boolean" })
            .notNull()
            .default(false),
        autoProvisioned: integer("autoProvisioned", {
            mode: "boolean"
        }).default(false),
        pamUsername: text("pamUsername") // cleaned username for ssh and such
    },
    (table) => [
        index("idx_userOrgs_userId").on(table.userId),
        index("idx_userOrgs_orgId").on(table.orgId)
    ]
);

export const emailVerificationCodes = sqliteTable("emailVerificationCodes", {
    codeId: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    email: text("email").notNull(),
    code: text("code").notNull(),
    expiresAt: integer("expiresAt").notNull()
});

export const passwordResetTokens = sqliteTable("passwordResetTokens", {
    tokenId: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull(),
    expiresAt: integer("expiresAt").notNull()
});

export const actions = sqliteTable("actions", {
    actionId: text("actionId").primaryKey(),
    name: text("name"),
    description: text("description")
});

export const roles = sqliteTable(
    "roles",
    {
        roleId: integer("roleId").primaryKey({ autoIncrement: true }),
        orgId: text("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        isAdmin: integer("isAdmin", { mode: "boolean" }),
        name: text("name").notNull(),
        description: text("description"),
        requireDeviceApproval: integer("requireDeviceApproval", {
            mode: "boolean"
        }).default(false),
        sshSudoMode: text("sshSudoMode").default("full"), // "none" | "full" | "commands"
        sshSudoCommands: text("sshSudoCommands").default("[]"),
        sshCreateHomeDir: integer("sshCreateHomeDir", {
            mode: "boolean"
        }).default(true),
        sshUnixGroups: text("sshUnixGroups").default("[]")
    },
    (table) => [index("idx_roles_orgId").on(table.orgId)]
);

export const userOrgRoles = sqliteTable(
    "userOrgRoles",
    {
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        roleId: integer("roleId")
            .notNull()
            .references(() => roles.roleId, { onDelete: "cascade" })
    },
    (t) => [unique().on(t.userId, t.orgId, t.roleId)]
);

export const roleActions = sqliteTable("roleActions", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    actionId: text("actionId")
        .notNull()
        .references(() => actions.actionId, { onDelete: "cascade" }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const userActions = sqliteTable("userActions", {
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    actionId: text("actionId")
        .notNull()
        .references(() => actions.actionId, { onDelete: "cascade" }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" })
});

export const roleSites = sqliteTable("roleSites", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    siteId: integer("siteId")
        .notNull()
        .references(() => sites.siteId, { onDelete: "cascade" })
});

export const userSites = sqliteTable("userSites", {
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    siteId: integer("siteId")
        .notNull()
        .references(() => sites.siteId, { onDelete: "cascade" })
});

export const userClients = sqliteTable("userClients", {
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    clientId: integer("clientId")
        .notNull()
        .references(() => clients.clientId, { onDelete: "cascade" })
});

export const roleClients = sqliteTable("roleClients", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    clientId: integer("clientId")
        .notNull()
        .references(() => clients.clientId, { onDelete: "cascade" })
});

export const roleResources = sqliteTable("roleResources", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

export const userResources = sqliteTable("userResources", {
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

export const userInvites = sqliteTable("userInvites", {
    inviteId: text("inviteId").primaryKey(),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    email: text("email").notNull(),
    expiresAt: integer("expiresAt").notNull(),
    tokenHash: text("token").notNull()
});

export const userInviteRoles = sqliteTable(
    "userInviteRoles",
    {
        inviteId: text("inviteId")
            .notNull()
            .references(() => userInvites.inviteId, { onDelete: "cascade" }),
        roleId: integer("roleId")
            .notNull()
            .references(() => roles.roleId, { onDelete: "cascade" })
    },
    (t) => [primaryKey({ columns: [t.inviteId, t.roleId] })]
);

export const resourcePincode = sqliteTable("resourcePincode", {
    pincodeId: integer("pincodeId").primaryKey({
        autoIncrement: true
    }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    pincodeHash: text("pincodeHash").notNull(),
    digitLength: integer("digitLength").notNull()
});

export const resourcePassword = sqliteTable("resourcePassword", {
    passwordId: integer("passwordId").primaryKey({
        autoIncrement: true
    }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    passwordHash: text("passwordHash").notNull()
});

export const resourceHeaderAuth = sqliteTable("resourceHeaderAuth", {
    headerAuthId: integer("headerAuthId").primaryKey({
        autoIncrement: true
    }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    headerAuthHash: text("headerAuthHash").notNull()
});

export const resourcePolicyPincode = sqliteTable("resourcePolicyPincode", {
    pincodeId: integer("pincodeId").primaryKey({ autoIncrement: true }),
    pincodeHash: text("pincodeHash").notNull(),
    digitLength: integer("digitLength").notNull(),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourcePolicyPassword = sqliteTable("resourcePolicyPassword", {
    passwordId: integer("passwordId").primaryKey({ autoIncrement: true }),
    passwordHash: text("passwordHash").notNull(),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourcePolicyHeaderAuth = sqliteTable(
    "resourcePolicyHeaderAuth",
    {
        headerAuthId: integer("headerAuthId").primaryKey({
            autoIncrement: true
        }),
        headerAuthHash: text("headerAuthHash").notNull(),
        extendedCompatibility: integer("extendedCompatibility", {
            mode: "boolean"
        })
            .notNull()
            .default(true),
        resourcePolicyId: integer("resourcePolicyId")
            .notNull()
            .references(() => resourcePolicies.resourcePolicyId, {
                onDelete: "cascade"
            })
    }
);

export const resourceHeaderAuthExtendedCompatibility = sqliteTable(
    "resourceHeaderAuthExtendedCompatibility",
    {
        headerAuthExtendedCompatibilityId: integer(
            "headerAuthExtendedCompatibilityId"
        ).primaryKey({
            autoIncrement: true
        }),
        resourceId: integer("resourceId")
            .notNull()
            .references(() => resources.resourceId, { onDelete: "cascade" }),
        extendedCompatibilityIsActivated: integer(
            "extendedCompatibilityIsActivated",
            { mode: "boolean" }
        )
            .notNull()
            .default(true)
    }
);

export const resourceAccessToken = sqliteTable("resourceAccessToken", {
    accessTokenId: text("accessTokenId").primaryKey(),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    userId: text("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    path: text("path"),
    tokenHash: text("tokenHash").notNull(),
    sessionLength: integer("sessionLength").notNull(),
    expiresAt: integer("expiresAt"),
    title: text("title"),
    description: text("description"),
    persistSession: integer("persistSession", { mode: "boolean" })
        .notNull()
        .default(false),
    createdAt: integer("createdAt").notNull()
});

export const resourceSessions = sqliteTable("resourceSessions", {
    sessionId: text("id").primaryKey(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    expiresAt: integer("expiresAt").notNull(),
    sessionLength: integer("sessionLength").notNull(),
    doNotExtend: integer("doNotExtend", { mode: "boolean" })
        .notNull()
        .default(false),
    isRequestToken: integer("isRequestToken", { mode: "boolean" }),
    userSessionId: text("userSessionId").references(() => sessions.sessionId, {
        onDelete: "cascade"
    }),
    passwordId: integer("passwordId").references(
        () => resourcePassword.passwordId,
        {
            onDelete: "cascade"
        }
    ),
    pincodeId: integer("pincodeId").references(
        () => resourcePincode.pincodeId,
        {
            onDelete: "cascade"
        }
    ),
    whitelistId: integer("whitelistId").references(
        () => resourceWhitelist.whitelistId,
        {
            onDelete: "cascade"
        }
    ),
    accessTokenId: text("accessTokenId").references(
        () => resourceAccessToken.accessTokenId,
        {
            onDelete: "cascade"
        }
    ),
    policyPasswordId: integer("policyPasswordId").references(
        () => resourcePolicyPassword.passwordId,
        {
            onDelete: "cascade"
        }
    ),
    policyPincodeId: integer("policyPincodeId").references(
        () => resourcePolicyPincode.pincodeId,
        {
            onDelete: "cascade"
        }
    ),
    policyWhitelistId: integer("policyWhitelistId").references(
        () => resourcePolicyWhiteList.whitelistId,
        {
            onDelete: "cascade"
        }
    ),
    issuedAt: integer("issuedAt")
});

export const resourceWhitelist = sqliteTable("resourceWhitelist", {
    whitelistId: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

export const resourceOtp = sqliteTable("resourceOtp", {
    otpId: integer("otpId").primaryKey({
        autoIncrement: true
    }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    email: text("email").notNull(),
    otpHash: text("otpHash").notNull(),
    expiresAt: integer("expiresAt").notNull()
});

export const versionMigrations = sqliteTable("versionMigrations", {
    version: text("version").primaryKey(),
    executedAt: integer("executedAt").notNull()
});

export const resourceRules = sqliteTable("resourceRules", {
    ruleId: integer("ruleId").primaryKey({ autoIncrement: true }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    priority: integer("priority").notNull(),
    action: text("action").notNull(), // ACCEPT, DROP, PASS
    match: text("match")
        .$type<
            | "CIDR"
            | "PATH"
            | "IP"
            | "COUNTRY"
            | "COUNTRY_IS_NOT"
            | "ASN"
            | "REGION"
        >()
        .notNull(), // CIDR, PATH, IP
    value: text("value").notNull()
});

export const rolePolicies = sqliteTable("rolePolicies", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const userPolicies = sqliteTable("userPolicies", {
    userId: text("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourcePolicyWhiteList = sqliteTable("resourcePolicyWhitelist", {
    whitelistId: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourcePolicyRules = sqliteTable("resourcePolicyRules", {
    ruleId: integer("ruleId").primaryKey({ autoIncrement: true }),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    priority: integer("priority").notNull(),
    action: text("action").$type<"ACCEPT" | "DROP" | "PASS">().notNull(),
    match: text("match")
        .$type<
            | "CIDR"
            | "PATH"
            | "IP"
            | "COUNTRY"
            | "COUNTRY_IS_NOT"
            | "ASN"
            | "REGION"
        >()
        .notNull(),
    value: text("value").notNull()
});

export const resourcePolicies = sqliteTable("resourcePolicies", {
    resourcePolicyId: integer("resourcePolicyId").primaryKey(),
    sso: integer("sso", { mode: "boolean" }).notNull().default(true),
    applyRules: integer("applyRules", { mode: "boolean" })
        .notNull()
        .default(false),
    scope: text("scope")
        .$type<"global" | "resource">()
        .notNull()
        .default("global"),
    emailWhitelistEnabled: integer("emailWhitelistEnabled", { mode: "boolean" })
        .notNull()
        .default(false),
    niceId: text("niceId").notNull(),
    idpId: integer("idpId").references(() => idp.idpId, {
        onDelete: "set null"
    }),
    name: text("name").notNull(),
    orgId: text("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull()
});

export const supporterKey = sqliteTable("supporterKey", {
    keyId: integer("keyId").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(),
    githubUsername: text("githubUsername").notNull(),
    phrase: text("phrase"),
    tier: text("tier"),
    valid: integer("valid", { mode: "boolean" }).notNull().default(false)
});

// Identity Providers
export const idp = sqliteTable("idp", {
    idpId: integer("idpId").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    defaultRoleMapping: text("defaultRoleMapping"),
    defaultOrgMapping: text("defaultOrgMapping"),
    autoProvision: integer("autoProvision", {
        mode: "boolean"
    })
        .notNull()
        .default(false),
    tags: text("tags")
});

// Identity Provider OAuth Configuration
export const idpOidcConfig = sqliteTable("idpOidcConfig", {
    idpOauthConfigId: integer("idpOauthConfigId").primaryKey({
        autoIncrement: true
    }),
    variant: text("variant").notNull().default("oidc"),
    idpId: integer("idpId")
        .notNull()
        .references(() => idp.idpId, { onDelete: "cascade" }),
    clientId: text("clientId").notNull(),
    clientSecret: text("clientSecret").notNull(),
    authUrl: text("authUrl").notNull(),
    tokenUrl: text("tokenUrl").notNull(),
    identifierPath: text("identifierPath").notNull(),
    emailPath: text("emailPath"),
    namePath: text("namePath"),
    scopes: text("scopes").notNull()
});

export const licenseKey = sqliteTable("licenseKey", {
    licenseKeyId: text("licenseKeyId").primaryKey().notNull(),
    instanceId: text("instanceId").notNull(),
    token: text("token").notNull()
});

export const hostMeta = sqliteTable("hostMeta", {
    hostMetaId: text("hostMetaId").primaryKey().notNull(),
    createdAt: integer("createdAt").notNull()
});

export const apiKeys = sqliteTable("apiKeys", {
    apiKeyId: text("apiKeyId").primaryKey(),
    name: text("name").notNull(),
    apiKeyHash: text("apiKeyHash").notNull(),
    lastChars: text("lastChars").notNull(),
    createdAt: text("dateCreated").notNull(),
    isRoot: integer("isRoot", { mode: "boolean" }).notNull().default(false)
});

export const apiKeyActions = sqliteTable("apiKeyActions", {
    apiKeyId: text("apiKeyId")
        .notNull()
        .references(() => apiKeys.apiKeyId, { onDelete: "cascade" }),
    actionId: text("actionId")
        .notNull()
        .references(() => actions.actionId, { onDelete: "cascade" })
});

export const apiKeyOrg = sqliteTable("apiKeyOrg", {
    apiKeyId: text("apiKeyId")
        .notNull()
        .references(() => apiKeys.apiKeyId, { onDelete: "cascade" }),
    orgId: text("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull()
});

export const virtualApiKeys = sqliteTable(
    "virtualApiKeys",
    {
        virtualApiKeyId: text("virtualApiKeyId").primaryKey(),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        kind: text("kind").$type<"user" | "manual">().notNull(),
        userId: text("userId").references(() => users.userId, {
            onDelete: "cascade"
        }),
        name: text("name"),
        description: text("description"),
        token: text("token").notNull(),
        lastChars: text("lastChars").notNull(),
        allResources: integer("allResources", { mode: "boolean" })
            .notNull()
            .default(false),
        expiresAt: integer("expiresAt"),
        lastUsedAt: integer("lastUsedAt"),
        createdAt: integer("createdAt").notNull(),
        createdByUserId: text("createdByUserId").references(
            () => users.userId,
            { onDelete: "set null" }
        )
    },
    (t) => [
        uniqueIndex("virtual_api_key_user_identity_uniq")
            .on(t.orgId, t.userId)
            .where(sql`${t.kind} = 'user'`)
    ]
);

export const virtualApiKeyResources = sqliteTable(
    "virtualApiKeyResources",
    {
        virtualApiKeyId: text("virtualApiKeyId")
            .notNull()
            .references(() => virtualApiKeys.virtualApiKeyId, {
                onDelete: "cascade"
            }),
        resourceId: integer("resourceId")
            .notNull()
            .references(() => resources.resourceId, { onDelete: "cascade" })
    },
    (t) => [primaryKey({ columns: [t.virtualApiKeyId, t.resourceId] })]
);

export const oauthClients = sqliteTable(
    "oauthClients",
    {
        clientId: text("clientId").primaryKey(),
        clientSecret: text("clientSecret"), // Encrypted with server secret
        lastChars: text("lastChars").notNull().default(""),
        clientAuthenticationMethod: text("clientAuthenticationMethod")
            .notNull()
            .$type<ClientAuthenticationMethod>()
            .default("client_secret_jwt"),
        clientName: text("clientName").notNull(),
        clientUri: text("clientUri"),
        logoUri: text("logoUri"),
        redirectUris: text("redirectUris", { mode: "json" })
            .notNull()
            .$type<string[]>(),
        scopes: text("scopes").notNull().default("openid profile email"),
        pkceRequired: integer("pkceRequired", { mode: "boolean" })
            .notNull()
            .default(true),
        enabled: integer("enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        logoutTerminatesPangolinSession: integer(
            "logoutTerminatesPangolinSession",
            { mode: "boolean" }
        )
            .notNull()
            .default(false),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        backchannelLogoutUri: text("backchannelLogoutUri"),
        postLogoutRedirectUris: text("postLogoutRedirectUris", {
            mode: "json"
        }).$type<string[] | null>(),
        createdAt: integer("createdAt").notNull(),
        updatedAt: integer("updatedAt").notNull()
    },
    (table) => [
        index("idx_oauthClients_orgId").on(table.orgId),
        index("idx_oauthClients_enabled").on(table.enabled)
    ]
);

export const oauthInteractions = sqliteTable(
    "oauthInteractions",
    {
        interactionId: text("interactionId").primaryKey(),
        clientId: text("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        state: text("state").notNull(),
        nonce: text("nonce"),
        redirectUri: text("redirectUri").notNull(),
        codeChallenge: text("codeChallenge"),
        codeChallengeMethod: text("codeChallengeMethod"),
        responseType: text("responseType").notNull(),
        expiresAt: integer("expiresAt").notNull(),
        createdAt: integer("createdAt").notNull()
    },
    (table) => [
        index("idx_oauthInteractions_expiresAt").on(table.expiresAt),
        index("idx_oauthInteractions_clientId").on(table.clientId),
        index("idx_oauthInteractions_userId").on(table.userId)
    ]
);

export const oauthAuthorizationCodes = sqliteTable(
    "oauthAuthorizationCodes",
    {
        codeId: text("codeId").primaryKey(),
        codeHash: text("codeHash").notNull(),
        clientId: text("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        redirectUri: text("redirectUri").notNull(),
        codeChallenge: text("codeChallenge"),
        codeChallengeMethod: text("codeChallengeMethod"),
        nonce: text("nonce"),
        expiresAt: integer("expiresAt").notNull(),
        createdAt: integer("createdAt").notNull()
    },
    (table) => [
        uniqueIndex("uidx_oauthAuthorizationCodes_codeHash").on(table.codeHash),
        index("idx_oauthAuthorizationCodes_expiresAt").on(table.expiresAt),
        index("idx_oauthAuthorizationCodes_clientId").on(table.clientId),
        index("idx_oauthAuthorizationCodes_userId").on(table.userId)
    ]
);

export const oauthAccessTokens = sqliteTable(
    "oauthAccessTokens",
    {
        accessTokenId: text("accessTokenId").primaryKey(),
        grantId: text("grantId").notNull(),
        tokenHash: text("tokenHash").notNull(),
        clientId: text("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        expiresAt: integer("expiresAt").notNull(),
        createdAt: integer("createdAt").notNull()
    },
    (table) => [
        uniqueIndex("uidx_oauthAccessTokens_tokenHash").on(table.tokenHash),
        index("idx_oauthAccessTokens_expiresAt").on(table.expiresAt),
        index("idx_oauthAccessTokens_grantId").on(table.grantId),
        index("idx_oauthAccessTokens_clientId").on(table.clientId),
        index("idx_oauthAccessTokens_userId").on(table.userId)
    ]
);

export const oauthRefreshTokens = sqliteTable(
    "oauthRefreshTokens",
    {
        refreshTokenId: text("refreshTokenId").primaryKey(),
        grantId: text("grantId").notNull(),
        tokenHash: text("tokenHash").notNull(),
        clientId: text("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        expiresAt: integer("expiresAt").notNull(),
        revokedAt: integer("revokedAt"),
        createdAt: integer("createdAt").notNull()
    },
    (table) => [
        uniqueIndex("uidx_oauthRefreshTokens_tokenHash").on(table.tokenHash),
        index("idx_oauthRefreshTokens_expiresAt").on(table.expiresAt),
        index("idx_oauthRefreshTokens_grantId").on(table.grantId),
        index("idx_oauthRefreshTokens_clientId").on(table.clientId),
        index("idx_oauthRefreshTokens_userId").on(table.userId),
        index("idx_oauthRefreshTokens_revokedAt").on(table.revokedAt)
    ]
);

export const oauthConsents = sqliteTable(
    "oauthConsents",
    {
        consentId: text("consentId").primaryKey(),
        userId: text("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        clientId: text("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        createdAt: integer("createdAt").notNull(),
        updatedAt: integer("updatedAt").notNull()
    },
    (table) => [
        uniqueIndex("uidx_oauthConsents_userId_clientId").on(
            table.userId,
            table.clientId
        ),
        index("idx_oauthConsents_clientId").on(table.clientId)
    ]
);

export const oauthSigningKeys = sqliteTable(
    "oauthSigningKeys",
    {
        keyId: text("keyId").primaryKey(),
        algorithm: text("algorithm").notNull(),
        publicKeyPem: text("publicKeyPem").notNull(),
        privateKeyPem: text("privateKeyPem").notNull(),
        active: integer("active", { mode: "boolean" }).notNull().default(true),
        createdAt: integer("createdAt").notNull()
    },
    (table) => [index("idx_oauthSigningKeys_active").on(table.active)]
);

export const idpOrg = sqliteTable("idpOrg", {
    idpId: integer("idpId")
        .notNull()
        .references(() => idp.idpId, { onDelete: "cascade" }),
    orgId: text("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    roleMapping: text("roleMapping"),
    orgMapping: text("orgMapping")
});

// Blueprint runs
export const blueprints = sqliteTable("blueprints", {
    blueprintId: integer("blueprintId").primaryKey({
        autoIncrement: true
    }),
    orgId: text("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull(),
    name: text("name").notNull(),
    source: text("source").notNull(),
    createdAt: integer("createdAt").notNull(),
    succeeded: integer("succeeded", { mode: "boolean" }).notNull(),
    contents: text("contents").notNull(),
    message: text("message")
});
export const requestAuditLog = sqliteTable(
    "requestAuditLog",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        timestamp: integer("timestamp").notNull(), // this is EPOCH time in seconds
        orgId: text("orgId").references(() => orgs.orgId, {
            onDelete: "cascade"
        }),
        action: integer("action", { mode: "boolean" }).notNull(),
        reason: integer("reason").notNull(),
        actorType: text("actorType"),
        actor: text("actor"),
        actorId: text("actorId"),
        resourceId: integer("resourceId"),
        siteResourceId: integer("siteResourceId"),
        ip: text("ip"),
        location: text("location"),
        userAgent: text("userAgent"),
        metadata: text("metadata"),
        headers: text("headers"), // JSON blob
        query: text("query"), // JSON blob
        originalRequestURL: text("originalRequestURL"),
        scheme: text("scheme"),
        host: text("host"),
        path: text("path"),
        method: text("method"),
        tls: integer("tls", { mode: "boolean" })
    },
    (table) => [
        index("idx_requestAuditLog_timestamp").on(table.timestamp),
        index("idx_requestAuditLog_org_timestamp").on(
            table.orgId,
            table.timestamp
        )
    ]
);

export const deviceWebAuthCodes = sqliteTable("deviceWebAuthCodes", {
    codeId: integer("codeId").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(),
    ip: text("ip"),
    city: text("city"),
    deviceName: text("deviceName"),
    applicationName: text("applicationName").notNull(),
    expiresAt: integer("expiresAt").notNull(),
    createdAt: integer("createdAt").notNull(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    userId: text("userId").references(() => users.userId, {
        onDelete: "cascade"
    })
});

export const roundTripMessageTracker = sqliteTable("roundTripMessageTracker", {
    messageId: integer("messageId").primaryKey({ autoIncrement: true }),
    wsClientId: text("clientId"),
    messageType: text("messageType"),
    sentAt: integer("sentAt").notNull(),
    receivedAt: integer("receivedAt"),
    error: text("error"),
    complete: integer("complete", { mode: "boolean" }).notNull().default(false)
});

export const statusHistory = sqliteTable(
    "statusHistory",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        entityType: text("entityType").notNull(), // "site" | "healthCheck"
        entityId: integer("entityId").notNull(), // siteId or targetHealthCheckId
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        status: text("status").notNull(), // "online"/"offline" for sites; "healthy"/"unhealthy"/"unknown" for healthChecks
        timestamp: integer("timestamp").notNull() // unix epoch seconds
    },
    (table) => [
        index("idx_statusHistory_entity").on(
            table.entityType,
            table.entityId,
            table.timestamp
        ),
        index("idx_statusHistory_org_timestamp").on(
            table.orgId,
            table.timestamp
        )
    ]
);

export const aiProviders = sqliteTable(
    "aiProviders",
    {
        providerId: integer("providerId").primaryKey({ autoIncrement: true }),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        name: text("name").notNull(),
        niceId: text("niceId").notNull(),
        type: text("type")
            .$type<
                | "openai"
                | "anthropic"
                | "googleGemini"
                | "vertexAi"
                | "bedrock"
                | "microsoftFoundry"
                | "openRouter"
                | "vercelAiGateway"
                | "custom"
            >()
            .notNull(),
        upstreamUrl: text("upstreamUrl"),
        apiKey: text("apiKey"),
        apiKeyLastChars: text("apiKeyLastChars"),
        authType: text("authType")
            .$type<
                | "bearer"
                | "x-api-key"
                | "x-goog-api-key"
                | "hec"
                | "cf-aig-authorization"
                | "none"
                | "passthrough"
            >()
            .notNull(),
        routingMode: text("routingMode")
            .$type<"url" | "target">()
            .notNull()
            .default("url"),
        capabilities: text("capabilities").notNull().default("[]"),
        headers: text("headers"), // JSON array of { name, value }
        skipTlsVerification: integer("skipTlsVerification", { mode: "boolean" })
            .notNull()
            .default(false),
        enabled: integer("enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        createdAt: integer("createdAt").notNull(),
        updatedAt: integer("updatedAt").notNull()
    },
    (t) => [index("idx_aiProviders_orgId_niceId").on(t.orgId, t.niceId)]
);

export const aiModels = sqliteTable(
    "aiModels",
    {
        modelId: integer("modelId").primaryKey({ autoIncrement: true }),
        providerId: integer("providerId")
            .notNull()
            .references(() => aiProviders.providerId, { onDelete: "cascade" }),
        modelKey: text("modelKey").notNull(),
        name: text("name").notNull(),
        listType: text("listType")
            .$type<"allow" | "block">()
            .notNull()
            .default("allow"),
        enabled: integer("enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        createdAt: integer("createdAt").notNull(),
        updatedAt: integer("updatedAt").notNull()
    },
    (t) => [unique("ai_model_provider_key_uniq").on(t.providerId, t.modelKey)]
);

export const aiBudgets = sqliteTable(
    "aiBudgets",
    {
        budgetId: integer("budgetId").primaryKey({ autoIncrement: true }),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        providerId: integer("providerId").references(
            () => aiProviders.providerId,
            { onDelete: "cascade" }
        ),
        modelId: integer("modelId").references(() => aiModels.modelId, {
            onDelete: "cascade"
        }),
        resourceId: integer("resourceId").references(
            () => resources.resourceId,
            { onDelete: "cascade" }
        ),
        siteResourceId: integer("siteResourceId").references(
            () => siteResources.siteResourceId,
            { onDelete: "cascade" }
        ),
        roleId: integer("roleId").references(() => roles.roleId, {
            onDelete: "cascade"
        }),
        virtualApiKeyId: text("virtualApiKeyId").references(
            () => virtualApiKeys.virtualApiKeyId,
            { onDelete: "cascade" }
        ),
        amount: real("amount").notNull(),
        unit: text("unit").$type<"usd" | "tokens">().notNull(),
        period: text("period")
            .$type<
                | "monthly"
                | "yearly"
                | "lifetime"
                | "daily"
                | "hourly"
                | "weekly"
            >()
            .notNull()
            .default("monthly"),
        enforcement: text("enforcement")
            .$type<"hard" | "soft">()
            .notNull()
            .default("hard"),
        enabled: integer("enabled", { mode: "boolean" })
            .notNull()
            .default(true),
        createdAt: integer("createdAt").notNull(),
        updatedAt: integer("updatedAt").notNull()
    },
    (t) => [
        unique("ai_budget_provider_uniq").on(t.providerId, t.unit, t.period),
        unique("ai_budget_model_uniq").on(t.modelId, t.unit, t.period),
        unique("ai_budget_resource_uniq").on(t.resourceId, t.unit, t.period),
        unique("ai_budget_site_resource_uniq").on(
            t.siteResourceId,
            t.unit,
            t.period
        ),
        unique("ai_budget_role_uniq").on(t.roleId, t.unit, t.period),
        unique("ai_budget_virtual_api_key_uniq").on(
            t.virtualApiKeyId,
            t.unit,
            t.period
        )
    ]
);

export const aiUsageRecords = sqliteTable(
    "aiUsageRecords",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        providerId: integer("providerId").references(
            () => aiProviders.providerId,
            { onDelete: "set null" }
        ),
        resourceId: integer("resourceId").references(
            () => resources.resourceId,
            { onDelete: "set null" }
        ),
        siteResourceId: integer("siteResourceId").references(
            () => siteResources.siteResourceId,
            { onDelete: "set null" }
        ),
        userId: text("userId").references(() => users.userId, {
            onDelete: "set null"
        }),
        virtualApiKeyId: text("virtualApiKeyId").references(
            () => virtualApiKeys.virtualApiKeyId,
            { onDelete: "set null" }
        ),
        // Links this usage record back to the aiSessionLog row for the same
        // request (aiSessionLog.sessionId), so token/cost usage can be shown
        // alongside the session transcript. Not a DB-level FK - aiSessionLog
        // lives in the separate logs database. Nullable because the session
        // log may be disabled (retention set to 0) while usage tracking
        // stays on.
        sessionId: text("sessionId"),
        requestedModel: text("requestedModel").notNull(),
        promptTokens: integer("promptTokens").notNull().default(0),
        cacheReadTokens: integer("cacheReadTokens").notNull().default(0),
        cacheWriteTokens: integer("cacheWriteTokens").notNull().default(0),
        completionTokens: integer("completionTokens").notNull().default(0),
        reasoningTokens: integer("reasoningTokens").notNull().default(0),
        totalTokens: integer("totalTokens").notNull().default(0),
        costUsd: real("costUsd"),
        estimated: integer("estimated", { mode: "boolean" })
            .notNull()
            .default(false),
        createdAt: integer("createdAt").notNull()
    },
    (t) => [
        index("idx_ai_usage_records_org_provider_created").on(
            t.orgId,
            t.providerId,
            t.createdAt
        ),
        index("idx_ai_usage_records_org_resource_created").on(
            t.orgId,
            t.resourceId,
            t.createdAt
        ),
        index("idx_ai_usage_records_org_site_resource_created").on(
            t.orgId,
            t.siteResourceId,
            t.createdAt
        ),
        index("idx_ai_usage_records_org_user_created").on(
            t.orgId,
            t.userId,
            t.createdAt
        ),
        index("idx_ai_usage_records_org_virtual_api_key_created").on(
            t.orgId,
            t.virtualApiKeyId,
            t.createdAt
        ),
        index("idx_ai_usage_records_session").on(t.sessionId)
    ]
);

export const aiBudgetBreachEvents = sqliteTable(
    "aiBudgetBreachEvents",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        orgId: text("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        budgetId: integer("budgetId")
            .notNull()
            .references(() => aiBudgets.budgetId, { onDelete: "cascade" }),
        enforcement: text("enforcement").$type<"hard" | "soft">().notNull(),
        unit: text("unit").$type<"usd" | "tokens">().notNull(),
        period: text("period")
            .$type<
                | "monthly"
                | "yearly"
                | "lifetime"
                | "daily"
                | "hourly"
                | "weekly"
            >()
            .notNull(),
        amount: real("amount").notNull(),
        usageAmount: real("usageAmount").notNull(),
        blocked: integer("blocked", { mode: "boolean" }).notNull(),
        requestUserId: text("requestUserId").references(() => users.userId, {
            onDelete: "set null"
        }),
        createdAt: integer("createdAt").notNull()
    },
    (t) => [
        index("idx_ai_budget_breach_events_budget_created").on(
            t.budgetId,
            t.createdAt
        )
    ]
);

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

export type Org = InferSelectModel<typeof orgs>;
export type User = InferSelectModel<typeof users>;
export type Site = InferSelectModel<typeof sites>;
export type Resource = InferSelectModel<typeof resources>;
export type ExitNode = InferSelectModel<typeof exitNodes>;
export type Target = InferSelectModel<typeof targets>;
export type Session = InferSelectModel<typeof sessions>;
export type Newt = InferSelectModel<typeof newts>;
export type NewtSession = InferSelectModel<typeof newtSessions>;
export type Olm = InferSelectModel<typeof olms>;
export type OlmSession = InferSelectModel<typeof olmSessions>;
export type EmailVerificationCode = InferSelectModel<
    typeof emailVerificationCodes
>;
export type TwoFactorBackupCode = InferSelectModel<typeof twoFactorBackupCodes>;
export type PasswordResetToken = InferSelectModel<typeof passwordResetTokens>;
export type Role = InferSelectModel<typeof roles>;
export type Action = InferSelectModel<typeof actions>;
export type RoleAction = InferSelectModel<typeof roleActions>;
export type UserAction = InferSelectModel<typeof userActions>;
export type RoleSite = InferSelectModel<typeof roleSites>;
export type UserSite = InferSelectModel<typeof userSites>;
export type RoleResource = InferSelectModel<typeof roleResources>;
export type UserResource = InferSelectModel<typeof userResources>;
export type UserInvite = InferSelectModel<typeof userInvites>;
export type UserInviteRole = InferSelectModel<typeof userInviteRoles>;
export type UserOrg = InferSelectModel<typeof userOrgs>;
export type UserOrgRole = InferSelectModel<typeof userOrgRoles>;
export type ResourceSession = InferSelectModel<typeof resourceSessions>;
export type ResourcePincode = InferSelectModel<typeof resourcePincode>;
export type ResourcePassword = InferSelectModel<typeof resourcePassword>;
export type ResourceHeaderAuth = InferSelectModel<typeof resourceHeaderAuth>;
export type ResourceHeaderAuthExtendedCompatibility = InferSelectModel<
    typeof resourceHeaderAuthExtendedCompatibility
>;
export type ResourceOtp = InferSelectModel<typeof resourceOtp>;
export type ResourceAccessToken = InferSelectModel<typeof resourceAccessToken>;
export type ResourceWhitelist = InferSelectModel<typeof resourceWhitelist>;
export type VersionMigration = InferSelectModel<typeof versionMigrations>;
export type ResourceRule = InferSelectModel<typeof resourceRules>;
export type Domain = InferSelectModel<typeof domains>;
export type DnsRecord = InferSelectModel<typeof dnsRecords>;
export type Client = InferSelectModel<typeof clients>;
export type ClientSite = InferSelectModel<typeof clientSitesAssociationsCache>;
export type RoleClient = InferSelectModel<typeof roleClients>;
export type UserClient = InferSelectModel<typeof userClients>;
export type SupporterKey = InferSelectModel<typeof supporterKey>;
export type Idp = InferSelectModel<typeof idp>;
export type ApiKey = InferSelectModel<typeof apiKeys>;
export type ApiKeyAction = InferSelectModel<typeof apiKeyActions>;
export type ApiKeyOrg = InferSelectModel<typeof apiKeyOrg>;
export type VirtualApiKey = InferSelectModel<typeof virtualApiKeys>;
export type VirtualApiKeyResource = InferSelectModel<
    typeof virtualApiKeyResources
>;
export type OauthClient = InferSelectModel<typeof oauthClients>;
export type OauthInteraction = InferSelectModel<typeof oauthInteractions>;
export type OauthAuthorizationCode = InferSelectModel<
    typeof oauthAuthorizationCodes
>;
export type OauthAccessToken = InferSelectModel<typeof oauthAccessTokens>;
export type OauthRefreshToken = InferSelectModel<typeof oauthRefreshTokens>;
export type OauthConsent = InferSelectModel<typeof oauthConsents>;
export type OauthSigningKey = InferSelectModel<typeof oauthSigningKeys>;
export type SiteResource = InferSelectModel<typeof siteResources>;
export type Network = InferSelectModel<typeof networks>;
export type OrgDomains = InferSelectModel<typeof orgDomains>;
export type SetupToken = InferSelectModel<typeof setupTokens>;
export type HostMeta = InferSelectModel<typeof hostMeta>;
export type TargetHealthCheck = InferSelectModel<typeof targetHealthCheck>;
export type IdpOidcConfig = InferSelectModel<typeof idpOidcConfig>;
export type Blueprint = InferSelectModel<typeof blueprints>;
export type LicenseKey = InferSelectModel<typeof licenseKey>;
export type SecurityKey = InferSelectModel<typeof securityKeys>;
export type WebauthnChallenge = InferSelectModel<typeof webauthnChallenge>;
export type RequestAuditLog = InferSelectModel<typeof requestAuditLog>;
export type DeviceWebAuthCode = InferSelectModel<typeof deviceWebAuthCodes>;
export type RoundTripMessageTracker = InferSelectModel<
    typeof roundTripMessageTracker
>;
export type StatusHistory = InferSelectModel<typeof statusHistory>;
export type Label = InferSelectModel<typeof labels>;
export type LauncherView = InferSelectModel<typeof launcherViews>;
export type ResourcePolicy = InferSelectModel<typeof resourcePolicies>;
export type ResourcePolicyPincode = InferSelectModel<
    typeof resourcePolicyPincode
>;
export type ResourcePolicyPassword = InferSelectModel<
    typeof resourcePolicyPassword
>;
export type ResourcePolicyHeaderAuth = InferSelectModel<
    typeof resourcePolicyHeaderAuth
>;
export type RolePolicy = InferSelectModel<typeof rolePolicies>;
export type UserPolicy = InferSelectModel<typeof userPolicies>;
export type AiProvider = InferSelectModel<typeof aiProviders>;
export type AiModel = InferSelectModel<typeof aiModels>;
export type AiBudget = InferSelectModel<typeof aiBudgets>;
export type AiUsageRecord = InferSelectModel<typeof aiUsageRecords>;
export type AiBudgetBreachEvent = InferSelectModel<typeof aiBudgetBreachEvents>;
export type ResourceAiProvider = InferSelectModel<typeof resourceAiProviders>;
export type SiteResourceAiProvider = InferSelectModel<
    typeof siteResourceAiProviders
>;
export type ResourceAiModel = InferSelectModel<typeof resourceAiModels>;
export type SiteResourceAiModel = InferSelectModel<typeof siteResourceAiModels>;
export type Certificate = InferSelectModel<typeof certificates>;
