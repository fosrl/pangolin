import { sendToClient } from "#dynamic/routers/ws";
import { db } from "@server/db";
import {
    sites,
    resources,
    targets,
    orgs,
    resourceWhitelist,
    newts
} from "@server/db";
import logger from "@server/logger";
import { eq, and, inArray } from "drizzle-orm";
import config from "@server/lib/config";
import { getJwtPublicKeyPem } from "@server/lib/jwtKeypair";
import { readCertificatePEMsForDomains } from "@server/lib/traefik/TraefikConfigManager";

// AuthConfig holds the global authentication configuration for a site
interface AuthConfig {
    enabled: boolean;
    pangolinUrl: string;
    jwtPublicKey: string;
    cookieName: string;
    cookieDomain: string;
    sessionValidationUrl: string;
}

// ResourceAuthConfig holds auth configuration for a specific resource
interface ResourceAuthConfig {
    resourceId: number;
    domain: string;
    sso: boolean;
    blockAccess: boolean;
    emailWhitelistEnabled: boolean;
    allowedEmails: string[];
    targetUrl: string;
    ssl: boolean;
}

// TLSCertificateConfig holds a TLS certificate to push to Newt
interface TLSCertificateConfig {
    domain: string;
    certPem: string;
    keyPem: string;
    expiresAt: number;
    wildcard: boolean;
}

// AuthProxyConfigMessage represents the message to send to Newt
interface AuthProxyConfigMessage {
    action: "update" | "remove" | "start" | "stop";
    auth: AuthConfig;
    resources: ResourceAuthConfig[];
    tlsCertificates?: TLSCertificateConfig[];
}

/**
 * Build auth proxy configuration for resources on a site
 */
