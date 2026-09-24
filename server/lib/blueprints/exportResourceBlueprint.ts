import { stringify as stringifyYaml } from "yaml";
import { and, asc, eq, isNull, not, or } from "drizzle-orm";
import {
    aiBudgets,
    aiModels,
    clients,
    clientSiteResources,
    db,
    labels,
    resourceAiModels,
    resourceHeaderAuth,
    resourceLabels,
    resourcePassword,
    resourcePincode,
    resourcePolicies,
    resourceRules,
    resources,
    resourceWhitelist,
    roles,
    roleResources,
    roleSiteResources,
    siteNetworks,
    siteResourceAiModels,
    siteResourceLabels,
    siteResources,
    sites,
    targetHealthCheck,
    targets,
    userResources,
    userSiteResources,
    users
} from "@server/db";
import { queryResourcePolicy } from "@server/routers/policy/getResourcePolicy";
import {
    listPublicResourceAiProviders,
    listSiteResourceAiProviders
} from "@server/lib/aiInferenceResource";

const HTTP_LIKE_PUBLIC_MODES = ["http", "ssh", "rdp", "vnc", "inference"];

function reverseRuleAction(action: string): "allow" | "deny" | "pass" {
    if (action === "ACCEPT") return "allow";
    if (action === "PASS") return "pass";
    return "deny";
}

function reverseRuleMatch(match: string): string {
    return match.toLowerCase();
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
    for (const key of Object.keys(obj)) {
        if (obj[key] === undefined) {
            delete obj[key];
        }
    }
    return obj;
}

function buildHealthcheck(row: {
    hcHostname: string | null;
    hcPort: number | null;
    hcEnabled: boolean | null;
    hcPath: string | null;
    hcScheme: string | null;
    hcMode: string | null;
    hcInterval: number | null;
    hcUnhealthyInterval: number | null;
    hcTimeout: number | null;
    hcHeaders: string | null;
    hcFollowRedirects: boolean | null;
    hcMethod: string | null;
    hcStatus: number | null;
    hcHealthyThreshold: number | null;
    hcUnhealthyThreshold: number | null;
}) {
    if (!row.hcHostname) {
        return undefined;
    }

    let headers: { name: string; value: string }[] | undefined;
    if (row.hcHeaders) {
        try {
            headers = JSON.parse(row.hcHeaders);
        } catch {
            headers = undefined;
        }
    }

    return stripUndefined({
        hostname: row.hcHostname,
        port: row.hcPort ?? undefined,
        enabled: row.hcEnabled ?? undefined,
        path: row.hcPath ?? undefined,
        scheme: row.hcScheme ?? undefined,
        mode: row.hcMode ?? undefined,
        interval: row.hcInterval ?? undefined,
        "unhealthy-interval": row.hcUnhealthyInterval ?? undefined,
        timeout: row.hcTimeout ?? undefined,
        headers,
        "follow-redirects": row.hcFollowRedirects ?? undefined,
        method: row.hcMethod ?? undefined,
        status: row.hcStatus ?? undefined,
        "healthy-threshold": row.hcHealthyThreshold ?? undefined,
        "unhealthy-threshold": row.hcUnhealthyThreshold ?? undefined
    });
}

