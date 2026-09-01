import config from "@server/lib/config";
import { sanitize } from "./utils";

export type BrowserGatewayResourceRow = {
    resourceId: number;
    resourceName: string | null;
    mode: string;
    fullDomain: string | null;
    ssl: boolean | null;
    subdomain: string | null;
    domainId: string | null;
    enabled: boolean | null;
    wildcard: boolean | null;
    domainCertResolver: string | null;
    preferWildcardCert: boolean | null;
    maintenanceModeEnabled: boolean | null;
    maintenanceModeType: string | null;
    maintenanceTitle: string | null;
    maintenanceMessage: string | null;
    maintenanceEstimatedTime: string | null;
    targetId: number;
    siteId: number;
    siteType: string;
    siteOnline: boolean | null;
    subnet: string | null;
    // Cloud-only namespace field - absent on OSS rows, so the namespace
    // filter below naturally no-ops there.
    domainNamespaceId?: unknown;
};

export type BrowserGatewayResourceEntry = {
    resourceId: number;
    name: string;
    fullDomain: string | null;
    ssl: boolean | null;
    subdomain: string | null;
    domainId: string | null;
    enabled: boolean | null;
    wildcard: boolean | null;
    domainCertResolver: string | null;
    preferWildcardCert: boolean | null;
    maintenanceModeEnabled: boolean | null;
    maintenanceModeType: string | null;
    maintenanceTitle: string | null;
    maintenanceMessage: string | null;
    maintenanceEstimatedTime: string | null;
    targets: {
        targetId: number;
        bgType: string;
        siteId: number;
        siteType: string;
        siteOnline: boolean | null;
        subnet: string | null;
    }[];
};

/**
 * Group the raw resource/target/site rows into per-resource browser-gateway
 * entries (SSH/VNC/RDP-mode resources served through the browser gateway
 * web UI instead of a real backend target).
 */
export function buildBrowserGatewayResourcesMap(
    rows: BrowserGatewayResourceRow[],
    filterOutNamespaceDomains: boolean
): Map<number, BrowserGatewayResourceEntry> {
    const map = new Map<number, BrowserGatewayResourceEntry>();

    for (const row of rows) {
        if (!["ssh", "vnc", "rdp"].includes(row.mode)) {
            continue;
        }
        if (filterOutNamespaceDomains && row.domainNamespaceId) {
            continue;
        }
        if (!map.has(row.resourceId)) {
            map.set(row.resourceId, {
                resourceId: row.resourceId,
                name: sanitize(row.resourceName ?? undefined) || "",
                fullDomain: row.fullDomain,
                ssl: row.ssl,
                subdomain: row.subdomain,
                domainId: row.domainId,
                enabled: row.enabled,
                wildcard: row.wildcard,
                domainCertResolver: row.domainCertResolver,
                preferWildcardCert: row.preferWildcardCert,
                maintenanceModeEnabled: row.maintenanceModeEnabled,
                maintenanceModeType: row.maintenanceModeType,
                maintenanceTitle: row.maintenanceTitle,
                maintenanceMessage: row.maintenanceMessage,
                maintenanceEstimatedTime: row.maintenanceEstimatedTime,
                targets: []
            });
        }
        map.get(row.resourceId)!.targets.push({
            targetId: row.targetId,
            bgType: row.mode,
            siteId: row.siteId,
            siteType: row.siteType,
            siteOnline: row.siteOnline,
            subnet: row.subnet
        });
    }

    return map;
}

/**
 * Build the Traefik routers/services for browser-gateway resources
 * (SSH/VNC/RDP served via a browser-based client instead of a raw target),
 * mutating config_output. TLS/cert-resolver handling differs between the
 * OSS (always resolve directly) and private (pangolin-dns aware) config
 * generators, so callers resolve that themselves via resolveTls - returning
 * null skips the resource (no valid cert available yet).
 */
