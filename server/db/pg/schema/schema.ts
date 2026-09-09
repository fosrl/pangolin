import { randomUUID } from "crypto";
import { InferSelectModel, sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    index,
    integer,
    json,
    pgTable,
    primaryKey,
    real,
    serial,
    text,
    unique,
    uniqueIndex,
    varchar
} from "drizzle-orm/pg-core";
import type { ClientAuthenticationMethod } from "@server/lib/oauth/clientAuthMethods";

export const domains = pgTable("domains", {
    domainId: varchar("domainId").primaryKey(),
    baseDomain: varchar("baseDomain").notNull(),
    configManaged: boolean("configManaged").notNull().default(false),
    type: varchar("type").$type<"ns" | "cname" | "wildcard">(),
    verified: boolean("verified").notNull().default(false),
    failed: boolean("failed").notNull().default(false),
    tries: integer("tries").notNull().default(0),
    certResolver: varchar("certResolver"),
    customCertResolver: varchar("customCertResolver"),
    preferWildcardCert: boolean("preferWildcardCert"),
    errorMessage: text("errorMessage"),
    lastCheckedAt: integer("lastCheckedAt")
});

export const dnsRecords = pgTable("dnsRecords", {
    id: serial("id").primaryKey(),
    domainId: varchar("domainId")
        .notNull()
        .references(() => domains.domainId, { onDelete: "cascade" }),
    recordType: varchar("recordType").notNull(), // "NS" | "CNAME" | "A" | "TXT"
    baseDomain: varchar("baseDomain"),
    value: varchar("value").notNull(),
    verified: boolean("verified").notNull().default(false)
});

export const orgs = pgTable("orgs", {
    orgId: varchar("orgId").primaryKey(),
    name: varchar("name").notNull(),
    subnet: varchar("subnet"),
    utilitySubnet: varchar("utilitySubnet"), // this is the subnet for utility addresses
    createdAt: text("createdAt"),
    requireTwoFactor: boolean("requireTwoFactor"),
    maxSessionLengthHours: integer("maxSessionLengthHours"),
    passwordExpiryDays: integer("passwordExpiryDays"),
    settingsLogRetentionDaysRequest: integer("settingsLogRetentionDaysRequest") // where 0 = dont keep logs and -1 = keep forever, and 9001 = end of the following year
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
        .default(0),
    sshCaPrivateKey: text("sshCaPrivateKey"), // Encrypted SSH CA private key (PEM format)
    sshCaPublicKey: text("sshCaPublicKey"), // SSH CA public key (OpenSSH format)
    isBillingOrg: boolean("isBillingOrg"),
    billingOrgId: varchar("billingOrgId"),
    settingsEnableGlobalNewtAutoUpdate: boolean(
        "settingsEnableGlobalNewtAutoUpdate"
    )
        .notNull()
        .default(false)
});

export const orgDomains = pgTable("orgDomains", {
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    domainId: varchar("domainId")
        .notNull()
        .references(() => domains.domainId, { onDelete: "cascade" })
});

export const sites = pgTable(
    "sites",
    {
        siteId: serial("siteId").primaryKey(),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        niceId: varchar("niceId").notNull(),
        exitNodeId: integer("exitNode").references(() => exitNodes.exitNodeId, {
            onDelete: "set null"
        }),
        name: varchar("name").notNull(),
        pubKey: varchar("pubKey"),
        exitNodeSubnet: text("exitNodeSubnet"), // this is the subnet when connecting to an exit node and INCLUDES THE CIDR
        megabytesIn: real("bytesIn").default(0),
        megabytesOut: real("bytesOut").default(0),
        lastBandwidthUpdate: varchar("lastBandwidthUpdate"),
        type: varchar("type").notNull(), // "newt" or "wireguard"
        online: boolean("online").notNull().default(false),
        lastPing: integer("lastPing"),
        address: varchar("address"),
        endpoint: varchar("endpoint"),
        localEndpoints: varchar("localEndpoints"), // JSON encoded list of string ips on the local machine to try to connect to
        publicKey: varchar("publicKey"),
        lastHolePunch: bigint("lastHolePunch", { mode: "number" }),
        listenPort: integer("listenPort"),
        dockerSocketEnabled: boolean("dockerSocketEnabled")
            .notNull()
            .default(true),
        autoUpdateEnabled: boolean("autoUpdateEnabled")
            .notNull()
            .default(false),
        autoUpdateOverrideOrg: boolean("autoUpdateOverrideOrg")
            .notNull()
            .default(false),
        status: varchar("status")
            .$type<"pending" | "approved">()
            .default("approved")
    },
    (t) => [
        index("idx_sites_exitnodeid").on(t.exitNodeId),
        index("idx_sites_exitnode_type_siteid").on(
            t.exitNodeId,
            t.type,
            t.siteId
        ),
        index("idx_sites_orgid_niceid").on(t.orgId, t.niceId)
    ]
);

export const resources = pgTable(
    "resources",
    {
        resourceId: serial("resourceId").primaryKey(),
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
        resourceGuid: varchar("resourceGuid", { length: 36 })
            .unique()
            .notNull()
            .$defaultFn(() => randomUUID()),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        niceId: text("niceId").notNull(),
        name: varchar("name").notNull(),
        subdomain: varchar("subdomain"),
        fullDomain: varchar("fullDomain"),
        domainId: varchar("domainId").references(() => domains.domainId, {
            onDelete: "set null"
        }),
        ssl: boolean("ssl").notNull().default(false),
        blockAccess: boolean("blockAccess").notNull().default(false),
        proxyPort: integer("proxyPort"),
        sso: boolean("sso"),
        emailWhitelistEnabled: boolean("emailWhitelistEnabled"),
        applyRules: boolean("applyRules"),
        enabled: boolean("enabled").notNull().default(true),
        stickySession: boolean("stickySession").notNull().default(false),
        tlsServerName: varchar("tlsServerName"),
        setHostHeader: varchar("setHostHeader"),
        enableProxy: boolean("enableProxy").default(true),
        skipToIdpId: integer("skipToIdpId").references(() => idp.idpId, {
            onDelete: "set null"
        }),
        headers: text("headers"), // comma-separated list of headers to add to the request
        proxyProtocol: boolean("proxyProtocol").notNull().default(false),
        proxyProtocolVersion: integer("proxyProtocolVersion").default(1),
        maintenanceModeEnabled: boolean("maintenanceModeEnabled")
            .notNull()
            .default(false),
        maintenanceModeType: text("maintenanceModeType", {
            enum: ["forced", "automatic"]
        }).default("forced"), // "forced" = always show, "automatic" = only when down
        maintenanceTitle: text("maintenanceTitle"),
        maintenanceMessage: text("maintenanceMessage"),
        maintenanceEstimatedTime: text("maintenanceEstimatedTime"),
        postAuthPath: text("postAuthPath"),
        health: varchar("health").default("unknown"), // "healthy", "unhealthy", "unknown"
        wildcard: boolean("wildcard").notNull().default(false),
        mode: text("mode")
            .default("http")
            .$type<
                "rdp" | "ssh" | "http" | "vnc" | "inference" | "tcp" | "udp"
            >()
            .notNull(),
        pamMode: varchar("pamMode", { length: 32 })
            .$type<"passthrough" | "push">()
            .default("passthrough"),
        authDaemonMode: varchar("authDaemonMode", { length: 32 })
            .$type<"site" | "remote" | "native">()
            .default("site"),
        authDaemonPort: integer("authDaemonPort").default(22123),
        status: varchar("status")
            .$type<"pending" | "approved">()
            .default("approved")
    },
    (t) => [
        index("idx_resources_fulldomain")
            .on(t.fullDomain)
            .where(sql`${t.fullDomain} IS NOT NULL`),
        index("idx_resources_niceid").on(t.niceId),
        index("idx_resources_orgid_niceid").on(t.orgId, t.niceId)
    ]
);