async function buildPublicAuthAndRules(resource: {
    resourceId: number;
    resourcePolicyId: number | null;
    defaultResourcePolicyId: number | null;
    sso: boolean | null;
    skipToIdpId: number | null;
}): Promise<{
    policy: string | undefined;
    auth: Record<string, any> | undefined;
    rules: Record<string, any>[];
    notes: string[];
}> {
    const notes: string[] = [];

    if (resource.resourcePolicyId) {
        // Shared policy attached: the policy's own auth config lives on the
        // policy entity itself (edited separately). The resource only carries
        // its own overrides in the legacy resource-level tables.
        const [policyRow] = await db
            .select({ niceId: resourcePolicies.niceId })
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resource.resourcePolicyId))
            .limit(1);

        const [roleRows, userRows, whitelistRows, ruleRows, passwordRow, pincodeRow, headerAuthRow] =
            await Promise.all([
                db
                    .select({ name: roles.name })
                    .from(roleResources)
                    .innerJoin(
                        roles,
                        and(
                            eq(roleResources.roleId, roles.roleId),
                            or(isNull(roles.isAdmin), not(roles.isAdmin))
                        )
                    )
                    .where(eq(roleResources.resourceId, resource.resourceId)),
                db
                    .select({ username: users.username })
                    .from(userResources)
                    .innerJoin(users, eq(userResources.userId, users.userId))
                    .where(eq(userResources.resourceId, resource.resourceId)),
                db
                    .select({ email: resourceWhitelist.email })
                    .from(resourceWhitelist)
                    .where(eq(resourceWhitelist.resourceId, resource.resourceId)),
                db
                    .select({
                        enabled: resourceRules.enabled,
                        priority: resourceRules.priority,
                        action: resourceRules.action,
                        match: resourceRules.match,
                        value: resourceRules.value
                    })
                    .from(resourceRules)
                    .where(eq(resourceRules.resourceId, resource.resourceId)),
                db
                    .select({ passwordId: resourcePassword.passwordId })
                    .from(resourcePassword)
                    .where(eq(resourcePassword.resourceId, resource.resourceId))
                    .limit(1),
                db
                    .select({ pincodeId: resourcePincode.pincodeId })
                    .from(resourcePincode)
                    .where(eq(resourcePincode.resourceId, resource.resourceId))
                    .limit(1),
                db
                    .select({ headerAuthId: resourceHeaderAuth.headerAuthId })
                    .from(resourceHeaderAuth)
                    .where(eq(resourceHeaderAuth.resourceId, resource.resourceId))
                    .limit(1)
            ]);

        if (passwordRow.length > 0) {
            notes.push(
                "A password is configured on this resource. Passwords cannot be exported for security reasons; re-set it after applying this blueprint."
            );
        }
        if (pincodeRow.length > 0) {
            notes.push(
                "A pincode is configured on this resource. Pincodes cannot be exported for security reasons; re-set it after applying this blueprint."
            );
        }
        if (headerAuthRow.length > 0) {
            notes.push(
                "Basic auth is configured on this resource. Basic auth credentials cannot be exported for security reasons; re-set it after applying this blueprint."
            );
        }

        const auth = stripUndefined({
            "sso-enabled": resource.sso ?? undefined,
            "sso-roles": roleRows.length ? roleRows.map((r) => r.name) : undefined,
            "sso-users": userRows.length
                ? userRows.map((u) => u.username)
                : undefined,
            "whitelist-users": whitelistRows.length
                ? whitelistRows.map((w) => w.email)
                : undefined,
            "auto-login-idp": resource.skipToIdpId ?? undefined
        });

        return {
            policy: policyRow?.niceId,
            auth: Object.keys(auth).length > 0 ? auth : undefined,
            rules: ruleRows.map((r) =>
                stripUndefined({
                    action: reverseRuleAction(r.action),
                    match: reverseRuleMatch(r.match),
                    value: r.value,
                    priority: r.priority,
                    enabled: r.enabled
                })
            ),
            notes
        };
    }

    if (!resource.defaultResourcePolicyId) {
        return { policy: undefined, auth: undefined, rules: [], notes };
    }

    // Inline policy: the resource's own default (non-shared) policy carries
    // all of its auth config.
    const policy = await queryResourcePolicy({
        resourcePolicyId: resource.defaultResourcePolicyId
    });

    if (!policy) {
        return { policy: undefined, auth: undefined, rules: [], notes };
    }

    if (policy.passwordId) {
        notes.push(
            "A password is configured on this resource. Passwords cannot be exported for security reasons; re-set it after applying this blueprint."
        );
    }
    if (policy.pincodeId) {
        notes.push(
            "A pincode is configured on this resource. Pincodes cannot be exported for security reasons; re-set it after applying this blueprint."
        );
    }
    if (policy.headerAuth?.id) {
        notes.push(
            "Basic auth is configured on this resource. Basic auth credentials cannot be exported for security reasons; re-set it after applying this blueprint."
        );
    }

    const auth = stripUndefined({
        "sso-enabled": policy.sso ?? undefined,
        "sso-roles": policy.roles.length
            ? policy.roles.map((r) => r.name)
            : undefined,
        "sso-users": policy.users.length
            ? policy.users.map((u) => u.username)
            : undefined,
        "whitelist-users": policy.emailWhiteList.length
            ? policy.emailWhiteList.map((w) => w.email)
            : undefined,
        "auto-login-idp": policy.idpId ?? undefined
    });

    return {
        policy: undefined,
        auth: Object.keys(auth).length > 0 ? auth : undefined,
        rules: policy.rules.map((r) =>
            stripUndefined({
                action: reverseRuleAction(r.action),
                match: reverseRuleMatch(r.match),
                value: r.value,
                priority: r.priority,
                enabled: r.enabled
            })
        ),
        notes
    };
}