export async function buildAuthProxyConfig(
    siteId: number
): Promise<AuthProxyConfigMessage | null> {
    // Get the site
    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site) {
        return null;
    }

    // Get the org for this site
    const [org] = await db
        .select()
        .from(orgs)
        .where(eq(orgs.orgId, site.orgId))
        .limit(1);

    if (!org) {
        return null;
    }

    // Get all resources that have targets on this site with SSO or access control enabled
    const siteTargets = await db
        .select({
            resourceId: targets.resourceId,
            siteId: targets.siteId,
            targetIp: targets.ip,
            targetPort: targets.port,
            targetMethod: targets.method,
            resourceName: resources.name,
            fullDomain: resources.fullDomain,
            sso: resources.sso,
            blockAccess: resources.blockAccess,
            emailWhitelistEnabled: resources.emailWhitelistEnabled,
            ssl: resources.ssl,
            http: resources.http,
            dnsAuthorityEnabled: resources.dnsAuthorityEnabled
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .where(
            and(
                eq(targets.siteId, siteId),
                eq(targets.enabled, true)
            )
        );

    // Get all DNS authority-enabled resources on this site.
    // We need ALL of them (not just SSO-protected ones) because:
    // - Protected resources need auth proxy + TLS termination
    // - Unprotected resources still need TLS termination for HTTPS to work
    const dnsAuthorityResources = siteTargets.filter(
        (t: typeof siteTargets[0]) => t.dnsAuthorityEnabled
    );

    if (dnsAuthorityResources.length === 0) {
        return null;
    }

    // Build the auth config
    const dashboardUrl = config.getRawConfig().app.dashboard_url;
    if (!dashboardUrl) {
        return null;
    }

    const resolvedDashboardUrl: string = dashboardUrl;

    const authConfig: AuthConfig = {
        enabled: true,
        pangolinUrl: resolvedDashboardUrl,
        jwtPublicKey: getJwtPublicKeyPem(),
        cookieName: "p_session",
        cookieDomain: extractBaseDomain(resolvedDashboardUrl),
        sessionValidationUrl: `${resolvedDashboardUrl}/api/v1/auth/session/validate`
    };

    // Build resource configs
    const resourceConfigs: ResourceAuthConfig[] = [];
    const allDomains: string[] = [];

    for (const target of dnsAuthorityResources) {
        if (!target.fullDomain) continue;

        allDomains.push(target.fullDomain);

        // Get email whitelist for this resource
        let allowedEmails: string[] = [];
        if (target.emailWhitelistEnabled) {
            const whitelist = await db
                .select()
                .from(resourceWhitelist)
                .where(eq(resourceWhitelist.resourceId, target.resourceId));

            allowedEmails = whitelist.map((w: typeof whitelist[0]) => w.email);
        }

        // Build target URL — use the target's method (http/https) for the backend
        // connection, NOT the resource's ssl flag (which controls public-facing TLS)
        const scheme = target.targetMethod || "http";
        const targetUrl = `${scheme}://${target.targetIp}:${target.targetPort}`;

        resourceConfigs.push({
            resourceId: target.resourceId,
            domain: target.fullDomain,
            sso: target.sso || false,
            blockAccess: target.blockAccess || false,
            emailWhitelistEnabled: target.emailWhitelistEnabled || false,
            allowedEmails,
            targetUrl,
            ssl: target.ssl || false
        });
    }

    // Read TLS certificates for all DNS authority domains from Traefik's cert store
    const certPEMs = readCertificatePEMsForDomains(allDomains);
    const tlsCertificates: TLSCertificateConfig[] = certPEMs.map((c) => ({
        domain: c.domain,
        certPem: c.certPem,
        keyPem: c.keyPem,
        expiresAt: c.expiresAt,
        wildcard: c.wildcard
    }));

    return {
        action: "update",
        auth: authConfig,
        resources: resourceConfigs,
        tlsCertificates: tlsCertificates.length > 0 ? tlsCertificates : undefined
    };
}

function buildEmptyAuthProxyConfigMessage(): AuthProxyConfigMessage {
    const dashboardUrl = config.getRawConfig().app.dashboard_url || "";

    return {
        action: "update",
        auth: {
            enabled: true,
            pangolinUrl: dashboardUrl,
            jwtPublicKey: getJwtPublicKeyPem(),
            cookieName: "p_session",
            cookieDomain: extractBaseDomain(dashboardUrl),
            sessionValidationUrl: `${dashboardUrl}/api/v1/auth/session/validate`
        },
        resources: []
    };
}

/**
 * Send auth proxy configuration to a Newt instance
 */
export async function sendAuthProxyConfigToNewt(
    newtId: string,
    config: AuthProxyConfigMessage
) {
    try {
        await sendToClient(newtId, {
            type: "newt/auth/proxy/config",
            data: config
        });
        logger.debug(`Sent auth proxy config to Newt ${newtId}`);
    } catch (error) {
        logger.error(`Failed to send auth proxy config to Newt ${newtId}:`, error);
    }
}

/**
 * Update auth proxy config for all Newts serving a resource
 */
export async function updateAuthProxyForResource(resourceId: number) {
    // Get all sites that have targets for this resource
    const resourceTargets = await db
        .select({
            siteId: targets.siteId,
            newtId: newts.newtId
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .innerJoin(newts, eq(sites.siteId, newts.siteId))
        .where(
            eq(targets.resourceId, resourceId)
        );

    // Deduplicate by site
    const siteIds = [...new Set(resourceTargets.map((t: typeof resourceTargets[0]) => t.siteId))];

    for (const siteId of siteIds) {
        const target = resourceTargets.find((t: typeof resourceTargets[0]) => t.siteId === siteId);
        if (!target?.newtId) {
            continue;
        }

        const config = await buildAuthProxyConfig(siteId as number);
        if (config) {
            await sendAuthProxyConfigToNewt(target.newtId, config);
        } else {
            await sendAuthProxyConfigToNewt(target.newtId, buildEmptyAuthProxyConfigMessage());
        }
    }
}

/**
 * Update auth proxy config for a site when its settings change
 */
export async function updateAuthProxyForSite(siteId: number) {
    const [site] = await db
        .select({
            newtId: newts.newtId
        })
        .from(sites)
        .innerJoin(newts, eq(sites.siteId, newts.siteId))
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site?.newtId) {
        return;
    }

    const config = await buildAuthProxyConfig(siteId);
    if (config) {
        await sendAuthProxyConfigToNewt(site.newtId, config);
    } else {
        await sendAuthProxyConfigToNewt(site.newtId, buildEmptyAuthProxyConfigMessage());
    }
}

/**
 * Send auth proxy configuration (including TLS certs) to a Newt on connect/register.
 * Called from handleNewtRegisterMessage to ensure Newt gets the full config immediately.
 */
export async function sendAllAuthProxyConfigsToNewt(
    newtId: string,
    siteId: number
) {
    const authConfig = await buildAuthProxyConfig(siteId);
    if (authConfig) {
        await sendAuthProxyConfigToNewt(newtId, authConfig);
        logger.info(
            `Auth Proxy: Sent config with ${authConfig.resources.length} resource(s) and ${authConfig.tlsCertificates?.length || 0} cert(s) to Newt ${newtId} on connect`
        );
    } else {
        // Send empty config so Newt knows to clear any stale state
        await sendAuthProxyConfigToNewt(newtId, buildEmptyAuthProxyConfigMessage());
    }
}

/**
 * Extract base domain from URL for cookie domain
 */
function extractBaseDomain(url: string): string {
    try {
        const parsed = new URL(url);
        const parts = parsed.hostname.split(".");
        // Return last two parts (e.g., example.com from sub.example.com)
        if (parts.length >= 2) {
            return "." + parts.slice(-2).join(".");
        }
        return parsed.hostname;
    } catch {
        return "";
    }
}
