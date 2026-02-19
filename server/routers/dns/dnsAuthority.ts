import { sendToClient } from "#dynamic/routers/ws";
import { db } from "@server/db";
import { sites, resources, targets, targetHealthCheck, newts, domains } from "@server/db";
import logger from "@server/logger";
import { eq, and, inArray } from "drizzle-orm";

// DNSAuthorityTarget represents a target IP with health status
interface DNSAuthorityTarget {
    ip: string;
    priority: number;
    healthy: boolean;
    siteId: number;
    siteName: string;
    backendLatencyMs?: number;
}

// DNSAuthorityConfig holds configuration for a DNS authority zone
interface DNSAuthorityConfig {
    enabled: boolean;
    domain: string;
    ttl: number;
    routingPolicy: string;
    stickySession?: boolean;
    servingSiteId?: number;
    targets: DNSAuthorityTarget[];
}

function withServingSiteId(
    config: DNSAuthorityConfig,
    siteId: number
): DNSAuthorityConfig {
    return {
        ...config,
        servingSiteId: siteId
    };
}

export const healthDependentDNSRoutingPolicies = [
    "failover",
    "priority",
    "intelligent"
] as const;

export function isHealthDependentDNSRoutingPolicy(policy: string): boolean {
    return (healthDependentDNSRoutingPolicies as readonly string[]).includes(
        policy
    );
}

export function normalizeDNSRoutingPolicyForHealthChecks(
    policy: string,
    hasHealthChecks: boolean
): string {
    if (!hasHealthChecks && isHealthDependentDNSRoutingPolicy(policy)) {
        return "roundrobin";
    }

    return policy;
}

export async function resourceHasEnabledHealthChecks(
    resourceId: number
): Promise<boolean> {
    const [row] = await db
        .select({ targetId: targets.targetId })
        .from(targets)
        .innerJoin(
            targetHealthCheck,
            eq(targets.targetId, targetHealthCheck.targetId)
        )
        .where(
            and(
                eq(targets.resourceId, resourceId),
                eq(targetHealthCheck.hcEnabled, true)
            )
        )
        .limit(1);

    return !!row;
}

// DNSAuthorityConfigMessage represents the message to send to Newt
interface DNSAuthorityConfigMessage {
    action: "update" | "remove" | "start" | "stop";
    zones: DNSAuthorityConfig[];
}

/**
 * Build DNS authority configuration for a resource based on its targets
 */