async function buildAiProvidersAndBudget(input:
    | { scope: "public"; resourceId: number }
    | { scope: "site"; siteResourceId: number }
) {
    const providers =
        input.scope === "public"
            ? await listPublicResourceAiProviders(input.resourceId)
            : await listSiteResourceAiProviders(input.siteResourceId);

    const aiProvidersConfig = await Promise.all(
        providers.map(async (p) => {
            const entry: Record<string, any> = {
                provider: p.niceId,
                "access-mode": p.accessMode,
                enabled: p.enabled
            };

            if (p.accessMode === "select") {
                const modelRows =
                    input.scope === "public"
                        ? await db
                              .select({ modelKey: aiModels.modelKey })
                              .from(resourceAiModels)
                              .innerJoin(
                                  aiModels,
                                  eq(resourceAiModels.modelId, aiModels.modelId)
                              )
                              .where(
                                  and(
                                      eq(
                                          resourceAiModels.resourceId,
                                          input.resourceId
                                      ),
                                      eq(aiModels.providerId, p.providerId)
                                  )
                              )
                        : await db
                              .select({ modelKey: aiModels.modelKey })
                              .from(siteResourceAiModels)
                              .innerJoin(
                                  aiModels,
                                  eq(siteResourceAiModels.modelId, aiModels.modelId)
                              )
                              .where(
                                  and(
                                      eq(
                                          siteResourceAiModels.siteResourceId,
                                          input.siteResourceId
                                      ),
                                      eq(aiModels.providerId, p.providerId)
                                  )
                              );

                if (modelRows.length > 0) {
                    entry.models = modelRows.map((m) => m.modelKey);
                }
            }

            return entry;
        })
    );

    const budgetRows = await db
        .select()
        .from(aiBudgets)
        .where(
            input.scope === "public"
                ? eq(aiBudgets.resourceId, input.resourceId)
                : eq(aiBudgets.siteResourceId, input.siteResourceId)
        );

    const aiBudgetConfig = budgetRows.map((b) => ({
        amount: b.amount,
        unit: b.unit,
        period: b.period,
        enforcement: b.enforcement,
        enabled: b.enabled
    }));

    return { aiProvidersConfig, aiBudgetConfig };
}