export function buildBrowserGatewayConfig(params: {
    config_output: any;
    browserGatewayResourcesMap: Map<number, BrowserGatewayResourceEntry>;
    browserGatewayUiUrl: string;
    maintenancePageUiUrl: string | null;
    badgerMiddlewareName: string;
    redirectHttpsMiddlewareName: string;
    resolveTls: (args: {
        fullDomain: string;
        hasSubdomain: boolean;
        domainCertResolver: string | null;
        preferWildcardCert: boolean | null;
    }) => any | null;
}): void {
    const {
        config_output,
        browserGatewayResourcesMap,
        browserGatewayUiUrl,
        maintenancePageUiUrl,
        badgerMiddlewareName,
        redirectHttpsMiddlewareName,
        resolveTls
    } = params;

    const bgRateLimitMiddlewareName = "bg-ratelimit";
    if (!config_output.http.middlewares) {
        config_output.http.middlewares = {};
    }
    if (!config_output.http.middlewares[bgRateLimitMiddlewareName]) {
        const traefikRateLimit = config.getRawConfig().traefik.rate_limit;
        config_output.http.middlewares[bgRateLimitMiddlewareName] = {
            rateLimit: {
                average: traefikRateLimit.average,
                burst: traefikRateLimit.burst
            }
        };
    }

    const browserGatewayPort = 39999;

    for (const [, bgResource] of browserGatewayResourcesMap.entries()) {
        if (!bgResource.enabled) continue;
        if (!bgResource.domainId) continue;
        if (!bgResource.fullDomain) continue;

        if (!config_output.http.routers) config_output.http.routers = {};
        if (!config_output.http.services) config_output.http.services = {};

        const fullDomain = bgResource.fullDomain;
        const additionalMiddlewares =
            config.getRawConfig().traefik.additional_middlewares || [];
        const routerMiddlewares = [
            badgerMiddlewareName,
            bgRateLimitMiddlewareName,
            ...additionalMiddlewares
        ];

        const hostRule = `Host(\`${fullDomain}\`)`;

        // Build TLS config
        const tls = resolveTls({
            fullDomain,
            hasSubdomain: !!bgResource.subdomain,
            domainCertResolver: bgResource.domainCertResolver,
            preferWildcardCert: bgResource.preferWildcardCert
        });
        if (tls === null) {
            continue;
        }

        const bgUiServiceName = `bg-r${bgResource.resourceId}-ui-service`;

        if (bgResource.ssl) {
            const redirectRouterName = `bg-r${bgResource.resourceId}-redirect`;
            config_output.http.routers![redirectRouterName] = {
                entryPoints: [config.getRawConfig().traefik.http_entrypoint],
                middlewares: [redirectHttpsMiddlewareName],
                service: bgUiServiceName,
                rule: hostRule,
                priority: 100
            };
        }

        // Collect online sites for this resource (for any type)
        const anySiteOnline = bgResource.targets.some((t) => t.siteOnline);

        // Maintenance page logic for browser gateway resources
        let showBgMaintenancePage = false;
        if (bgResource.maintenanceModeEnabled) {
            if (bgResource.maintenanceModeType === "forced") {
                showBgMaintenancePage = true;
            } else if (bgResource.maintenanceModeType === "automatic") {
                showBgMaintenancePage = !anySiteOnline;
            }
        }

        if (showBgMaintenancePage && maintenancePageUiUrl) {
            const bgMaintenanceServiceName = `bg-r${bgResource.resourceId}-maintenance-service`;
            const bgMaintenanceRouterName = `bg-r${bgResource.resourceId}-maintenance-router`;
            const bgRewriteMiddlewareName = `bg-r${bgResource.resourceId}-maintenance-rewrite`;
            const bgMaintenanceHeadersMiddlewareName = `bg-r${bgResource.resourceId}-maintenance-headers`;

            const entrypointHttp =
                config.getRawConfig().traefik.http_entrypoint;
            const entrypointHttps =
                config.getRawConfig().traefik.https_entrypoint;

            if (!config_output.http.services) config_output.http.services = {};
            if (!config_output.http.middlewares)
                config_output.http.middlewares = {};
            if (!config_output.http.routers) config_output.http.routers = {};

            config_output.http.services![bgMaintenanceServiceName] = {
                loadBalancer: {
                    servers: [
                        {
                            url: maintenancePageUiUrl
                        }
                    ],
                    passHostHeader: true
                }
            };

            config_output.http.middlewares![bgRewriteMiddlewareName] = {
                replacePathRegex: {
                    regex: "^/(.*)",
                    replacement: "/maintenance-screen"
                }
            };

            config_output.http.middlewares![
                bgMaintenanceHeadersMiddlewareName
            ] = {
                headers: {
                    customRequestHeaders: {
                        Host: "app.pangolin.net", // if we are sending to the cloud the host needs to be this but we will pull the p-host to find the resource
                        "p-host": fullDomain
                    }
                }
            };

            config_output.http.routers![bgMaintenanceRouterName] = {
                entryPoints: [
                    bgResource.ssl ? entrypointHttps : entrypointHttp
                ],
                service: bgMaintenanceServiceName,
                middlewares: [
                    bgRewriteMiddlewareName,
                    bgMaintenanceHeadersMiddlewareName
                ],
                rule: hostRule,
                priority: 2000,
                ...(bgResource.ssl ? { tls } : {})
            };

            // Router to allow Next.js assets to load without rewrite
            config_output.http.routers![`${bgMaintenanceRouterName}-assets`] = {
                entryPoints: [
                    bgResource.ssl ? entrypointHttps : entrypointHttp
                ],
                service: bgMaintenanceServiceName,
                middlewares: [bgMaintenanceHeadersMiddlewareName],
                rule: `${hostRule} && (PathPrefix(\`/_next\`) || PathRegexp(\`^/__nextjs*\`) || Path(\`/favicon.ico\`))`,
                priority: 2001,
                ...(bgResource.ssl ? { tls } : {})
            };

            continue;
        }

        // Group targets by type and generate per-type websocket routers and services
        const typeMap = new Map<string, typeof bgResource.targets>();
        for (const t of bgResource.targets) {
            if (!typeMap.has(t.bgType)) typeMap.set(t.bgType, []);
            typeMap.get(t.bgType)!.push(t);
        }

        for (const [bgType, typedTargets] of typeMap.entries()) {
            const bgKey = `bg-r${bgResource.resourceId}-${bgType}`;
            const bgRouterName = `${bgKey}-router`;
            const bgServiceName = `${bgKey}-service`;
            const bgRule = `${hostRule} && PathPrefix(\`/gateway/${bgType}\`)`;

            const servers = typedTargets
                .filter((t) => {
                    if (!t.siteOnline && anySiteOnline) return false;
                    if (t.siteType === "newt") return !!t.subnet;
                    return false; // browser gateway only supported on newt sites
                })
                .map((t) => ({
                    url: `http://${t.subnet!.split("/")[0]}:${browserGatewayPort}`
                }))
                .filter((v, i, a) => a.findIndex((u) => u.url === v.url) === i);

            config_output.http.routers![bgRouterName] = {
                entryPoints: [
                    bgResource.ssl
                        ? config.getRawConfig().traefik.https_entrypoint
                        : config.getRawConfig().traefik.http_entrypoint
                ],
                middlewares: routerMiddlewares,
                service: bgServiceName,
                rule: bgRule,
                priority: 110, // highest - websocket path takes precedence
                ...(bgResource.ssl ? { tls } : {})
            };

            config_output.http.services![bgServiceName] = {
                loadBalancer: {
                    servers
                }
            };
        }

        // UI: serve the browser gateway page from the internal pangolin instance.
        // The primary type is used for the path rewrite (e.g. /rdp), mirroring
        // how the maintenance page rewrites everything to /maintenance-screen.
        const primaryType = typeMap.keys().next().value as string;
        const uiRewriteMiddlewareName = `bg-r${bgResource.resourceId}-ui-rewrite`;
        const uiHeadersMiddlewareName = `bg-r${bgResource.resourceId}-ui-headers`;
        const entrypoint = bgResource.ssl
            ? config.getRawConfig().traefik.https_entrypoint
            : config.getRawConfig().traefik.http_entrypoint;

        if (!config_output.http.middlewares) {
            config_output.http.middlewares = {};
        }

        config_output.http.middlewares![uiRewriteMiddlewareName] = {
            replacePathRegex: {
                regex: "^/(.*)",
                replacement: `/${primaryType}`
            }
        };

        config_output.http.middlewares![uiHeadersMiddlewareName] = {
            headers: {
                customRequestHeaders: {
                    Host: "app.pangolin.net", // if we are sending to the cloud the host needs to be this but we will pull the p-host to find the resource
                    "p-host": fullDomain
                }
            }
        };

        config_output.http.services![bgUiServiceName] = {
            loadBalancer: {
                servers: [
                    {
                        url: browserGatewayUiUrl
                    }
                ]
            }
        };

        // Assets router at higher priority so /_next files load without rewrite.
        // Do NOT apply the path-rewrite middleware here — static assets must
        // keep their original path; only the host headers are needed.
        config_output.http.routers![
            `bg-r${bgResource.resourceId}-assets-router`
        ] = {
            entryPoints: [entrypoint],
            middlewares: [...routerMiddlewares, uiHeadersMiddlewareName],
            service: bgUiServiceName,
            rule: `${hostRule} && (PathPrefix(\`/_next\`) || PathRegexp(\`^/__nextjs*\`) || Path(\`/favicon.ico\`))`,
            priority: 101,
            ...(bgResource.ssl ? { tls } : {})
        };

        // Catch-all router rewrites everything on the domain to /{primaryType}
        config_output.http.routers![`bg-r${bgResource.resourceId}-ui-router`] =
            {
                entryPoints: [entrypoint],
                middlewares: [
                    ...routerMiddlewares,
                    uiRewriteMiddlewareName,
                    uiHeadersMiddlewareName
                ],
                service: bgUiServiceName,
                rule: hostRule,
                priority: 100,
                ...(bgResource.ssl ? { tls } : {})
            };
    }
}
