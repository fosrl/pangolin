import {
    db,
    targetHealthCheck,
    domains,
    aiProviders,
    resourceAiProviders,
    siteResources,
    siteNetworks,
    exitNodes
} from "@server/db";
import {
    and,
    eq,
    inArray,
    or,
    isNull,
    ne,
    isNotNull,
    desc,
    sql
} from "drizzle-orm";
import logger from "@server/logger";
import config from "@server/lib/config";
import { resources, sites, targets } from "@server/db";
import { applyPathRewriteMiddleware } from "./middleware";
import { sanitize, encodePath, validatePathRewriteConfig } from "./utils";
import regionalCache from "@server/lib/cache";
import { TargetWithSite } from "./types";
import { buildWildcardTls } from "./certResolver";
import { buildHostRule, appendPathMatch, computeRoutePriority } from "./rule";
import {
    buildHttpLoadBalancerServers,
    buildStickySessionCookie,
    buildTcpUdpLoadBalancerServers,
    buildStickySessionIp
} from "./loadBalancer";
import { buildCustomHeadersMiddleware } from "./headersMiddleware";
import {
    AI_GATEWAY_TRUST_MIDDLEWARE_RESOURCE,
    AI_GATEWAY_TRUST_MIDDLEWARE_SITE_RESOURCE,
    AI_GATEWAY_CLIENT_IP_MIDDLEWARE_NAME,
    getAiGatewayHost,
    buildAiGatewayTrustMiddlewares,
    buildAiGatewayClientIpMiddleware,
    buildAiGatewayHostHeaderMiddleware,
    buildAiGatewayRouterAndService
} from "./aiGatewayMiddlewares";
import {
    buildBrowserGatewayResourcesMap,
    buildBrowserGatewayConfig
} from "./browserGateway";
import { buildSiteResourceAliasCertPlaceholders } from "./siteResourceAlias";

const redirectHttpsMiddlewareName = "redirect-to-https";
const badgerMiddlewareName = "badger";