export async function generatePublicResourceBlueprintYaml(
    resourceId: number
): Promise<{ niceId: string; contents: string }> {
    const [resource] = await db
        .select()
        .from(resources)
        .where(eq(resources.resourceId, resourceId))
        .limit(1);

    if (!resource) {
        throw new Error(`Resource ${resourceId} not found`);
    }

    const mode = resource.mode;
    const isHttpLike = HTTP_LIKE_PUBLIC_MODES.includes(mode);
    const isInference = mode === "inference";

    const resourceConfig: Record<string, any> = {
        name: resource.name,
        mode,
        enabled: resource.enabled
    };

    if (isHttpLike) {
        if (resource.fullDomain) {
            resourceConfig["full-domain"] = resource.fullDomain;
        }
        resourceConfig.ssl = resource.ssl;
    } else {
        if (resource.proxyPort) {
            resourceConfig["proxy-port"] = resource.proxyPort;
        }
        if (mode === "tcp") {
            resourceConfig["proxy-protocol"] = resource.proxyProtocol;
            resourceConfig["proxy-protocol-version"] =
                resource.proxyProtocolVersion ?? undefined;
        }
    }

    if (resource.setHostHeader) {
        resourceConfig["host-header"] = resource.setHostHeader;
    }
    if (resource.tlsServerName) {
        resourceConfig["tls-server-name"] = resource.tlsServerName;
    }
    if (resource.requestHeaders) {
        try {
            resourceConfig.requestHeaders = JSON.parse(resource.requestHeaders);
        } catch {
            // ignore malformed stored headers
        }
    }
    if (resource.responseHeaders) {
        try {
            resourceConfig.responseHeaders = JSON.parse(resource.responseHeaders);
        } catch {
            // ignore malformed stored headers
        }
    }

    if (mode === "ssh") {
        resourceConfig["auth-daemon"] = stripUndefined({
            pam: resource.pamMode ?? undefined,
            mode: resource.authDaemonMode ?? undefined,
            port: resource.authDaemonPort ?? undefined
        });
    }

    if (resource.maintenanceModeEnabled) {
        resourceConfig.maintenance = stripUndefined({
            enabled: resource.maintenanceModeEnabled,
            type: resource.maintenanceModeType ?? undefined,
            title: resource.maintenanceTitle ?? undefined,
            message: resource.maintenanceMessage ?? undefined,
            "estimated-time": resource.maintenanceEstimatedTime ?? undefined
        });
    }

    // Labels
    const labelRows = await db
        .select({ name: labels.name })
        .from(resourceLabels)
        .innerJoin(labels, eq(resourceLabels.labelId, labels.labelId))
        .where(eq(resourceLabels.resourceId, resourceId));
    if (labelRows.length > 0) {
        resourceConfig.labels = labelRows.map((l) => l.name);
    }

    // Auth / rules / shared policy
    const { policy, auth, rules, notes } = await buildPublicAuthAndRules(
        resource
    );
    if (policy) {
        resourceConfig.policy = policy;
    }
    if (auth) {
        resourceConfig.auth = auth;
    }
    if (rules.length > 0) {
        resourceConfig.rules = rules;
    }

    // Targets (all modes except inference use targets)
    if (!isInference) {
        const targetRows = await db
            .select({
                ip: targets.ip,
                method: targets.method,
                port: targets.port,
                enabled: targets.enabled,
                internalPort: targets.internalPort,
                path: targets.path,
                pathMatchType: targets.pathMatchType,
                rewritePath: targets.rewritePath,
                rewritePathType: targets.rewritePathType,
                priority: targets.priority,
                siteNiceId: sites.niceId,
                hcEnabled: targetHealthCheck.hcEnabled,
                hcPath: targetHealthCheck.hcPath,
                hcScheme: targetHealthCheck.hcScheme,
                hcMode: targetHealthCheck.hcMode,
                hcHostname: targetHealthCheck.hcHostname,
                hcPort: targetHealthCheck.hcPort,
                hcInterval: targetHealthCheck.hcInterval,
                hcUnhealthyInterval: targetHealthCheck.hcUnhealthyInterval,
                hcTimeout: targetHealthCheck.hcTimeout,
                hcHeaders: targetHealthCheck.hcHeaders,
                hcFollowRedirects: targetHealthCheck.hcFollowRedirects,
                hcMethod: targetHealthCheck.hcMethod,
                hcStatus: targetHealthCheck.hcStatus,
                hcHealthyThreshold: targetHealthCheck.hcHealthyThreshold,
                hcUnhealthyThreshold: targetHealthCheck.hcUnhealthyThreshold
            })
            .from(targets)
            .leftJoin(sites, eq(sites.siteId, targets.siteId))
            .leftJoin(
                targetHealthCheck,
                eq(targetHealthCheck.targetId, targets.targetId)
            )
            .where(eq(targets.resourceId, resourceId))
            .orderBy(asc(targets.targetId));

        resourceConfig.targets = targetRows.map((row) =>
            stripUndefined({
                site: row.siteNiceId ?? undefined,
                method: mode === "http" ? row.method ?? undefined : undefined,
                hostname: row.ip,
                port: row.port,
                enabled: row.enabled,
                "internal-port": row.internalPort ?? undefined,
                path: row.path ?? undefined,
                "path-match": row.pathMatchType ?? undefined,
                "rewrite-path": row.rewritePath ?? undefined,
                "rewrite-match": row.rewritePathType ?? undefined,
                priority: row.priority,
                healthcheck: buildHealthcheck(row)
            })
        );
    } else {
        const { aiProvidersConfig, aiBudgetConfig } =
            await buildAiProvidersAndBudget({ scope: "public", resourceId });
        resourceConfig["ai-providers"] = aiProvidersConfig;
        if (aiBudgetConfig.length > 0) {
            resourceConfig["ai-budget"] = aiBudgetConfig;
        }
    }

    const config = {
        "proxy-resources": {
            [resource.niceId]: resourceConfig
        }
    };

    const notesPrefix =
        notes.length > 0
            ? notes.map((n) => `# ${n}`).join("\n") + "\n\n"
            : "";

    return {
        niceId: resource.niceId,
        contents: notesPrefix + stringifyYaml(config)
    };
}