export const resourceAiProviders = pgTable(
    "resourceAiProviders",
    {
        resourceId: integer("resourceId")
            .notNull()
            .references(() => resources.resourceId, { onDelete: "cascade" }),
        providerId: integer("providerId")
            .notNull()
            .references(() => aiProviders.providerId, { onDelete: "cascade" }),
        accessMode: varchar("accessMode")
            .$type<"inherit" | "select">()
            .notNull()
            .default("inherit"),
        enabled: boolean("enabled").notNull().default(true)
    },
    (t) => [primaryKey({ columns: [t.resourceId, t.providerId] })]
);

export const resourceAiModels = pgTable(
    "resourceAiModels",
    {
        resourceId: integer("resourceId")
            .notNull()
            .references(() => resources.resourceId, { onDelete: "cascade" }),
        modelId: integer("modelId")
            .notNull()
            .references(() => aiModels.modelId, { onDelete: "cascade" }),
        listType: varchar("listType")
            .$type<"allow" | "block">()
            .notNull()
            .default("allow")
    },
    (t) => [primaryKey({ columns: [t.resourceId, t.modelId] })]
);

export const labels = pgTable(
    "labels",
    {
        labelId: serial("labelId").primaryKey(),
        name: varchar("name").notNull(),
        color: varchar("color").notNull(),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [index("idx_labels_orgid").on(t.orgId)]
);

export const launcherViews = pgTable("launcherViews", {
    viewId: serial("viewId").primaryKey(),
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    userId: varchar("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    name: varchar("name").notNull(),
    config: text("config").notNull(),
    isDefault: boolean("isDefault").notNull().default(false),
    createdAt: varchar("createdAt").notNull(),
    updatedAt: varchar("updatedAt").notNull()
});

export const siteLabels = pgTable(
    "siteLabels",
    {
        siteLabelId: serial("siteLabelId").primaryKey(),
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

export const resourceLabels = pgTable(
    "resourceLabels",
    {
        resourceLabelId: serial("resourceLabelId").primaryKey(),
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

export const siteResourceLabels = pgTable(
    "siteResourceLabels",
    {
        siteResourceLabelId: serial("siteResourceLabelId").primaryKey(),
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

export const clientLabels = pgTable(
    "clientLabels",
    {
        clientLabelId: serial("clientLabelId").primaryKey(),
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

export const targets = pgTable(
    "targets",
    {
        targetId: serial("targetId").primaryKey(),
        resourceId: integer("resourceId").references(
            () => resources.resourceId,
            {
                onDelete: "cascade"
            }
        ),
        providerId: integer("providerId").references(
            () => aiProviders.providerId,
            {
                onDelete: "cascade"
            }
        ),
        siteId: integer("siteId")
            .references(() => sites.siteId, {
                onDelete: "cascade"
            })
            .notNull(),
        ip: varchar("ip").notNull(),
        method: varchar("method"),
        port: integer("port").notNull(),
        internalPort: integer("internalPort"),
        enabled: boolean("enabled").notNull().default(true),
        path: text("path"),
        pathMatchType: text("pathMatchType"), // exact, prefix, regex
        rewritePath: text("rewritePath"), // if set, rewrites the path to this value before sending to the target
        rewritePathType: text("rewritePathType"), // exact, prefix, regex, stripPrefix
        priority: integer("priority").notNull().default(100),
        mode: varchar("mode")
            .$type<"http" | "tcp" | "udp" | "ssh" | "rdp" | "vnc">()
            .notNull()
            .default("http"),
        authToken: varchar("authToken")
    },
    (t) => [
        index("idx_targets_resourceid_siteid").on(t.resourceId, t.siteId),
        index("idx_targets_providerid_siteid").on(t.providerId, t.siteId),
        index("idx_targets_site_enabled_priority_target_resource")
            .on(t.siteId, t.priority.desc(), t.targetId, t.resourceId)
            .where(sql`${t.enabled} = true`)
    ]
);

export const targetHealthCheck = pgTable(
    "targetHealthCheck",
    {
        targetHealthCheckId: serial("targetHealthCheckId").primaryKey(),
        targetId: integer("targetId").references(() => targets.targetId, {
            onDelete: "cascade"
        }),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        siteId: integer("siteId")
            .references(() => sites.siteId, {
                onDelete: "cascade"
            })
            .notNull(),
        name: varchar("name"),
        hcEnabled: boolean("hcEnabled").notNull().default(false),
        hcPath: varchar("hcPath"),
        hcScheme: varchar("hcScheme"),
        hcMode: varchar("hcMode").default("http"),
        hcHostname: varchar("hcHostname"),
        hcPort: integer("hcPort"),
        hcInterval: integer("hcInterval").default(30), // in seconds
        hcUnhealthyInterval: integer("hcUnhealthyInterval").default(30), // in seconds
        hcTimeout: integer("hcTimeout").default(5), // in seconds
        hcHeaders: varchar("hcHeaders"),
        hcFollowRedirects: boolean("hcFollowRedirects").default(true),
        hcMethod: varchar("hcMethod").default("GET"),
        hcStatus: integer("hcStatus"), // http code
        hcHealth: text("hcHealth")
            .$type<"unknown" | "healthy" | "unhealthy">()
            .default("unknown"), // "unknown", "healthy", "unhealthy"
        hcTlsServerName: text("hcTlsServerName"),
        hcHealthyThreshold: integer("hcHealthyThreshold").default(1),
        hcUnhealthyThreshold: integer("hcUnhealthyThreshold").default(1)
    },
    (t) => [index("idx_targethealthcheck_targetid").on(t.targetId)]
);

export const exitNodes = pgTable("exitNodes", {
    exitNodeId: serial("exitNodeId").primaryKey(),
    name: varchar("name").notNull(),
    address: varchar("address").notNull(),
    endpoint: varchar("endpoint").notNull(),
    publicKey: varchar("publicKey").notNull(),
    listenPort: integer("listenPort").notNull(),
    reachableAt: varchar("reachableAt"),
    maxConnections: integer("maxConnections"),
    online: boolean("online").notNull().default(false),
    lastPing: integer("lastPing"),
    type: text("type").default("gerbil"), // gerbil, remoteExitNode
    region: varchar("region")
});

export const siteResources = pgTable(
    "siteResources",
    {
        // this is for the clients
        siteResourceId: serial("siteResourceId").primaryKey(),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        networkId: integer("networkId").references(() => networks.networkId, {
            onDelete: "set null"
        }),
        defaultNetworkId: integer("defaultNetworkId").references(
            () => networks.networkId,
            {
                onDelete: "restrict"
            }
        ),
        requiresExitNodeConnection: boolean("requiresExitNodeConnection")
            .notNull()
            .default(false),
        niceId: varchar("niceId").notNull(),
        name: varchar("name").notNull(),
        ssl: boolean("ssl").notNull().default(false),
        mode: varchar("mode")
            .$type<"host" | "cidr" | "http" | "ssh" | "inference">()
            .notNull(), // "host" | "cidr" | "http"
        scheme: varchar("scheme").$type<"http" | "https">(), // only for when we are doing https or http mode
        proxyPort: integer("proxyPort"), // only for port mode
        destinationPort: integer("destinationPort"), // only for port mode
        destination: varchar("destination"), // ip, cidr, hostname; validate against the mode
        enabled: boolean("enabled").notNull().default(true),
        alias: varchar("alias"),
        aliasAddress: varchar("aliasAddress"),
        tcpPortRangeString: varchar("tcpPortRangeString")
            .notNull()
            .default("*"),
        udpPortRangeString: varchar("udpPortRangeString")
            .notNull()
            .default("*"),
        disableIcmp: boolean("disableIcmp").notNull().default(false),
        authDaemonPort: integer("authDaemonPort").default(22123),
        pamMode: varchar("pamMode", { length: 32 })
            .$type<"passthrough" | "push">()
            .default("passthrough"),
        authDaemonMode: varchar("authDaemonMode", { length: 32 })
            .$type<"site" | "remote" | "native">()
            .default("site"),
        domainId: varchar("domainId").references(() => domains.domainId, {
            onDelete: "set null"
        }),
        subdomain: varchar("subdomain"),
        fullDomain: varchar("fullDomain"),
        status: varchar("status")
            .$type<"pending" | "approved">()
            .default("approved")
    },
    (t) => [index("idx_siteresources_orgid_niceid").on(t.orgId, t.niceId)]
);

export const siteResourceAiProviders = pgTable(
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
        accessMode: varchar("accessMode")
            .$type<"inherit" | "select">()
            .notNull()
            .default("inherit"),
        enabled: boolean("enabled").notNull().default(true)
    },
    (t) => [primaryKey({ columns: [t.siteResourceId, t.providerId] })]
);

export const siteResourceAiModels = pgTable(
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
        listType: varchar("listType")
            .$type<"allow" | "block">()
            .notNull()
            .default("allow")
    },
    (t) => [primaryKey({ columns: [t.siteResourceId, t.modelId] })]
);

export const networks = pgTable(
    "networks",
    {
        networkId: serial("networkId").primaryKey(),
        niceId: text("niceId"),
        name: text("name"),
        scope: varchar("scope")
            .$type<"global" | "resource">()
            .notNull()
            .default("global"),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [index("idx_networks_orgid").on(t.orgId)]
);

export const siteNetworks = pgTable(
    "siteNetworks",
    {
        siteId: integer("siteId")
            .notNull()
            .references(() => sites.siteId, {
                onDelete: "cascade"
            }),
        networkId: integer("networkId")
            .notNull()
            .references(() => networks.networkId, { onDelete: "cascade" })
    },
    (t) => [
        index("idx_sitenetworks_siteid").on(t.siteId),
        index("idx_sitenetworks_networkid").on(t.networkId)
    ]
);

export const clientSiteResources = pgTable(
    "clientSiteResources",
    {
        clientId: integer("clientId")
            .notNull()
            .references(() => clients.clientId, { onDelete: "cascade" }),
        siteResourceId: integer("siteResourceId")
            .notNull()
            .references(() => siteResources.siteResourceId, {
                onDelete: "cascade"
            })
    },
    (t) => [
        index("idx_clientsiteresources_clientid").on(t.clientId),
        index("idx_clientsiteresources_siteresourceid").on(t.siteResourceId)
    ]
);

export const roleSiteResources = pgTable(
    "roleSiteResources",
    {
        roleId: integer("roleId")
            .notNull()
            .references(() => roles.roleId, { onDelete: "cascade" }),
        siteResourceId: integer("siteResourceId")
            .notNull()
            .references(() => siteResources.siteResourceId, {
                onDelete: "cascade"
            })
    },
    (t) => [index("idx_rolesiteresources_siteresourceid").on(t.siteResourceId)]
);

export const userSiteResources = pgTable(
    "userSiteResources",
    {
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        siteResourceId: integer("siteResourceId")
            .notNull()
            .references(() => siteResources.siteResourceId, {
                onDelete: "cascade"
            })
    },
    (t) => [
        index("idx_usersiteresources_userid").on(t.userId),
        index("idx_usersiteresources_siteresourceid").on(t.siteResourceId)
    ]
);

export const users = pgTable("user", {
    userId: varchar("id").primaryKey(),
    email: varchar("email"),
    username: varchar("username").notNull(),
    name: varchar("name"),
    type: varchar("type").notNull(), // "internal", "oidc"
    idpId: integer("idpId").references(() => idp.idpId, {
        onDelete: "cascade"
    }),
    passwordHash: varchar("passwordHash"),
    twoFactorEnabled: boolean("twoFactorEnabled").notNull().default(false),
    twoFactorSetupRequested: boolean("twoFactorSetupRequested").default(false),
    twoFactorSecret: varchar("twoFactorSecret"),
    emailVerified: boolean("emailVerified").notNull().default(false),
    dateCreated: varchar("dateCreated").notNull(),
    termsAcceptedTimestamp: varchar("termsAcceptedTimestamp"),
    termsVersion: varchar("termsVersion"),
    marketingEmailConsent: boolean("marketingEmailConsent").default(false),
    serverAdmin: boolean("serverAdmin").notNull().default(false),
    lastPasswordChange: bigint("lastPasswordChange", { mode: "number" }),
    locale: varchar("locale")
});

export const newts = pgTable(
    "newt",
    {
        newtId: varchar("id").primaryKey(),
        secretHash: varchar("secretHash").notNull(),
        dateCreated: varchar("dateCreated").notNull(),
        version: varchar("version"),
        siteId: integer("siteId").references(() => sites.siteId, {
            onDelete: "cascade"
        })
    },
    (t) => [index("idx_newt_siteid").on(t.siteId)]
);

export const twoFactorBackupCodes = pgTable("twoFactorBackupCodes", {
    codeId: serial("id").primaryKey(),
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    codeHash: varchar("codeHash").notNull()
});

export const sessions = pgTable(
    "session",
    {
        sessionId: varchar("id").primaryKey(),
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
        issuedAt: bigint("issuedAt", { mode: "number" }),
        deviceAuthUsed: boolean("deviceAuthUsed").notNull().default(false)
    },
    (t) => [index("idx_sessions_userid").on(t.userId)]
);

export const newtSessions = pgTable("newtSession", {
    sessionId: varchar("id").primaryKey(),
    newtId: varchar("newtId")
        .notNull()
        .references(() => newts.newtId, { onDelete: "cascade" }),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const userOrgs = pgTable(
    "userOrgs",
    {
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        isOwner: boolean("isOwner").notNull().default(false),
        autoProvisioned: boolean("autoProvisioned").default(false),
        pamUsername: varchar("pamUsername") // cleaned username for ssh and such
    },
    (t) => [
        index("idx_userOrgs_userid").on(t.userId),
        index("idx_userOrgs_orgid").on(t.orgId)
    ]
);

export const emailVerificationCodes = pgTable("emailVerificationCodes", {
    codeId: serial("id").primaryKey(),
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    email: varchar("email").notNull(),
    code: varchar("code").notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const passwordResetTokens = pgTable("passwordResetTokens", {
    tokenId: serial("id").primaryKey(),
    email: varchar("email").notNull(),
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    tokenHash: varchar("tokenHash").notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const actions = pgTable("actions", {
    actionId: varchar("actionId").primaryKey(),
    name: varchar("name"),
    description: varchar("description")
});

export const roles = pgTable(
    "roles",
    {
        roleId: serial("roleId").primaryKey(),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull(),
        isAdmin: boolean("isAdmin"),
        name: varchar("name").notNull(),
        description: varchar("description"),
        requireDeviceApproval: boolean("requireDeviceApproval").default(false),
        sshSudoMode: varchar("sshSudoMode", { length: 32 }).default("full"), // "none" | "full" | "commands"
        sshSudoCommands: text("sshSudoCommands").default("[]"),
        sshCreateHomeDir: boolean("sshCreateHomeDir").default(true),
        sshUnixGroups: text("sshUnixGroups").default("[]")
    },
    (t) => [index("idx_roles_orgid").on(t.orgId)]
);

export const userOrgRoles = pgTable(
    "userOrgRoles",
    {
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        roleId: integer("roleId")
            .notNull()
            .references(() => roles.roleId, { onDelete: "cascade" })
    },
    (t) => [unique().on(t.userId, t.orgId, t.roleId)]
);

export const roleActions = pgTable(
    "roleActions",
    {
        roleId: integer("roleId")
            .notNull()
            .references(() => roles.roleId, { onDelete: "cascade" }),
        actionId: varchar("actionId")
            .notNull()
            .references(() => actions.actionId, { onDelete: "cascade" }),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" })
    },
    (t) => [
        index("idx_roleActions_roleId_orgId_actionId").on(
            t.roleId,
            t.orgId,
            t.actionId
        )
    ]
);

export const userActions = pgTable(
    "userActions",
    {
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        actionId: varchar("actionId")
            .notNull()
            .references(() => actions.actionId, { onDelete: "cascade" }),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" })
    },
    (t) => [
        index("idx_userActions_userId_orgId_actionId").on(
            t.userId,
            t.orgId,
            t.actionId
        )
    ]
);

export const roleSites = pgTable("roleSites", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    siteId: integer("siteId")
        .notNull()
        .references(() => sites.siteId, { onDelete: "cascade" })
});

export const userSites = pgTable("userSites", {
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    siteId: integer("siteId")
        .notNull()
        .references(() => sites.siteId, { onDelete: "cascade" })
});

export const roleResources = pgTable("roleResources", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

export const userResources = pgTable("userResources", {
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

export const rolePolicies = pgTable("rolePolicies", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const userPolicies = pgTable("userPolicies", {
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourcePolicyWhiteList = pgTable("resourcePolicyWhitelist", {
    whitelistId: serial("id").primaryKey(),
    email: varchar("email").notNull(),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const userInvites = pgTable("userInvites", {
    inviteId: varchar("inviteId").primaryKey(),
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    email: varchar("email").notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
    tokenHash: varchar("token").notNull()
});

export const userInviteRoles = pgTable(
    "userInviteRoles",
    {
        inviteId: varchar("inviteId")
            .notNull()
            .references(() => userInvites.inviteId, { onDelete: "cascade" }),
        roleId: integer("roleId")
            .notNull()
            .references(() => roles.roleId, { onDelete: "cascade" })
    },
    (t) => [primaryKey({ columns: [t.inviteId, t.roleId] })]
);

export const resourcePincode = pgTable("resourcePincode", {
    pincodeId: serial("pincodeId").primaryKey(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    pincodeHash: varchar("pincodeHash").notNull(),
    digitLength: integer("digitLength").notNull()
});

export const resourcePassword = pgTable("resourcePassword", {
    passwordId: serial("passwordId").primaryKey(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    passwordHash: varchar("passwordHash").notNull()
});

export const resourceHeaderAuth = pgTable("resourceHeaderAuth", {
    headerAuthId: serial("headerAuthId").primaryKey(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    headerAuthHash: varchar("headerAuthHash").notNull()
});

export const resourceHeaderAuthExtendedCompatibility = pgTable(
    "resourceHeaderAuthExtendedCompatibility",
    {
        headerAuthExtendedCompatibilityId: serial(
            "headerAuthExtendedCompatibilityId"
        ).primaryKey(),
        resourceId: integer("resourceId")
            .notNull()
            .references(() => resources.resourceId, { onDelete: "cascade" }),
        extendedCompatibilityIsActivated: boolean(
            "extendedCompatibilityIsActivated"
        )
            .notNull()
            .default(true)
    }
);

export const resourcePolicyPincode = pgTable("resourcePolicyPincode", {
    pincodeId: serial("pincodeId").primaryKey(),
    pincodeHash: varchar("pincodeHash").notNull(),
    digitLength: integer("digitLength").notNull(),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourcePolicyPassword = pgTable("resourcePolicyPassword", {
    passwordId: serial("passwordId").primaryKey(),
    passwordHash: varchar("passwordHash").notNull(),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourcePolicyHeaderAuth = pgTable("resourcePolicyHeaderAuth", {
    headerAuthId: serial("headerAuthId").primaryKey(),
    headerAuthHash: varchar("headerAuthHash").notNull(),
    extendedCompatibility: boolean("extendedCompatibility")
        .notNull()
        .default(true),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        })
});

export const resourceAccessToken = pgTable("resourceAccessToken", {
    accessTokenId: varchar("accessTokenId").primaryKey(),
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    userId: varchar("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    path: varchar("path"),
    tokenHash: varchar("tokenHash").notNull(),
    sessionLength: bigint("sessionLength", { mode: "number" }).notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }),
    title: varchar("title"),
    description: varchar("description"),
    persistSession: boolean("persistSession").notNull().default(false),
    createdAt: bigint("createdAt", { mode: "number" }).notNull()
});

export const resourceSessions = pgTable("resourceSessions", {
    sessionId: varchar("id").primaryKey(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
    sessionLength: bigint("sessionLength", { mode: "number" }).notNull(),
    doNotExtend: boolean("doNotExtend").notNull().default(false),
    isRequestToken: boolean("isRequestToken"),
    userSessionId: varchar("userSessionId").references(
        () => sessions.sessionId,
        {
            onDelete: "cascade"
        }
    ),
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
    accessTokenId: varchar("accessTokenId").references(
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
    issuedAt: bigint("issuedAt", { mode: "number" })
});

export const resourceWhitelist = pgTable("resourceWhitelist", {
    whitelistId: serial("id").primaryKey(),
    email: varchar("email").notNull(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" })
});

export const resourceOtp = pgTable("resourceOtp", {
    otpId: serial("otpId").primaryKey(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    email: varchar("email").notNull(),
    otpHash: varchar("otpHash").notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const versionMigrations = pgTable("versionMigrations", {
    version: varchar("version").primaryKey(),
    executedAt: bigint("executedAt", { mode: "number" }).notNull()
});

export const resourceRules = pgTable("resourceRules", {
    ruleId: serial("ruleId").primaryKey(),
    resourceId: integer("resourceId")
        .notNull()
        .references(() => resources.resourceId, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull(),
    action: varchar("action").notNull(), // ACCEPT, DROP, PASS
    match: varchar("match")
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
    value: varchar("value").notNull()
});

export const resourcePolicyRules = pgTable("resourcePolicyRules", {
    ruleId: serial("ruleId").primaryKey(),
    resourcePolicyId: integer("resourcePolicyId")
        .notNull()
        .references(() => resourcePolicies.resourcePolicyId, {
            onDelete: "cascade"
        }),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull(),
    action: varchar("action").$type<"ACCEPT" | "DROP" | "PASS">().notNull(),
    match: varchar("match")
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
    value: varchar("value").notNull()
});

export const resourcePolicies = pgTable(
    "resourcePolicies",
    {
        resourcePolicyId: serial("resourcePolicyId").primaryKey(),
        sso: boolean("sso").notNull().default(true),
        applyRules: boolean("applyRules").notNull().default(false),
        scope: varchar("scope")
            .$type<"global" | "resource">()
            .notNull()
            .default("global"),
        emailWhitelistEnabled: boolean("emailWhitelistEnabled")
            .notNull()
            .default(false),
        idpId: integer("idpId").references(() => idp.idpId, {
            onDelete: "set null"
        }),
        niceId: text("niceId").notNull(),
        name: varchar("name").notNull(),
        orgId: varchar("orgId")
            .references(() => orgs.orgId, {
                onDelete: "cascade"
            })
            .notNull()
    },
    (t) => [index("idx_resourcepolicies_orgid_niceid").on(t.orgId, t.niceId)]
);

export const supporterKey = pgTable("supporterKey", {
    keyId: serial("keyId").primaryKey(),
    key: varchar("key").notNull(),
    githubUsername: varchar("githubUsername").notNull(),
    phrase: varchar("phrase"),
    tier: varchar("tier"),
    valid: boolean("valid").notNull().default(false)
});

export const idp = pgTable("idp", {
    idpId: serial("idpId").primaryKey(),
    name: varchar("name").notNull(),
    type: varchar("type").notNull(),
    defaultRoleMapping: varchar("defaultRoleMapping"),
    defaultOrgMapping: varchar("defaultOrgMapping"),
    autoProvision: boolean("autoProvision").notNull().default(false),
    tags: text("tags")
});

export const idpOidcConfig = pgTable("idpOidcConfig", {
    idpOauthConfigId: serial("idpOauthConfigId").primaryKey(),
    idpId: integer("idpId")
        .notNull()
        .references(() => idp.idpId, { onDelete: "cascade" }),
    variant: varchar("variant").notNull().default("oidc"),
    clientId: varchar("clientId").notNull(),
    clientSecret: varchar("clientSecret").notNull(),
    authUrl: varchar("authUrl").notNull(),
    tokenUrl: varchar("tokenUrl").notNull(),
    identifierPath: varchar("identifierPath").notNull(),
    emailPath: varchar("emailPath"),
    namePath: varchar("namePath"),
    scopes: varchar("scopes").notNull()
});

export const licenseKey = pgTable("licenseKey", {
    licenseKeyId: varchar("licenseKeyId").primaryKey().notNull(),
    instanceId: varchar("instanceId").notNull(),
    token: varchar("token").notNull()
});

export const hostMeta = pgTable("hostMeta", {
    hostMetaId: varchar("hostMetaId").primaryKey().notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull()
});

export const apiKeys = pgTable("apiKeys", {
    apiKeyId: varchar("apiKeyId").primaryKey(),
    name: varchar("name").notNull(),
    apiKeyHash: varchar("apiKeyHash").notNull(),
    lastChars: varchar("lastChars").notNull(),
    createdAt: varchar("dateCreated").notNull(),
    isRoot: boolean("isRoot").notNull().default(false)
});

export const apiKeyActions = pgTable("apiKeyActions", {
    apiKeyId: varchar("apiKeyId")
        .notNull()
        .references(() => apiKeys.apiKeyId, { onDelete: "cascade" }),
    actionId: varchar("actionId")
        .notNull()
        .references(() => actions.actionId, { onDelete: "cascade" })
});

export const apiKeyOrg = pgTable("apiKeyOrg", {
    apiKeyId: varchar("apiKeyId")
        .notNull()
        .references(() => apiKeys.apiKeyId, { onDelete: "cascade" }),
    orgId: varchar("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull()
});

export const virtualApiKeys = pgTable(
    "virtualApiKeys",
    {
        virtualApiKeyId: varchar("virtualApiKeyId").primaryKey(),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        kind: varchar("kind").$type<"user" | "manual">().notNull(),
        userId: varchar("userId").references(() => users.userId, {
            onDelete: "cascade"
        }),
        name: varchar("name"),
        description: varchar("description"),
        token: varchar("token").notNull(),
        lastChars: varchar("lastChars").notNull(),
        allResources: boolean("allResources").notNull().default(false),
        expiresAt: bigint("expiresAt", { mode: "number" }),
        lastUsedAt: bigint("lastUsedAt", { mode: "number" }),
        createdAt: bigint("createdAt", { mode: "number" }).notNull(),
        createdByUserId: varchar("createdByUserId").references(
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

export const virtualApiKeyResources = pgTable(
    "virtualApiKeyResources",
    {
        virtualApiKeyId: varchar("virtualApiKeyId")
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

export const oauthClients = pgTable(
    "oauthClients",
    {
        clientId: varchar("clientId").primaryKey(),
        clientSecret: varchar("clientSecret"), // Encrypted with server secret
        lastChars: varchar("lastChars").notNull().default(""),
        clientAuthenticationMethod: varchar("clientAuthenticationMethod")
            .notNull()
            .$type<ClientAuthenticationMethod>()
            .default("client_secret_jwt"),
        clientName: varchar("clientName").notNull(),
        clientUri: varchar("clientUri"),
        logoUri: varchar("logoUri"),
        redirectUris: json("redirectUris").notNull().$type<string[]>(),
        scopes: varchar("scopes").notNull().default("openid profile email"),
        pkceRequired: boolean("pkceRequired").notNull().default(true),
        enabled: boolean("enabled").notNull().default(true),
        logoutTerminatesPangolinSession: boolean(
            "logoutTerminatesPangolinSession"
        )
            .notNull()
            .default(false),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        backchannelLogoutUri: varchar("backchannelLogoutUri"),
        postLogoutRedirectUris: json("postLogoutRedirectUris").$type<
            string[] | null
        >(),
        createdAt: bigint("createdAt", { mode: "number" }).notNull(),
        updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
    },
    (table) => [
        index("idx_oauthClients_orgId").on(table.orgId),
        index("idx_oauthClients_enabled").on(table.enabled)
    ]
);

export const oauthInteractions = pgTable(
    "oauthInteractions",
    {
        interactionId: varchar("interactionId").primaryKey(),
        clientId: varchar("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: varchar("scope").notNull(),
        state: varchar("state").notNull(),
        nonce: varchar("nonce"),
        redirectUri: varchar("redirectUri").notNull(),
        codeChallenge: varchar("codeChallenge"),
        codeChallengeMethod: varchar("codeChallengeMethod"),
        responseType: varchar("responseType").notNull(),
        expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
        createdAt: bigint("createdAt", { mode: "number" }).notNull()
    },
    (table) => [
        index("idx_oauthInteractions_expiresAt").on(table.expiresAt),
        index("idx_oauthInteractions_clientId").on(table.clientId),
        index("idx_oauthInteractions_userId").on(table.userId)
    ]
);

export const oauthAuthorizationCodes = pgTable(
    "oauthAuthorizationCodes",
    {
        codeId: varchar("codeId").primaryKey(),
        codeHash: varchar("codeHash").notNull(),
        clientId: varchar("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: varchar("scope").notNull(),
        redirectUri: varchar("redirectUri").notNull(),
        codeChallenge: varchar("codeChallenge"),
        codeChallengeMethod: varchar("codeChallengeMethod"),
        nonce: varchar("nonce"),
        expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
        createdAt: bigint("createdAt", { mode: "number" }).notNull()
    },
    (table) => [
        uniqueIndex("uidx_oauthAuthorizationCodes_codeHash").on(table.codeHash),
        index("idx_oauthAuthorizationCodes_expiresAt").on(table.expiresAt),
        index("idx_oauthAuthorizationCodes_clientId").on(table.clientId),
        index("idx_oauthAuthorizationCodes_userId").on(table.userId)
    ]
);

export const oauthAccessTokens = pgTable(
    "oauthAccessTokens",
    {
        accessTokenId: varchar("accessTokenId").primaryKey(),
        grantId: varchar("grantId").notNull(),
        tokenHash: varchar("tokenHash").notNull(),
        clientId: varchar("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: varchar("scope").notNull(),
        expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
        createdAt: bigint("createdAt", { mode: "number" }).notNull()
    },
    (table) => [
        uniqueIndex("uidx_oauthAccessTokens_tokenHash").on(table.tokenHash),
        index("idx_oauthAccessTokens_expiresAt").on(table.expiresAt),
        index("idx_oauthAccessTokens_grantId").on(table.grantId),
        index("idx_oauthAccessTokens_clientId").on(table.clientId),
        index("idx_oauthAccessTokens_userId").on(table.userId)
    ]
);

export const oauthRefreshTokens = pgTable(
    "oauthRefreshTokens",
    {
        refreshTokenId: varchar("refreshTokenId").primaryKey(),
        grantId: varchar("grantId").notNull(),
        tokenHash: varchar("tokenHash").notNull(),
        clientId: varchar("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        scope: varchar("scope").notNull(),
        expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
        revokedAt: bigint("revokedAt", { mode: "number" }),
        createdAt: bigint("createdAt", { mode: "number" }).notNull()
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

export const oauthConsents = pgTable(
    "oauthConsents",
    {
        consentId: varchar("consentId").primaryKey(),
        userId: varchar("userId")
            .notNull()
            .references(() => users.userId, { onDelete: "cascade" }),
        clientId: varchar("clientId")
            .notNull()
            .references(() => oauthClients.clientId, { onDelete: "cascade" }),
        scope: varchar("scope").notNull(),
        createdAt: bigint("createdAt", { mode: "number" }).notNull(),
        updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
    },
    (table) => [
        uniqueIndex("uidx_oauthConsents_userId_clientId").on(
            table.userId,
            table.clientId
        ),
        index("idx_oauthConsents_clientId").on(table.clientId)
    ]
);

export const oauthSigningKeys = pgTable(
    "oauthSigningKeys",
    {
        keyId: varchar("keyId").primaryKey(),
        algorithm: varchar("algorithm").notNull(),
        publicKeyPem: varchar("publicKeyPem").notNull(),
        privateKeyPem: varchar("privateKeyPem").notNull(),
        active: boolean("active").notNull().default(true),
        createdAt: bigint("createdAt", { mode: "number" }).notNull()
    },
    (table) => [index("idx_oauthSigningKeys_active").on(table.active)]
);

export const idpOrg = pgTable("idpOrg", {
    idpId: integer("idpId")
        .notNull()
        .references(() => idp.idpId, { onDelete: "cascade" }),
    orgId: varchar("orgId")
        .notNull()
        .references(() => orgs.orgId, { onDelete: "cascade" }),
    roleMapping: varchar("roleMapping"),
    orgMapping: varchar("orgMapping")
});

export const clients = pgTable(
    "clients",
    {
        clientId: serial("clientId").primaryKey(),
        orgId: varchar("orgId")
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
        niceId: varchar("niceId").notNull(),
        olmId: text("olmId"), // to lock it to a specific olm optionally
        name: varchar("name").notNull(),
        pubKey: varchar("pubKey"),
        subnet: varchar("subnet").notNull(),
        exitNodeSubnet: varchar("exitNodeSubnet"), // INCLUDES THE CIDR
        megabytesIn: real("bytesIn"),
        megabytesOut: real("bytesOut"),
        lastBandwidthUpdate: varchar("lastBandwidthUpdate"),
        lastPing: integer("lastPing"),
        type: varchar("type").notNull(), // "olm"
        online: boolean("online").notNull().default(false),
        // endpoint: varchar("endpoint"),
        lastHolePunch: integer("lastHolePunch"),
        maxConnections: integer("maxConnections"),
        archived: boolean("archived").notNull().default(false),
        blocked: boolean("blocked").notNull().default(false),
        approvalState: varchar("approvalState").$type<
            "pending" | "approved" | "denied"
        >()
    },
    (t) => [
        index("idx_clients_userid").on(t.userId),
        index("idx_clients_orgid_niceid").on(t.orgId, t.niceId)
    ]
);

export const clientSitesAssociationsCache = pgTable(
    "clientSitesAssociationsCache",
    {
        clientId: integer("clientId") // not a foreign key here so after its deleted the rebuild function can delete it and send the message
            .notNull(),
        siteId: integer("siteId").notNull(),
        isRelayed: boolean("isRelayed").notNull().default(false),
        isJitMode: boolean("isJitMode").notNull().default(false),
        endpoint: varchar("endpoint"),
        publicKey: varchar("publicKey") // this will act as the session's public key for hole punching so we can track when it changes
    },
    (t) => [
        primaryKey({ columns: [t.clientId, t.siteId] }),
        index("idx_clientsitesassociationscache_siteid").on(t.siteId)
    ]
);

export const clientSiteResourcesAssociationsCache = pgTable(
    "clientSiteResourcesAssociationsCache",
    {
        clientId: integer("clientId") // not a foreign key here so after its deleted the rebuild function can delete it and send the message
            .notNull(),
        siteResourceId: integer("siteResourceId").notNull()
    },
    (t) => [
        primaryKey({ columns: [t.clientId, t.siteResourceId] }),
        index("idx_clientSiteResourcesAssociationsCache_siteResourceId").on(
            t.siteResourceId,
            t.clientId
        )
    ]
);

export const clientPostureSnapshots = pgTable("clientPostureSnapshots", {
    snapshotId: serial("snapshotId").primaryKey(),

    clientId: integer("clientId").references(() => clients.clientId, {
        onDelete: "cascade"
    }),

    collectedAt: integer("collectedAt").notNull()
});

export const olms = pgTable(
    "olms",
    {
        olmId: varchar("id").primaryKey(),
        secretHash: varchar("secretHash").notNull(),
        dateCreated: varchar("dateCreated").notNull(),
        version: text("version"),
        agent: text("agent"),
        name: varchar("name"),
        clientId: integer("clientId").references(() => clients.clientId, {
            // we will switch this depending on the current org it wants to connect to
            onDelete: "set null"
        }),
        userId: text("userId").references(() => users.userId, {
            // optionally tied to a user and in this case delete when the user deletes
            onDelete: "cascade"
        }),
        archived: boolean("archived").notNull().default(false)
    },
    (t) => [
        index("idx_olms_clientid").on(t.clientId),
        index("idx_olms_userid").on(t.userId)
    ]
);

export const currentFingerprint = pgTable("currentFingerprint", {
    fingerprintId: serial("id").primaryKey(),

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
    platformFingerprint: varchar("platformFingerprint"),

    // Platform-agnostic checks

    biometricsEnabled: boolean("biometricsEnabled").notNull().default(false),
    diskEncrypted: boolean("diskEncrypted").notNull().default(false),
    firewallEnabled: boolean("firewallEnabled").notNull().default(false),
    autoUpdatesEnabled: boolean("autoUpdatesEnabled").notNull().default(false),
    tpmAvailable: boolean("tpmAvailable").notNull().default(false),

    // Windows-specific posture check information

    windowsAntivirusEnabled: boolean("windowsAntivirusEnabled")
        .notNull()
        .default(false),

    // macOS-specific posture check information

    macosSipEnabled: boolean("macosSipEnabled").notNull().default(false),
    macosGatekeeperEnabled: boolean("macosGatekeeperEnabled")
        .notNull()
        .default(false),
    macosFirewallStealthMode: boolean("macosFirewallStealthMode")
        .notNull()
        .default(false),

    // Linux-specific posture check information

    linuxAppArmorEnabled: boolean("linuxAppArmorEnabled")
        .notNull()
        .default(false),
    linuxSELinuxEnabled: boolean("linuxSELinuxEnabled").notNull().default(false)
});

export const fingerprintSnapshots = pgTable("fingerprintSnapshots", {
    snapshotId: serial("id").primaryKey(),

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
    platformFingerprint: varchar("platformFingerprint"),

    // Platform-agnostic checks

    biometricsEnabled: boolean("biometricsEnabled").notNull().default(false),
    diskEncrypted: boolean("diskEncrypted").notNull().default(false),
    firewallEnabled: boolean("firewallEnabled").notNull().default(false),
    autoUpdatesEnabled: boolean("autoUpdatesEnabled").notNull().default(false),
    tpmAvailable: boolean("tpmAvailable").notNull().default(false),

    // Windows-specific posture check information

    windowsAntivirusEnabled: boolean("windowsAntivirusEnabled")
        .notNull()
        .default(false),

    // macOS-specific posture check information

    macosSipEnabled: boolean("macosSipEnabled").notNull().default(false),
    macosGatekeeperEnabled: boolean("macosGatekeeperEnabled")
        .notNull()
        .default(false),
    macosFirewallStealthMode: boolean("macosFirewallStealthMode")
        .notNull()
        .default(false),

    // Linux-specific posture check information

    linuxAppArmorEnabled: boolean("linuxAppArmorEnabled")
        .notNull()
        .default(false),
    linuxSELinuxEnabled: boolean("linuxSELinuxEnabled")
        .notNull()
        .default(false),

    hash: text("hash").notNull(),
    collectedAt: integer("collectedAt").notNull()
});

export const olmSessions = pgTable("clientSession", {
    sessionId: varchar("id").primaryKey(),
    olmId: varchar("olmId")
        .notNull()
        .references(() => olms.olmId, { onDelete: "cascade" }),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull()
});

export const userClients = pgTable("userClients", {
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, { onDelete: "cascade" }),
    clientId: integer("clientId")
        .notNull()
        .references(() => clients.clientId, { onDelete: "cascade" })
});

export const roleClients = pgTable("roleClients", {
    roleId: integer("roleId")
        .notNull()
        .references(() => roles.roleId, { onDelete: "cascade" }),
    clientId: integer("clientId")
        .notNull()
        .references(() => clients.clientId, { onDelete: "cascade" })
});

export const securityKeys = pgTable("webauthnCredentials", {
    credentialId: varchar("credentialId").primaryKey(),
    userId: varchar("userId")
        .notNull()
        .references(() => users.userId, {
            onDelete: "cascade"
        }),
    publicKey: varchar("publicKey").notNull(),
    signCount: integer("signCount").notNull(),
    transports: varchar("transports"),
    name: varchar("name"),
    lastUsed: varchar("lastUsed").notNull(),
    dateCreated: varchar("dateCreated").notNull(),
    securityKeyName: varchar("securityKeyName")
});

export const webauthnChallenge = pgTable("webauthnChallenge", {
    sessionId: varchar("sessionId").primaryKey(),
    challenge: varchar("challenge").notNull(),
    securityKeyName: varchar("securityKeyName"),
    userId: varchar("userId").references(() => users.userId, {
        onDelete: "cascade"
    }),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull() // Unix timestamp
});

export const setupTokens = pgTable("setupTokens", {
    tokenId: varchar("tokenId").primaryKey(),
    token: varchar("token").notNull(),
    used: boolean("used").notNull().default(false),
    dateCreated: varchar("dateCreated").notNull(),
    dateUsed: varchar("dateUsed")
});

// Blueprint runs
export const blueprints = pgTable("blueprints", {
    blueprintId: serial("blueprintId").primaryKey(),
    orgId: text("orgId")
        .references(() => orgs.orgId, {
            onDelete: "cascade"
        })
        .notNull(),
    name: varchar("name").notNull(),
    source: varchar("source").notNull(),
    createdAt: integer("createdAt").notNull(),
    succeeded: boolean("succeeded").notNull(),
    contents: text("contents").notNull(),
    message: text("message")
});
export const requestAuditLog = pgTable(
    "requestAuditLog",
    {
        id: serial("id").primaryKey(),
        timestamp: integer("timestamp").notNull(), // this is EPOCH time in seconds
        orgId: text("orgId").references(() => orgs.orgId, {
            onDelete: "cascade"
        }),
        action: boolean("action").notNull(),
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
        tls: boolean("tls")
    },
    (table) => [
        index("idx_requestAuditLog_timestamp").on(table.timestamp),
        index("idx_requestAuditLog_org_timestamp").on(
            table.orgId,
            table.timestamp
        )
    ]
);

export const deviceWebAuthCodes = pgTable("deviceWebAuthCodes", {
    codeId: serial("codeId").primaryKey(),
    code: text("code").notNull().unique(),
    ip: text("ip"),
    city: text("city"),
    deviceName: text("deviceName"),
    applicationName: text("applicationName").notNull(),
    expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    verified: boolean("verified").notNull().default(false),
    userId: varchar("userId").references(() => users.userId, {
        onDelete: "cascade"
    })
});

export const roundTripMessageTracker = pgTable("roundTripMessageTracker", {
    messageId: serial("messageId").primaryKey(),
    wsClientId: varchar("clientId"),
    messageType: varchar("messageType"),
    sentAt: bigint("sentAt", { mode: "number" }).notNull(),
    receivedAt: bigint("receivedAt", { mode: "number" }),
    error: text("error"),
    complete: boolean("complete").notNull().default(false)
});

export const statusHistory = pgTable(
    "statusHistory",
    {
        id: serial("id").primaryKey(),
        entityType: varchar("entityType").notNull(),
        entityId: integer("entityId").notNull(),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        status: varchar("status").notNull(),
        timestamp: integer("timestamp").notNull()
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

export const aiProviders = pgTable(
    "aiProviders",
    {
        providerId: serial("providerId").primaryKey(),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        name: varchar("name").notNull(),
        niceId: varchar("niceId").notNull(),
        type: varchar("type")
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
        apiKeyLastChars: varchar("apiKeyLastChars"),
        authType: varchar("authType")
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
        routingMode: varchar("routingMode")
            .$type<"url" | "target">()
            .notNull()
            .default("url"),
        capabilities: text("capabilities").notNull().default("[]"),
        headers: text("headers"), // JSON array of { name, value }
        skipTlsVerification: boolean("skipTlsVerification")
            .notNull()
            .default(false),
        enabled: boolean("enabled").notNull().default(true),
        createdAt: bigint("createdAt", { mode: "number" }).notNull(),
        updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
    },
    (t) => [index("idx_aiProviders_orgId_niceId").on(t.orgId, t.niceId)]
);

export const aiModels = pgTable(
    "aiModels",
    {
        modelId: serial("modelId").primaryKey(),
        providerId: integer("providerId")
            .notNull()
            .references(() => aiProviders.providerId, { onDelete: "cascade" }),
        modelKey: varchar("modelKey").notNull(),
        name: varchar("name").notNull(),
        listType: varchar("listType")
            .$type<"allow" | "block">()
            .notNull()
            .default("allow"),
        enabled: boolean("enabled").notNull().default(true),
        createdAt: bigint("createdAt", { mode: "number" }).notNull(),
        updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
    },
    (t) => [unique("ai_model_provider_key_uniq").on(t.providerId, t.modelKey)]
);

export const aiBudgets = pgTable(
    "aiBudgets",
    {
        budgetId: serial("budgetId").primaryKey(),
        orgId: varchar("orgId")
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
        virtualApiKeyId: varchar("virtualApiKeyId").references(
            () => virtualApiKeys.virtualApiKeyId,
            { onDelete: "cascade" }
        ),
        amount: real("amount").notNull(),
        unit: varchar("unit").$type<"usd" | "tokens">().notNull(),
        period: varchar("period")
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
        enforcement: varchar("enforcement")
            .$type<"hard" | "soft">()
            .notNull()
            .default("hard"),
        enabled: boolean("enabled").notNull().default(true),
        createdAt: bigint("createdAt", { mode: "number" }).notNull(),
        updatedAt: bigint("updatedAt", { mode: "number" }).notNull()
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

export const aiUsageRecords = pgTable(
    "aiUsageRecords",
    {
        id: serial("id").primaryKey(),
        orgId: varchar("orgId")
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
        userId: varchar("userId").references(() => users.userId, {
            onDelete: "set null"
        }),
        virtualApiKeyId: varchar("virtualApiKeyId").references(
            () => virtualApiKeys.virtualApiKeyId,
            { onDelete: "set null" }
        ),
        // Links this usage record back to the aiSessionLog row for the same
        // request (aiSessionLog.sessionId), so token/cost usage can be shown
        // alongside the session transcript. Not a DB-level FK - aiSessionLog
        // lives in the separate logs database. Nullable because the session
        // log may be disabled (retention set to 0) while usage tracking
        // stays on.
        sessionId: varchar("sessionId"),
        requestedModel: varchar("requestedModel").notNull(),
        promptTokens: integer("promptTokens").notNull().default(0),
        cacheReadTokens: integer("cacheReadTokens").notNull().default(0),
        cacheWriteTokens: integer("cacheWriteTokens").notNull().default(0),
        completionTokens: integer("completionTokens").notNull().default(0),
        reasoningTokens: integer("reasoningTokens").notNull().default(0),
        totalTokens: integer("totalTokens").notNull().default(0),
        costUsd: real("costUsd"),
        estimated: boolean("estimated").notNull().default(false),
        createdAt: bigint("createdAt", { mode: "number" }).notNull()
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

export const aiBudgetBreachEvents = pgTable(
    "aiBudgetBreachEvents",
    {
        id: serial("id").primaryKey(),
        orgId: varchar("orgId")
            .notNull()
            .references(() => orgs.orgId, { onDelete: "cascade" }),
        budgetId: integer("budgetId")
            .notNull()
            .references(() => aiBudgets.budgetId, { onDelete: "cascade" }),
        enforcement: varchar("enforcement").$type<"hard" | "soft">().notNull(),
        unit: varchar("unit").$type<"usd" | "tokens">().notNull(),
        period: varchar("period")
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
        blocked: boolean("blocked").notNull(),
        requestUserId: varchar("requestUserId").references(() => users.userId, {
            onDelete: "set null"
        }),
        createdAt: bigint("createdAt", { mode: "number" }).notNull()
    },
    (t) => [
        index("idx_ai_budget_breach_events_budget_created").on(
            t.budgetId,
            t.createdAt
        )
    ]
);

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

export type Org = InferSelectModel<typeof orgs>;
export type User = InferSelectModel<typeof users>;
export type Site = InferSelectModel<typeof sites>;
export type Resource = InferSelectModel<typeof resources>;
export type ExitNode = InferSelectModel<typeof exitNodes>;
export type Target = InferSelectModel<typeof targets>;
export type Session = InferSelectModel<typeof sessions>;
export type Newt = InferSelectModel<typeof newts>;
export type NewtSession = InferSelectModel<typeof newtSessions>;
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
export type ResourcePolicyPincode = InferSelectModel<
    typeof resourcePolicyPincode
>;
export type ResourcePolicyPassword = InferSelectModel<
    typeof resourcePolicyPassword
>;
export type ResourcePolicyHeaderAuth = InferSelectModel<
    typeof resourcePolicyHeaderAuth
>;

export type VersionMigration = InferSelectModel<typeof versionMigrations>;
export type ResourceRule = InferSelectModel<typeof resourceRules>;
export type Domain = InferSelectModel<typeof domains>;
export type DnsRecord = InferSelectModel<typeof dnsRecords>;
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
export type Client = InferSelectModel<typeof clients>;
export type ClientSite = InferSelectModel<typeof clientSitesAssociationsCache>;
export type Olm = InferSelectModel<typeof olms>;
export type OlmSession = InferSelectModel<typeof olmSessions>;
export type UserClient = InferSelectModel<typeof userClients>;
export type RoleClient = InferSelectModel<typeof roleClients>;
export type OrgDomains = InferSelectModel<typeof orgDomains>;
export type SiteResource = InferSelectModel<typeof siteResources>;
export type SetupToken = InferSelectModel<typeof setupTokens>;
export type HostMeta = InferSelectModel<typeof hostMeta>;
export type TargetHealthCheck = InferSelectModel<typeof targetHealthCheck>;
export type IdpOidcConfig = InferSelectModel<typeof idpOidcConfig>;
export type Blueprint = InferSelectModel<typeof blueprints>;
export type LicenseKey = InferSelectModel<typeof licenseKey>;
export type SecurityKey = InferSelectModel<typeof securityKeys>;
export type WebauthnChallenge = InferSelectModel<typeof webauthnChallenge>;
export type DeviceWebAuthCode = InferSelectModel<typeof deviceWebAuthCodes>;
export type RequestAuditLog = InferSelectModel<typeof requestAuditLog>;
export type RoundTripMessageTracker = InferSelectModel<
    typeof roundTripMessageTracker
>;
export type Network = InferSelectModel<typeof networks>;
export type StatusHistory = InferSelectModel<typeof statusHistory>;
export type Label = InferSelectModel<typeof labels>;
export type LauncherView = InferSelectModel<typeof launcherViews>;
export type ResourcePolicy = InferSelectModel<typeof resourcePolicies>;
export type RolePolicy = InferSelectModel<typeof rolePolicies>;
export type UserPolicy = InferSelectModel<typeof userPolicies>;
export type ResourcePolicyRule = InferSelectModel<typeof resourcePolicyRules>;
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