export async function getTraefikConfig(
    exitNodeId: number,
    siteTypes: string[],
    filterOutNamespaceDomains = false, // UNUSED BUT USED IN PRIVATE
    generateLoginPageRouters = false, // UNUSED BUT USED IN PRIVATE
    allowRawResources = true,
    maintenancePageUiUrl: string | null = null,
    browserGatewayUiUrl: string | null = null,
    aiGatewayUrl: string | null = null
): Promise<any> {
    // Get the exit node but cache it for 5 minutes to avoid hitting the DB too often
    const exitNodeCacheKey = `exitNode:${exitNodeId}`;
    let exitNode =
        await regionalCache.get<typeof exitNodes.$inferSelect>(
            exitNodeCacheKey
        );
    if (!exitNode) {
        [exitNode] = await db
            .select()
            .from(exitNodes)
            .where(eq(exitNodes.exitNodeId, exitNodeId))
            .limit(1);
        await regionalCache.set(exitNodeCacheKey, exitNode, 300);
    }

    // Get resources with their targets and sites in a single optimized query
    // Start from sites on this exit node, then join to targets and resources
    const resourcesWithTargetsAndSites = await db
        .select({
            // Resource fields
            resourceId: resources.resourceId,
            resourceName: resources.name,
            fullDomain: resources.fullDomain,
            ssl: resources.ssl,
            proxyPort: resources.proxyPort,
            subdomain: resources.subdomain,
            domainId: resources.domainId,
            enabled: resources.enabled,
            stickySession: resources.stickySession,
            tlsServerName: resources.tlsServerName,
            setHostHeader: resources.setHostHeader,
            enableProxy: resources.enableProxy,
            requestHeaders: resources.requestHeaders,
            responseHeaders: resources.responseHeaders,
            proxyProtocol: resources.proxyProtocol,
            proxyProtocolVersion: resources.proxyProtocolVersion,
            wildcard: resources.wildcard,
            mode: resources.mode,

            maintenanceModeEnabled: resources.maintenanceModeEnabled,
            maintenanceModeType: resources.maintenanceModeType,
            maintenanceTitle: resources.maintenanceTitle,
            maintenanceMessage: resources.maintenanceMessage,
            maintenanceEstimatedTime: resources.maintenanceEstimatedTime,

            // Target fields
            targetId: targets.targetId,
            targetEnabled: targets.enabled,
            ip: targets.ip,
            method: targets.method,
            port: targets.port,
            internalPort: targets.internalPort,
            hcHealth: targetHealthCheck.hcHealth,
            path: targets.path,
            pathMatchType: targets.pathMatchType,
            rewritePath: targets.rewritePath,
            rewritePathType: targets.rewritePathType,
            priority: targets.priority,

            // Site fields
            siteId: sites.siteId,
            siteType: sites.type,
            siteOnline: sites.online,
            subnet: sites.exitNodeSubnet,
            exitNodeId: sites.exitNodeId,
            // Domain cert resolver fields
            domainCertResolver: domains.certResolver,
            preferWildcardCert: domains.preferWildcardCert
        })
        .from(sites)
        .innerJoin(targets, eq(targets.siteId, sites.siteId))
        .innerJoin(resources, eq(resources.resourceId, targets.resourceId))
        .leftJoin(domains, eq(domains.domainId, resources.domainId))
        .leftJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .where(
            and(
                eq(targets.enabled, true),
                eq(resources.enabled, true),
                or(
                    eq(sites.exitNodeId, exitNodeId),
                    and(
                        isNull(sites.exitNodeId),
                        sql`(${siteTypes.includes("local") ? 1 : 0} = 1)`, // only allow local sites if "local" is in siteTypes
                        eq(sites.type, "local")
                    )
                ),
                inArray(sites.type, siteTypes),
                allowRawResources
                    ? inArray(resources.mode, [
                          "http",
                          "udp",
                          "tcp",
                          "vnc",
                          "ssh",
                          "rdp"
                      ]) // allow all three, plus browser-gateway modes
                    : inArray(resources.mode, ["http", "vnc", "ssh", "rdp"])
            )
        )
        .orderBy(desc(targets.priority), targets.targetId); // stable ordering

    // Group by resource and include targets with their unique site data
    const resourcesMap = new Map();

    resourcesWithTargetsAndSites.forEach((row) => {
        if (!["http", "tcp", "udp"].includes(row.mode)) {
            return;
        }
        const resourceId = row.resourceId;
        const resourceName = sanitize(row.resourceName) || "";
        const targetPath = encodePath(row.path); // Use encodePath to avoid collisions (e.g. "/a/b" vs "/a-b")
        const pathMatchType = row.pathMatchType || "";
        const rewritePath = row.rewritePath || "";
        const rewritePathType = row.rewritePathType || "";
        const priority = row.priority ?? 100;

        // Create a unique key combining resourceId, path config, and rewrite config
        const pathKey = [
            targetPath,
            pathMatchType,
            rewritePath,
            rewritePathType
        ]
            .filter(Boolean)
            .join("-");
        const mapKey = [resourceId, pathKey].filter(Boolean).join("-");
        const key = sanitize(mapKey);

        if (!resourcesMap.has(mapKey)) {
            const validation = validatePathRewriteConfig(
                row.path,
                row.pathMatchType,
                row.rewritePath,
                row.rewritePathType
            );

            if (!validation.isValid) {
                logger.error(
                    `Invalid path rewrite configuration for resource ${resourceId}: ${validation.error}`
                );
                return;
            }

            resourcesMap.set(mapKey, {
                resourceId: row.resourceId,
                name: resourceName,
                key: key,
                fullDomain: row.fullDomain,
                ssl: row.ssl,
                mode: row.mode,
                proxyPort: row.proxyPort,
                subdomain: row.subdomain,
                domainId: row.domainId,
                enabled: row.enabled,
                stickySession: row.stickySession,
                tlsServerName: row.tlsServerName,
                setHostHeader: row.setHostHeader,
                enableProxy: row.enableProxy,
                targets: [],
                requestHeaders: row.requestHeaders,
                responseHeaders: row.responseHeaders,
                proxyProtocol: row.proxyProtocol,
                proxyProtocolVersion: row.proxyProtocolVersion ?? 1,
                path: row.path, // the targets will all have the same path
                pathMatchType: row.pathMatchType, // the targets will all have the same pathMatchType
                rewritePath: row.rewritePath,
                rewritePathType: row.rewritePathType,
                priority: priority,
                // Store domain cert resolver fields
                domainCertResolver: row.domainCertResolver,
                preferWildcardCert: row.preferWildcardCert
            });
        }

        resourcesMap.get(mapKey).targets.push({
            resourceId: row.resourceId,
            targetId: row.targetId,
            ip: row.ip,
            method: row.method,
            port: row.port,
            internalPort: row.internalPort,
            enabled: row.targetEnabled,
            health: row.hcHealth,
            site: {
                siteId: row.siteId,
                type: row.siteType,
                subnet: row.subnet,
                exitNodeId: row.exitNodeId,
                online: row.siteOnline
            }
        });
    });

    // Group browser gateway targets by resource (SSH/VNC/RDP-mode resources
    // served through the browser gateway web UI instead of a real target).
    const browserGatewayResourcesMap = browserGatewayUiUrl
        ? buildBrowserGatewayResourcesMap(
              resourcesWithTargetsAndSites,
              filterOutNamespaceDomains
          )
        : new Map();

    // Query siteResources in HTTP mode with SSL enabled and aliases, so
    // Traefik generates TLS certificates for those domains even before a
    // matching resource exists.
    const siteResourcesWithFullDomain = await db
        .select({
            siteResourceId: siteResources.siteResourceId,
            fullDomain: siteResources.fullDomain
        })
        .from(siteResources)
        .innerJoin(
            siteNetworks,
            eq(siteResources.networkId, siteNetworks.networkId)
        )
        .innerJoin(sites, eq(siteNetworks.siteId, sites.siteId))
        .where(
            and(
                eq(siteResources.enabled, true),
                isNotNull(siteResources.fullDomain),
                eq(siteResources.mode, "http"), // important so we dont double get the inference siteResources below
                eq(siteResources.ssl, true),
                eq(sites.exitNodeId, exitNodeId),
                inArray(sites.type, siteTypes)
            )
        );

    // Inference-mode resources have no targets/sites (their "backend" is the
    // central AI gateway), so they can't be reached via the targets->sites
    // join above - query them separately and include them on every exit node.
    const inferenceResources = await db
        .selectDistinct({
            resourceId: resources.resourceId,
            resourceName: resources.name,
            fullDomain: resources.fullDomain,
            ssl: resources.ssl,
            subdomain: resources.subdomain,
            domainId: resources.domainId,
            enabled: resources.enabled,
            wildcard: resources.wildcard,
            domainCertResolver: domains.certResolver,
            preferWildcardCert: domains.preferWildcardCert
        })
        .from(resources)
        // .innerJoin(
        //     resourceAiProviders,
        //     eq(resources.resourceId, resourceAiProviders.resourceId)
        // )
        // .innerJoin(
        //     aiProviders,
        //     eq(resourceAiProviders.providerId, aiProviders.providerId)
        // )
        .leftJoin(domains, eq(domains.domainId, resources.domainId))
        .where(
            and(
                eq(resources.mode, "inference"),
                eq(resources.enabled, true)
                // eq(aiProviders.enabled, true)
            )
        );

    // make sure we have at least one resource
    if (
        resourcesMap.size === 0 &&
        inferenceResources.length === 0 &&
        browserGatewayResourcesMap.size === 0 &&
        siteResourcesWithFullDomain.length === 0
    ) {
        return {};
    }

    const config_output: any = {
        http: {
            middlewares: {
                [redirectHttpsMiddlewareName]: {
                    redirectScheme: {
                        scheme: "https"
                    }
                }
            }
        }
    };

    // get the key and the resource
    for (const [, resource] of resourcesMap.entries()) {
        const targets = resource.targets as TargetWithSite[];
        const key = resource.key;

        const routerName = `${key}-${resource.name}-router`;
        const serviceName = `${key}-${resource.name}-service`;
        const fullDomain = `${resource.fullDomain}`;
        const transportName = `${key}-transport`;
        const headersMiddlewareName = `${key}-headers-middleware`;

        if (!resource.enabled) {
            continue;
        }

        if (resource.mode === "http") {
            if (!resource.domainId || !resource.fullDomain) {
                continue;
            }

            // Initialize routers and services if they don't exist
            if (!config_output.http.routers) {
                config_output.http.routers = {};
            }
            if (!config_output.http.services) {
                config_output.http.services = {};
            }

            const tls = buildWildcardTls({
                fullDomain,
                hasSubdomain: !!resource.subdomain,
                domainCertResolver: resource.domainCertResolver,
                preferWildcardCert: resource.preferWildcardCert
            });

            const additionalMiddlewares =
                config.getRawConfig().traefik.additional_middlewares || [];

            const routerMiddlewares = [
                badgerMiddlewareName,
                ...additionalMiddlewares
            ];

            // Handle path rewriting middleware
            applyPathRewriteMiddleware(
                config_output,
                resource.resourceId,
                key,
                resource.path,
                resource.pathMatchType,
                resource.rewritePath,
                resource.rewritePathType,
                routerMiddlewares
            );

            // Handle custom headers middleware
            const customHeadersMiddleware = buildCustomHeadersMiddleware(
                resource.requestHeaders,
                resource.responseHeaders,
                resource.setHostHeader,
                resource.resourceId
            );
            if (customHeadersMiddleware) {
                if (!config_output.http.middlewares) {
                    config_output.http.middlewares = {};
                }
                config_output.http.middlewares[headersMiddlewareName] =
                    customHeadersMiddleware;
                routerMiddlewares.push(headersMiddlewareName);
            }

            // Build routing rules
            let rule = buildHostRule(fullDomain);
            const priority = computeRoutePriority(
                resource.priority,
                resource.path,
                resource.pathMatchType
            );
            rule = appendPathMatch(rule, resource.path, resource.pathMatchType);

            config_output.http.routers![routerName] = {
                entryPoints: [
                    resource.ssl
                        ? config.getRawConfig().traefik.https_entrypoint
                        : config.getRawConfig().traefik.http_entrypoint
                ],
                middlewares: routerMiddlewares,
                service: serviceName,
                rule: rule,
                priority: priority,
                ...(resource.ssl ? { tls } : {})
            };

            if (resource.ssl) {
                config_output.http.routers![routerName + "-redirect"] = {
                    entryPoints: [
                        config.getRawConfig().traefik.http_entrypoint
                    ],
                    middlewares: [redirectHttpsMiddlewareName],
                    service: serviceName,
                    rule: rule,
                    priority: priority
                };
            }

            config_output.http.services![serviceName] = {
                loadBalancer: {
                    servers: buildHttpLoadBalancerServers(targets),
                    ...(resource.stickySession
                        ? buildStickySessionCookie(resource.ssl)
                        : {})
                }
            };

            // Add the serversTransport if TLS server name is provided
            if (resource.tlsServerName) {
                if (!config_output.http.serversTransports) {
                    config_output.http.serversTransports = {};
                }
                config_output.http.serversTransports![transportName] = {
                    serverName: resource.tlsServerName,
                    //unfortunately the following needs to be set. traefik doesn't merge the default serverTransport settings
                    // if defined in the static config and here. if not set, self-signed certs won't work
                    insecureSkipVerify: true
                };
                config_output.http.services![
                    serviceName
                ].loadBalancer.serversTransport = transportName;
            }
        } else if (resource.mode === "tcp" || resource.mode === "udp") {
            // Non-HTTP (TCP/UDP) configuration
            if (!resource.enableProxy || !resource.proxyPort) {
                continue;
            }

            const protocol = resource.mode === "udp" ? "udp" : "tcp"; // all of the other ones are tcp
            const port = resource.proxyPort;

            if (!port) {
                continue;
            }

            if (!config_output[protocol]) {
                config_output[protocol] = {
                    routers: {},
                    services: {}
                };
            }

            config_output[protocol].routers[routerName] = {
                entryPoints: [`${protocol}-${port}`],
                service: serviceName,
                ...(protocol === "tcp" ? { rule: "HostSNI(`*`)" } : {})
            };

            const ppPrefix = config.getRawConfig().traefik.pp_transport_prefix;

            config_output[protocol].services[serviceName] = {
                loadBalancer: {
                    servers: buildTcpUdpLoadBalancerServers(targets),
                    ...(resource.proxyProtocol && protocol == "tcp"
                        ? {
                              serversTransport: `${ppPrefix}${resource.proxyProtocolVersion || 1}@file` // TODO: does @file here cause issues?
                          }
                        : {}),
                    ...(resource.stickySession ? buildStickySessionIp() : {})
                }
            };
        }
    }

    if (browserGatewayUiUrl) {
        buildBrowserGatewayConfig({
            config_output,
            browserGatewayResourcesMap,
            browserGatewayUiUrl,
            maintenancePageUiUrl,
            badgerMiddlewareName,
            redirectHttpsMiddlewareName,
            resolveTls: ({
                fullDomain,
                hasSubdomain,
                domainCertResolver,
                preferWildcardCert
            }) =>
                buildWildcardTls({
                    fullDomain,
                    hasSubdomain,
                    domainCertResolver,
                    preferWildcardCert
                })
        });
    }

    // Add Traefik routes for siteResource aliases (HTTP mode + SSL) so that
    // Traefik generates TLS certificates for those domains even when no
    // matching resource exists yet.
    if (siteResourcesWithFullDomain.length > 0) {
        // Build a set of domains already covered by normal resources
        const existingFullDomains = new Set<string>();
        for (const resource of resourcesMap.values()) {
            if (resource.fullDomain) {
                existingFullDomains.add(resource.fullDomain);
            }
        }

        buildSiteResourceAliasCertPlaceholders({
            config_output,
            siteResourcesWithFullDomain,
            existingFullDomains,
            maintenancePageUiUrl,
            redirectHttpsMiddlewareName,
            resolveTls: (fullDomain) =>
                buildWildcardTls({
                    fullDomain,
                    hasSubdomain: true
                })
        });
    }

    if (aiGatewayUrl) {
        // The AI gateway may live on a different host than the inference
        // resource itself (e.g. a remote exit node forwarding to the
        // central dashboard over a tunnel). passHostHeader would forward
        // the resource's own Host, which that external host won't
        // recognize, so we pin the Host header to the gateway's own host
        // and smuggle the original resource host through in "p-host"
        // instead.
        const aiGatewayHost = getAiGatewayHost(aiGatewayUrl);

        if (!config_output.http.middlewares) {
            config_output.http.middlewares = {};
        }
        Object.assign(
            config_output.http.middlewares,
            buildAiGatewayTrustMiddlewares()
        );

        const aiGatewayClientIpMiddleware = buildAiGatewayClientIpMiddleware();
        const enableAiGatewayClientIpHeader = !!aiGatewayClientIpMiddleware;
        if (aiGatewayClientIpMiddleware) {
            Object.assign(
                config_output.http.middlewares,
                aiGatewayClientIpMiddleware
            );
        }

        // Public inference resources: same TLS/cert-resolver handling as
        // plain http-mode resources, but the service points at the AI
        // gateway instead of any real backend targets.
        //
        // Inference-mode resources are allowed to share a fullDomain with
        // each other (see createResource.ts), and a siteResource inference
        // alias can share that domain too - all of them proxy to the same
        // aiGatewayUrl, so dedupe by fullDomain here (lowest resourceId
        // wins, for stable output across regenerations) and skip the
        // siteResource alias router for any domain already covered below.
        const eligibleInferenceResources = inferenceResources
            .filter((ir) => ir.enabled && ir.domainId && ir.fullDomain)
            .sort((a, b) => a.resourceId - b.resourceId);
        const dedupedInferenceResources = new Map<
            string,
            (typeof eligibleInferenceResources)[number]
        >();
        for (const ir of eligibleInferenceResources) {
            if (!dedupedInferenceResources.has(ir.fullDomain!)) {
                dedupedInferenceResources.set(ir.fullDomain!, ir);
            }
        }

        const publicInferenceDomains = new Set<string>();
        for (const ir of dedupedInferenceResources.values()) {
            if (!config_output.http.routers) config_output.http.routers = {};
            if (!config_output.http.services) config_output.http.services = {};

            const fullDomain = ir.fullDomain!;
            const irKey = `inference-r${ir.resourceId}`;
            const routerName = `${irKey}-router`;
            const serviceName = `${irKey}-service`;

            const rule = buildHostRule(fullDomain, ir.wildcard);

            const tls = buildWildcardTls({
                fullDomain,
                hasSubdomain: !!ir.subdomain,
                domainCertResolver: ir.domainCertResolver,
                preferWildcardCert: ir.preferWildcardCert
            });

            const irHeadersMiddlewareName = `${irKey}-headers-middleware`;
            config_output.http.middlewares[irHeadersMiddlewareName] =
                buildAiGatewayHostHeaderMiddleware(aiGatewayHost, fullDomain);

            const additionalMiddlewares =
                config.getRawConfig().traefik.additional_middlewares || [];
            const routerMiddlewares = [
                badgerMiddlewareName,
                AI_GATEWAY_TRUST_MIDDLEWARE_RESOURCE,
                irHeadersMiddlewareName,
                ...additionalMiddlewares
            ];

            const { routers, services } = buildAiGatewayRouterAndService({
                routerName,
                serviceName,
                rule,
                ssl: ir.ssl,
                tls,
                priority: 100,
                routerMiddlewares,
                aiGatewayUrl,
                redirectHttpsMiddlewareName
            });
            Object.assign(config_output.http.routers, routers);
            Object.assign(config_output.http.services, services);
            publicInferenceDomains.add(fullDomain);
        }

        // Private (siteResource) inference resources: routed by their alias
        // instead of a public fullDomain, and deliberately WITHOUT the
        // badger middleware - no per-user auth/policy stack exists for
        // siteResources today, so gating here is reachability-only for now.
        const siteResourcesInference = await db
            .selectDistinct({
                siteResourceId: siteResources.siteResourceId,
                fullDomain: siteResources.fullDomain,
                ssl: siteResources.ssl,
                enabled: siteResources.enabled
            })
            .from(siteResources)
            .where(
                and(
                    eq(siteResources.mode, "inference"),
                    eq(siteResources.enabled, true),
                    isNotNull(siteResources.fullDomain)
                )
            );

        if (exitNode) {
            for (const sr of siteResourcesInference) {
                if (!sr.enabled || !sr.fullDomain) continue;

                // A public inference resource already owns a router for
                // this exact fullDomain - both point at the same AI gateway,
                // so avoid registering a duplicate router for it here.
                if (publicInferenceDomains.has(sr.fullDomain)) continue;

                if (!config_output.http.routers)
                    config_output.http.routers = {};
                if (!config_output.http.services)
                    config_output.http.services = {};

                const fullDomain = sr.fullDomain;
                const srKey = `inference-sr${sr.siteResourceId}`;
                const routerName = `${srKey}-router`;
                const serviceName = `${srKey}-service`;
                const rule = `Host(\`${fullDomain}\`) && ClientIP(\`${exitNode.address}\`)`; // restrict to coming from the exit node ip range that the client is connected to

                // siteResource aliases don't have a per-domain cert resolver
                // stored, so always fall back to the global defaults.
                const tls = buildWildcardTls({
                    fullDomain,
                    hasSubdomain: true
                });

                const srHeadersMiddlewareName = `${srKey}-headers-middleware`;
                if (!config_output.http.middlewares) {
                    config_output.http.middlewares = {};
                }
                config_output.http.middlewares[srHeadersMiddlewareName] =
                    buildAiGatewayHostHeaderMiddleware(
                        aiGatewayHost,
                        fullDomain
                    );

                const additionalMiddlewares =
                    config.getRawConfig().traefik.additional_middlewares || [];
                const routerMiddlewares = [
                    ...(enableAiGatewayClientIpHeader
                        ? [AI_GATEWAY_CLIENT_IP_MIDDLEWARE_NAME]
                        : []),
                    AI_GATEWAY_TRUST_MIDDLEWARE_SITE_RESOURCE,
                    srHeadersMiddlewareName,
                    ...additionalMiddlewares
                ];

                const { routers, services } = buildAiGatewayRouterAndService({
                    routerName,
                    serviceName,
                    rule,
                    ssl: sr.ssl,
                    tls,
                    priority: 200, // we want to match on the site resource first because the clientIP rule is more specific than the public inference resource rule, which is just the exit node IP range. so we give it a higher priority to ensure it matches first.
                    routerMiddlewares,
                    aiGatewayUrl,
                    redirectHttpsMiddlewareName
                });
                Object.assign(config_output.http.routers, routers);
                Object.assign(config_output.http.services, services);
            }
        }
    }

    return config_output;
}