export async function generatePrivateResourceBlueprintYaml(
    siteResourceId: number
): Promise<{ niceId: string; contents: string }> {
    const [siteResource] = await db
        .select()
        .from(siteResources)
        .where(eq(siteResources.siteResourceId, siteResourceId))
        .limit(1);

    if (!siteResource) {
        throw new Error(`Site resource ${siteResourceId} not found`);
    }

    const mode = siteResource.mode;
    const isInference = mode === "inference";
    const isHttpLike = mode === "http" || isInference;

    const resourceConfig: Record<string, any> = {
        name: siteResource.name,
        mode,
        enabled: siteResource.enabled
    };

    if (!isInference && siteResource.networkId) {
        const siteRows = await db
            .select({ niceId: sites.niceId })
            .from(siteNetworks)
            .innerJoin(sites, eq(siteNetworks.siteId, sites.siteId))
            .where(eq(siteNetworks.networkId, siteResource.networkId));
        if (siteRows.length > 0) {
            resourceConfig.sites = siteRows.map((s) => s.niceId);
        }
    }

    if (siteResource.destination) {
        resourceConfig.destination = siteResource.destination;
    }
    if (siteResource.destinationPort) {
        resourceConfig["destination-port"] = siteResource.destinationPort;
    }

    if (!isHttpLike) {
        resourceConfig["tcp-ports"] = siteResource.tcpPortRangeString;
        resourceConfig["udp-ports"] = siteResource.udpPortRangeString;
        resourceConfig["disable-icmp"] = siteResource.disableIcmp;
    }

    if (isHttpLike) {
        if (siteResource.fullDomain) {
            resourceConfig["full-domain"] = siteResource.fullDomain;
        }
        resourceConfig.ssl = siteResource.ssl;
        if (siteResource.scheme) {
            resourceConfig.scheme = siteResource.scheme;
        }
    }

    if (siteResource.alias) {
        resourceConfig.alias = siteResource.alias;
    }

    if (mode === "ssh") {
        resourceConfig["auth-daemon"] = stripUndefined({
            pam: siteResource.pamMode ?? undefined,
            mode: siteResource.authDaemonMode ?? undefined,
            port: siteResource.authDaemonPort ?? undefined
        });
    }

    const [roleRows, userRows, clientRows, labelRows] = await Promise.all([
        db
            .select({ name: roles.name })
            .from(roleSiteResources)
            .innerJoin(
                roles,
                and(
                    eq(roleSiteResources.roleId, roles.roleId),
                    or(isNull(roles.isAdmin), not(roles.isAdmin))
                )
            )
            .where(eq(roleSiteResources.siteResourceId, siteResourceId)),
        db
            .select({ username: users.username })
            .from(userSiteResources)
            .innerJoin(users, eq(userSiteResources.userId, users.userId))
            .where(eq(userSiteResources.siteResourceId, siteResourceId)),
        db
            .select({ niceId: clients.niceId })
            .from(clientSiteResources)
            .innerJoin(clients, eq(clientSiteResources.clientId, clients.clientId))
            .where(eq(clientSiteResources.siteResourceId, siteResourceId)),
        db
            .select({ name: labels.name })
            .from(siteResourceLabels)
            .innerJoin(labels, eq(siteResourceLabels.labelId, labels.labelId))
            .where(eq(siteResourceLabels.siteResourceId, siteResourceId))
    ]);

    if (roleRows.length > 0) {
        resourceConfig.roles = roleRows.map((r) => r.name);
    }
    if (userRows.length > 0) {
        resourceConfig.users = userRows.map((u) => u.username);
    }
    if (clientRows.length > 0) {
        resourceConfig.machines = clientRows.map((c) => c.niceId);
    }
    if (labelRows.length > 0) {
        resourceConfig.labels = labelRows.map((l) => l.name);
    }

    if (isInference) {
        const { aiProvidersConfig, aiBudgetConfig } =
            await buildAiProvidersAndBudget({ scope: "site", siteResourceId });
        resourceConfig["ai-providers"] = aiProvidersConfig;
        if (aiBudgetConfig.length > 0) {
            resourceConfig["ai-budget"] = aiBudgetConfig;
        }
    }

    const config = {
        "client-resources": {
            [siteResource.niceId]: resourceConfig
        }
    };

    return {
        niceId: siteResource.niceId,
        contents: stringifyYaml(config)
    };
}