export async function buildDNSAuthorityConfig(
    resourceId: number
): Promise<DNSAuthorityConfig | null> {
    const [resource] = await db
        .select()
        .from(resources)
        .where(eq(resources.resourceId, resourceId))
        .limit(1);

    if (!resource) {
        return null;
    }

    // Check if DNS authority is enabled for this resource
    if (!resource.dnsAuthorityEnabled) {
        return null;
    }

    // Get the domain for this resource
    const domain = resource.fullDomain;
    if (!domain) {
        logger.warn(
            `Resource ${resourceId} has DNS authority enabled but no domain configured`
        );
        return null;
    }

    // Get all targets for this resource with their health check status
    const resourceTargets = await db
        .select({
            targetId: targets.targetId,
            siteId: targets.siteId,
            ip: targets.ip,
            port: targets.port,
            enabled: targets.enabled,
            priority: targets.priority,
            siteName: sites.name,
            sitePublicIp: sites.publicIp,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled,
            hcEnabled: targetHealthCheck.hcEnabled,
            hcHealth: targetHealthCheck.hcHealth,
            hcLatencyMs: targetHealthCheck.hcLatencyMs
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .leftJoin(
            targetHealthCheck,
            eq(targets.targetId, targetHealthCheck.targetId)
        )
        .where(eq(targets.resourceId, resourceId));

    // Filter to only enabled targets that have sites with DNS authority enabled and public IPs
    const validTargets = resourceTargets.filter(
        (t: typeof resourceTargets[number]) =>
            t.enabled &&
            t.sitePublicIp &&
            t.siteDnsAuthorityEnabled
    );

    if (validTargets.length === 0) {
        logger.debug(
            `Resource ${resourceId} has no valid DNS authority targets (no sites with public IPs or DNS authority enabled)`
        );
        return null;
    }

    const dnsTargets: DNSAuthorityTarget[] = validTargets.map((t: typeof resourceTargets[number]) => ({
        ip: t.sitePublicIp!, // Public IP of the site, not the internal target IP
        priority: t.priority || 100,
        healthy: t.hcEnabled ? t.hcHealth === "healthy" : true, // If no health check, assume healthy
        siteId: t.siteId,
        siteName: t.siteName || `Site ${t.siteId}`,
        backendLatencyMs:
            t.hcEnabled && typeof t.hcLatencyMs === "number"
                ? t.hcLatencyMs
                : undefined
    }));

    const hasHealthChecks = validTargets.some((t) => t.hcEnabled);
    const requestedPolicy = resource.dnsAuthorityRoutingPolicy || "failover";
    const routingPolicy = normalizeDNSRoutingPolicyForHealthChecks(
        requestedPolicy,
        hasHealthChecks
    );

    if (routingPolicy !== requestedPolicy) {
        logger.debug(
            `Resource ${resourceId} requested DNS policy ${requestedPolicy} without health checks; using roundrobin`
        );
    }

    return {
        enabled: true,
        domain: domain,
        ttl: resource.dnsAuthorityTtl || 60,
        routingPolicy,
        stickySession: resource.stickySession || false,
        targets: dnsTargets
    };
}

/**
 * Get all NEWT IDs that should serve DNS authority for a resource
 */
export async function getDNSAuthoritySiteNewtIds(
    resourceId: number
): Promise<{ newtId: string; siteId: number }[]> {
    const resourceTargets = await db
        .select({
            siteId: targets.siteId,
            newtId: newts.newtId,
            sitePublicIp: sites.publicIp,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .innerJoin(newts, eq(sites.siteId, newts.siteId))
        .where(
            and(
                eq(targets.resourceId, resourceId),
                eq(targets.enabled, true)
            )
        );

    // Filter to sites with DNS authority enabled
    return resourceTargets
        .filter((t: typeof resourceTargets[number]) => t.sitePublicIp && t.siteDnsAuthorityEnabled)
        .map((t: typeof resourceTargets[number]) => ({
            newtId: t.newtId || "",
            siteId: t.siteId
        }))
        .filter((t: { newtId: string; siteId: number }) => t.newtId);
}

/**
 * Send DNS authority configuration update to a NEWT instance
 */
export async function sendDNSAuthorityConfigToNewt(
    newtId: string,
    config: DNSAuthorityConfigMessage
) {
    try {
        await sendToClient(newtId, {
            type: "newt/dns/authority/config",
            data: config
        });
        logger.debug(
            `Sent DNS authority config to NEWT ${newtId}: ${config.action} with ${config.zones.length} zones`
        );
    } catch (error) {
        logger.warn(`Error sending DNS authority config to NEWT ${newtId}:`, error);
    }
}

/**
 * Update DNS authority configuration for all affected NEWT instances
 * when a resource is updated.
 */
export async function updateDNSAuthorityForResource(resourceId: number) {
    const config = await buildDNSAuthorityConfig(resourceId);

    // Get all NEWT instances that should serve this resource
    const newtSites = await getDNSAuthoritySiteNewtIds(resourceId);

    for (const { newtId, siteId } of newtSites) {
        if (config) {
            await sendDNSAuthorityConfigToNewt(newtId, {
                action: "update",
                zones: [withServingSiteId(config, siteId)]
            });
        } else {
            // DNS authority disabled for this resource, remove the zone
            const [resource] = await db
                .select()
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);

            if (resource?.fullDomain) {
                await sendDNSAuthorityConfigToNewt(newtId, {
                    action: "remove",
                    zones: [{ domain: resource.fullDomain } as DNSAuthorityConfig]
                });
            }
        }
    }
}

/**
 * Update DNS authority health status when a target's health changes
 * This is called from handleHealthcheckStatusMessage
 */
export async function updateDNSAuthorityHealthForTarget(
    targetId: number,
    newHealthStatus: string
) {
    // Get the target and its resource
    const [targetInfo] = await db
        .select({
            resourceId: targets.resourceId,
            siteId: targets.siteId,
            fullDomain: resources.fullDomain,
            dnsAuthorityEnabled: resources.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .where(eq(targets.targetId, targetId))
        .limit(1);

    if (!targetInfo || !targetInfo.dnsAuthorityEnabled) {
        return;
    }

    // Rebuild and send updated config to all affected sites
    await updateDNSAuthorityForResource(targetInfo.resourceId);
}

/**
 * Handle health check updates for multiple targets
 * This is called from handleHealthcheckStatusMessage after target health statuses are updated
 */
export async function onHealthCheckUpdate(targetIds: number[]) {
    // Deduplicate by resource ID to avoid sending multiple updates for the same resource
    const resourceIds = new Set<number>();
    const domainIds = new Set<string>();

    for (const targetId of targetIds) {
        const [targetInfo] = await db
            .select({
                resourceId: targets.resourceId,
                dnsAuthorityEnabled: resources.dnsAuthorityEnabled,
                domainId: resources.domainId
            })
            .from(targets)
            .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
            .where(eq(targets.targetId, targetId))
            .limit(1);

        if (targetInfo?.dnsAuthorityEnabled) {
            resourceIds.add(targetInfo.resourceId);
        }

        // Always check domain-level zones regardless of per-resource setting
        if (targetInfo?.domainId) {
            domainIds.add(targetInfo.domainId);
        }
    }

    // Update per-resource DNS authority configs
    for (const resourceId of resourceIds) {
        await updateDNSAuthorityForResource(resourceId);
    }

    // Update domain-level wildcard DNS authority configs
    for (const domainId of domainIds) {
        // Only update wildcard domains
        const [domain] = await db
            .select()
            .from(domains)
            .where(and(eq(domains.domainId, domainId), eq(domains.type, "wildcard")))
            .limit(1);

        if (domain) {
            await updateDNSAuthorityForDomain(domainId);
        }
    }
}

// ============================================================================
// Domain-level DNS Authority
// ============================================================================
// When a site enables DNS Authority, ALL wildcard domains that have resources
// with targets on that site automatically get a wildcard zone pushed to every
// DNS Authority Newt. This provides domain-wide failover — if one site goes
// down, the Newt on the surviving site stops returning the dead IP.

/**
 * Build a domain-level wildcard DNS authority config.
 *
 * For a given wildcard domain (e.g. "docker.visnovsky.us"), this finds every
 * site that:
 *   1. Has dnsAuthorityEnabled = true
 *   2. Has a publicIp set
 *   3. Has at least one enabled target for a resource on this domain
 *
 * Returns a wildcard zone config ("*.docker.visnovsky.us") with those sites
 * as targets. Health is determined by aggregating target health per site —
 * a site is "healthy" if ANY of its targets for this domain are healthy.
 */
export async function buildDomainDNSAuthorityConfig(
    domainId: string
): Promise<DNSAuthorityConfig | null> {
    // Get the domain
    const [domain] = await db
        .select()
        .from(domains)
        .where(eq(domains.domainId, domainId))
        .limit(1);

    if (!domain || domain.type !== "wildcard") {
        return null;
    }

    // Find all resources on this domain
    const domainResources = await db
        .select({ resourceId: resources.resourceId })
        .from(resources)
        .where(eq(resources.domainId, domainId));

    if (domainResources.length === 0) {
        return null;
    }

    const resourceIds = domainResources.map((r) => r.resourceId);

    // Find all targets for these resources, joined with site info and health
    const allTargets = await db
        .select({
            targetId: targets.targetId,
            siteId: targets.siteId,
            enabled: targets.enabled,
            priority: targets.priority,
            siteName: sites.name,
            sitePublicIp: sites.publicIp,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled,
            hcEnabled: targetHealthCheck.hcEnabled,
            hcHealth: targetHealthCheck.hcHealth,
            hcLatencyMs: targetHealthCheck.hcLatencyMs
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .leftJoin(
            targetHealthCheck,
            eq(targets.targetId, targetHealthCheck.targetId)
        )
        .where(inArray(targets.resourceId, resourceIds));

    // Filter to enabled targets on DNS Authority sites with public IPs
    const validTargets = allTargets.filter(
        (t) => t.enabled && t.sitePublicIp && t.siteDnsAuthorityEnabled
    );

    if (validTargets.length === 0) {
        logger.debug(
            `Domain ${domain.baseDomain} has no valid DNS authority targets`
        );
        return null;
    }

    // Aggregate by site — a site is healthy if ANY of its targets are healthy
    const siteMap = new Map<
        number,
        {
            ip: string;
            name: string;
            healthy: boolean;
            minPriority: number;
            minLatencyMs?: number;
        }
    >();

    for (const t of validTargets) {
        const targetHealthy = t.hcEnabled ? t.hcHealth === "healthy" : true;
        const existing = siteMap.get(t.siteId);
        if (existing) {
            // Site is healthy if ANY target is healthy
            existing.healthy = existing.healthy || targetHealthy;
            existing.minPriority = Math.min(
                existing.minPriority,
                t.priority || 100
            );
            if (
                typeof t.hcLatencyMs === "number" &&
                Number.isFinite(t.hcLatencyMs)
            ) {
                existing.minLatencyMs =
                    typeof existing.minLatencyMs === "number"
                        ? Math.min(existing.minLatencyMs, t.hcLatencyMs)
                        : t.hcLatencyMs;
            }
        } else {
            siteMap.set(t.siteId, {
                ip: t.sitePublicIp!,
                name: t.siteName || `Site ${t.siteId}`,
                healthy: targetHealthy,
                minPriority: t.priority || 100,
                minLatencyMs:
                    typeof t.hcLatencyMs === "number" &&
                    Number.isFinite(t.hcLatencyMs)
                        ? t.hcLatencyMs
                        : undefined
            });
        }
    }

    const dnsTargets: DNSAuthorityTarget[] = Array.from(
        siteMap.entries()
    ).map(([siteId, info]) => ({
        ip: info.ip,
        priority: info.minPriority,
        healthy: info.healthy,
        siteId,
        siteName: info.name,
        backendLatencyMs: info.minLatencyMs
    }));

    return {
        enabled: true,
        domain: `*.${domain.baseDomain}`,
        ttl: 60,
        routingPolicy: "failover",
        targets: dnsTargets
    };
}

/**
 * Get all Newt IDs on DNS Authority-enabled sites for a given domain.
 * These are the Newts that should serve the wildcard zone.
 */
async function getDomainDNSAuthorityNewtIds(
    domainId: string
): Promise<{ newtId: string; siteId: number }[]> {
    const domainResources = await db
        .select({ resourceId: resources.resourceId })
        .from(resources)
        .where(eq(resources.domainId, domainId));

    if (domainResources.length === 0) return [];

    const resourceIds = domainResources.map((r) => r.resourceId);

    const newtRows = await db
        .select({
            newtId: newts.newtId,
            siteId: sites.siteId,
            sitePublicIp: sites.publicIp,
            siteDnsAuthorityEnabled: sites.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .innerJoin(newts, eq(sites.siteId, newts.siteId))
        .where(
            and(
                inArray(targets.resourceId, resourceIds),
                eq(targets.enabled, true)
            )
        );

    // Deduplicate and filter to DNS Authority sites
    const newtBySite = new Map<number, string>();
    for (const row of newtRows) {
        if (row.newtId && row.sitePublicIp && row.siteDnsAuthorityEnabled) {
            newtBySite.set(row.siteId, row.newtId);
        }
    }
    return Array.from(newtBySite.entries()).map(([siteId, newtId]) => ({
        siteId,
        newtId
    }));
}

/**
 * Push domain-level wildcard DNS authority config to all relevant Newts.
 */
export async function updateDNSAuthorityForDomain(domainId: string) {
    const config = await buildDomainDNSAuthorityConfig(domainId);
    const newtIds = await getDomainDNSAuthorityNewtIds(domainId);

    if (newtIds.length === 0) {
        logger.debug(`No DNS authority Newts for domain ${domainId}`);
        return;
    }

    for (const { newtId, siteId } of newtIds) {
        if (config) {
            await sendDNSAuthorityConfigToNewt(newtId, {
                action: "update",
                zones: [withServingSiteId(config, siteId)]
            });
        } else {
            // No valid config — remove the wildcard zone
            const [domain] = await db
                .select()
                .from(domains)
                .where(eq(domains.domainId, domainId))
                .limit(1);

            if (domain) {
                await sendDNSAuthorityConfigToNewt(newtId, {
                    action: "remove",
                    zones: [
                        {
                            domain: `*.${domain.baseDomain}`
                        } as DNSAuthorityConfig
                    ]
                });
            }
        }
    }
}

/**
 * When a site toggles DNS Authority, update wildcard zones for ALL domains
 * that have resources with targets on this site.
 */
export async function updateDNSAuthorityForSite(siteId: number) {
    // Find all unique domains that have resources with targets on this site
    const siteTargets = await db
        .select({
            domainId: resources.domainId
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .innerJoin(domains, eq(resources.domainId, domains.domainId))
        .where(
            and(eq(targets.siteId, siteId), eq(domains.type, "wildcard"))
        );

    const domainIds = new Set<string>();
    for (const t of siteTargets) {
        if (t.domainId) {
            domainIds.add(t.domainId);
        }
    }

    logger.info(
        `DNS Authority: Site ${siteId} toggled — updating ${domainIds.size} wildcard domain(s)`
    );

    for (const domainId of domainIds) {
        await updateDNSAuthorityForDomain(domainId);
    }

    // Also update any per-resource DNS authority configs
    const resourceTargets = await db
        .select({
            resourceId: targets.resourceId,
            dnsAuthorityEnabled: resources.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .where(eq(targets.siteId, siteId));

    for (const t of resourceTargets) {
        if (t.dnsAuthorityEnabled) {
            await updateDNSAuthorityForResource(t.resourceId);
        }
    }
}

/**
 * Push ALL DNS authority zone configs (domain-level + resource-level) to a
 * specific Newt. Called when a Newt connects/registers so it gets the full
 * picture immediately instead of waiting for a health check or resource edit.
 */
export async function sendAllDNSAuthorityConfigsToNewt(
    newtId: string,
    siteId: number
) {
    // Check if this site has DNS authority enabled
    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site?.dnsAuthorityEnabled || !site?.publicIp) {
        return;
    }

    const allZones: DNSAuthorityConfig[] = [];

    // 1. Domain-level wildcard zones
    const siteTargets = await db
        .select({
            domainId: resources.domainId
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .innerJoin(domains, eq(resources.domainId, domains.domainId))
        .where(
            and(eq(targets.siteId, siteId), eq(domains.type, "wildcard"))
        );

    const domainIds = new Set<string>();
    for (const t of siteTargets) {
        if (t.domainId) domainIds.add(t.domainId);
    }

    for (const domainId of domainIds) {
        const config = await buildDomainDNSAuthorityConfig(domainId);
        if (config) allZones.push(config);
    }

    // 2. Per-resource zones
    const resourceTargets = await db
        .select({
            resourceId: targets.resourceId,
            dnsAuthorityEnabled: resources.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .where(
            and(eq(targets.siteId, siteId), eq(targets.enabled, true))
        );

    for (const t of resourceTargets) {
        if (t.dnsAuthorityEnabled) {
            const config = await buildDNSAuthorityConfig(t.resourceId);
            if (config) allZones.push(config);
        }
    }

    if (allZones.length > 0) {
        await sendDNSAuthorityConfigToNewt(newtId, {
            action: "update",
            zones: allZones.map((zone) => withServingSiteId(zone, siteId))
        });
        logger.info(
            `DNS Authority: Sent ${allZones.length} zone(s) to Newt ${newtId} on connect`
        );
    }
}
