import config from "@server/lib/config";

export type SiteResourceAliasRow = {
    siteResourceId: number;
    fullDomain: string | null;
};

/**
 * Add placeholder Traefik routes for siteResource HTTP aliases so Traefik
 * generates TLS certificates for those domains even before a matching
 * resource exists. Requests that land on these routes before a real
 * resource is created are served the placeholder page. TLS/cert-resolver
 * handling differs between the OSS and private (pangolin-dns aware) config
 * generators, so callers resolve that themselves via resolveTls - returning
 * null skips the alias (no valid cert available yet).
 */
export function buildSiteResourceAliasCertPlaceholders(params: {
    config_output: any;
    siteResourcesWithFullDomain: SiteResourceAliasRow[];
    existingFullDomains: Set<string>;
    maintenancePageUiUrl: string | null;
    redirectHttpsMiddlewareName: string;
    resolveTls: (fullDomain: string) => any | null;
}): void {
    const {
        config_output,
        siteResourcesWithFullDomain,
        existingFullDomains,
        maintenancePageUiUrl,
        redirectHttpsMiddlewareName,
        resolveTls
    } = params;

    if (siteResourcesWithFullDomain.length === 0 || !maintenancePageUiUrl) {
        return;
    }

    for (const sr of siteResourcesWithFullDomain) {
        if (!sr.fullDomain) continue;

        // Skip if this alias is already handled by a resource router
        if (existingFullDomains.has(sr.fullDomain)) continue;

        const fullDomain = sr.fullDomain;
        const srKey = `site-resource-cert-${sr.siteResourceId}`;
        const siteResourceServiceName = `${srKey}-service`;
        const siteResourceRouterName = `${srKey}-router`;
        const siteResourceRewriteMiddlewareName = `${srKey}-rewrite`;

        if (!config_output.http.routers) {
            config_output.http.routers = {};
        }
        if (!config_output.http.services) {
            config_output.http.services = {};
        }
        if (!config_output.http.middlewares) {
            config_output.http.middlewares = {};
        }

        // Service pointing at the internal maintenance/Next.js page
        config_output.http.services[siteResourceServiceName] = {
            loadBalancer: {
                servers: [
                    {
                        url: maintenancePageUiUrl
                    }
                ],
                passHostHeader: true
            }
        };

        // Middleware that rewrites any path to /private-maintenance-screen
        config_output.http.middlewares[siteResourceRewriteMiddlewareName] = {
            replacePathRegex: {
                regex: "^/(.*)",
                replacement: "/private-maintenance-screen"
            }
        };

        // HTTP -> HTTPS redirect so the ACME challenge can be served
        config_output.http.routers[`${siteResourceRouterName}-redirect`] = {
            entryPoints: [config.getRawConfig().traefik.http_entrypoint],
            middlewares: [redirectHttpsMiddlewareName],
            service: siteResourceServiceName,
            rule: `Host(\`${fullDomain}\`)`,
            priority: 100
        };

        // Determine TLS / cert-resolver configuration
        const tls = resolveTls(fullDomain);
        if (tls === null) {
            continue;
        }

        // HTTPS router - presence of this entry triggers cert generation
        config_output.http.routers[siteResourceRouterName] = {
            entryPoints: [config.getRawConfig().traefik.https_entrypoint],
            service: siteResourceServiceName,
            middlewares: [siteResourceRewriteMiddlewareName],
            rule: `Host(\`${fullDomain}\`)`,
            priority: 100,
            tls
        };

        // Assets bypass router - lets Next.js static files load without rewrite
        config_output.http.routers[`${siteResourceRouterName}-assets`] = {
            entryPoints: [config.getRawConfig().traefik.https_entrypoint],
            service: siteResourceServiceName,
            rule: `Host(\`${fullDomain}\`) && (PathPrefix(\`/_next\`) || PathRegexp(\`^/__nextjs*\`) || Path(\`/favicon.ico\`))`,
            priority: 101,
            tls
        };
    }
}
