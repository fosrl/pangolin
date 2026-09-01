/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import {
    certificates,
    db,
    domainNamespaces,
    domains,
    exitNodes,
    loginPage,
    SiteResource,
    targetHealthCheck
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
import {
    orgs,
    resources,
    sites,
    siteNetworks,
    siteResources,
    targets
} from "@server/db";
import {
    sanitize,
    encodePath,
    validatePathRewriteConfig
} from "@server/lib/traefik/utils";
import privateConfig from "#private/lib/config";
import { applyPathRewriteMiddleware } from "@server/lib/traefik/middleware";
import {
    CertificateResult,
    getValidCertificatesForDomains
} from "@server/lib/certificates";
import { build } from "@server/build";
import regionalCache from "#private/lib/cache";
import { TargetWithSite } from "@server/lib/traefik/types";
import { buildWildcardTls } from "@server/lib/traefik/certResolver";
import {
    buildHostRule,
    appendPathMatch,
    computeRoutePriority
} from "@server/lib/traefik/rule";
import {
    buildHttpLoadBalancerServers,
    buildStickySessionCookie,
    buildTcpUdpLoadBalancerServers,
    buildStickySessionIp
} from "@server/lib/traefik/loadBalancer";
import { buildCustomHeadersMiddleware } from "@server/lib/traefik/headersMiddleware";
import {
    AI_GATEWAY_TRUST_MIDDLEWARE_RESOURCE,
    AI_GATEWAY_TRUST_MIDDLEWARE_SITE_RESOURCE,
    AI_GATEWAY_CLIENT_IP_MIDDLEWARE_NAME,
    getAiGatewayHost,
    buildAiGatewayTrustMiddlewares,
    buildAiGatewayClientIpMiddleware,
    buildAiGatewayHostHeaderMiddleware,
    buildAiGatewayRouterAndService
} from "@server/lib/traefik/aiGatewayMiddlewares";
import {
    buildBrowserGatewayResourcesMap,
    buildBrowserGatewayConfig
} from "@server/lib/traefik/browserGateway";
import { buildSiteResourceAliasCertPlaceholders } from "@server/lib/traefik/siteResourceAlias";

const redirectHttpsMiddlewareName = "redirect-to-https";
const redirectToRootMiddlewareName = "redirect-to-root";
const badgerMiddlewareName = "badger";
const landingRateLimitMiddlewareName = "landing-ratelimit";

export async function getTraefikConfig(
    exitNodeId: number,
    siteTypes: string[],
    filterOutNamespaceDomains = false,
    generateLoginPageRouters = false,
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
            // Namespace
            domainNamespaceId: domainNamespaces.domainNamespaceId,
            // Certificate
            certificateStatus: certificates.status,
            domainCertResolver: domains.certResolver,
            preferWildcardCert: domains.preferWildcardCert
        })
        .from(sites)
        .innerJoin(targets, eq(targets.siteId, sites.siteId))
        .innerJoin(resources, eq(resources.resourceId, targets.resourceId))
        .leftJoin(certificates, eq(certificates.domainId, resources.domainId))
        .leftJoin(domains, eq(domains.domainId, resources.domainId))
        .leftJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .leftJoin(
            domainNamespaces,
            eq(domainNamespaces.domainId, resources.domainId)
        ) // THIS IS CLOUD ONLY TO FILTER OUT THE DOMAIN NAMESPACES IF REQUIRED
        .where(
            and(
                eq(targets.enabled, true),
                eq(resources.enabled, true),
                or(
                    eq(sites.exitNodeId, exitNodeId),
                    and(
                        isNull(sites.exitNodeId),
                        sql`(${siteTypes.includes("local") ? 1 : 0} = 1)`, // only allow local sites if "local" is in siteTypes
                        eq(sites.type, "local"),
                        sql`(${build != "saas" ? 1 : 0} = 1)` // Dont allow undefined local sites in cloud
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
                      ]) // allow all three
                    : inArray(resources.mode, ["http", "vnc", "ssh", "rdp"])
            )
        )
        .orderBy(desc(targets.priority), targets.targetId); // stable ordering

    // Group by resource and include targets with their unique site data
    const resourcesMap = new Map();

    for (const row of resourcesWithTargetsAndSites) {
        if (!["http", "tcp", "udp"].includes(row.mode)) {
            continue;
        }
        const resourceId = row.resourceId;
        const resourceName = sanitize(row.resourceName) || "";
        const targetPath = encodePath(row.path); // Use encodePath to avoid collisions (e.g. "/a/b" vs "/a-b")
        const pathMatchType = row.pathMatchType || "";
        const rewritePath = row.rewritePath || "";
        const rewritePathType = row.rewritePathType || "";
        const priority = row.priority ?? 100;

        if (filterOutNamespaceDomains && row.domainNamespaceId) {
            continue;
        }

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
                logger.debug(
                    `Invalid path rewrite configuration for resource ${resourceId}: ${validation.error}`
                );
                continue;
            }

            resourcesMap.set(mapKey, {
                resourceId: row.resourceId,
                name: resourceName,
                key: key,
                fullDomain: row.fullDomain,
                ssl: row.ssl,
                proxyPort: row.proxyPort,
                mode: row.mode,
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
                priority: priority, // may be null, we fallback later
                domainCertResolver: row.domainCertResolver,
                preferWildcardCert: row.preferWildcardCert,
                wildcard: row.wildcard,

                maintenanceModeEnabled: row.maintenanceModeEnabled,
                maintenanceModeType: row.maintenanceModeType,
                maintenanceTitle: row.maintenanceTitle,
                maintenanceMessage: row.maintenanceMessage,
                maintenanceEstimatedTime: row.maintenanceEstimatedTime
            });
        }

        // Add target with its associated site data
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
    }

    // Group browser gateway targets by resource
    const browserGatewayResourcesMap = browserGatewayUiUrl
        ? buildBrowserGatewayResourcesMap(
              resourcesWithTargetsAndSites,
              filterOutNamespaceDomains
          )
        : new Map();

    let siteResourcesWithFullDomain: {
        siteResourceId: number;
        fullDomain: string | null;
        mode: SiteResource["mode"];
    }[] = [];
    if (
        build == "enterprise" &&
        !config.getRawConfig().flags?.disable_private_http_placeholder
    ) {
        // we dont want to do this on the cloud
        // Query siteResources in HTTP mode with SSL enabled and aliases - cert generation / HTTPS edge
        siteResourcesWithFullDomain = await db
            .select({
                siteResourceId: siteResources.siteResourceId,
                fullDomain: siteResources.fullDomain,
                mode: siteResources.mode
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
    }

    // Inference-mode resources/siteResources have no targets/sites/network
    // (their "backend" is the central AI gateway, not something on a site),
    // so they can't be reached via the joins above - query them separately
    // and include them on every exit node.
    const inferenceResources = await db
        .selectDistinct({
            resourceId: resources.resourceId,
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
        .leftJoin(domains, eq(domains.domainId, resources.domainId))
        .where(
            and(eq(resources.mode, "inference"), eq(resources.enabled, true))
        );

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

    let validCerts: CertificateResult[] = [];
    if (privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
        // create a list of all domains to get certs for
        const domains = new Set<string>();
        for (const resource of resourcesMap.values()) {
            if (resource.enabled && resource.ssl && resource.fullDomain) {
                domains.add(resource.fullDomain);
            }
        }
        // Include siteResource aliases so pangolin-dns also fetches certs for them
        for (const sr of siteResourcesWithFullDomain) {
            if (sr.fullDomain) {
                domains.add(sr.fullDomain);
            }
        }
        // Include browser gateway resource domains
        for (const bgResource of browserGatewayResourcesMap.values()) {
            if (bgResource.enabled && bgResource.ssl && bgResource.fullDomain) {
                domains.add(bgResource.fullDomain);
            }
        }
        // Include inference resource/siteResource domains
        for (const ir of inferenceResources) {
            if (ir.enabled && ir.ssl && ir.fullDomain) {
                domains.add(ir.fullDomain);
            }
        }
        for (const sr of siteResourcesInference) {
            if (sr.enabled && sr.ssl && sr.fullDomain) {
                domains.add(sr.fullDomain);
            }
        }
        // get the valid certs for these domains
        validCerts = await getValidCertificatesForDomains(domains, true); // we are caching here because this is called often
        // logger.debug(`Valid certs for domains: ${JSON.stringify(validCerts)}`);
    }

    const traefikRateLimit = config.getRawConfig().traefik.rate_limit;

    const config_output: any = {
        http: {
            middlewares: {
                [redirectHttpsMiddlewareName]: {
                    redirectScheme: {
                        scheme: "https"
                    }
                },
                [redirectToRootMiddlewareName]: {
                    redirectRegex: {
                        regex: "^(https?)://([^/]+)(/.*)?",
                        replacement: "${1}://${2}/auth/org",
                        permanent: false
                    }
                },
                [landingRateLimitMiddlewareName]: {
                    rateLimit: {
                        average: traefikRateLimit.average,
                        burst: traefikRateLimit.burst
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

        logger.debug(
            `Processing resource ${resource.name} with domain ${fullDomain} and ${targets.length} targets`
        );

        if (!resource.enabled) {
            logger.debug(
                `Resource ${resource.name} is disabled, skipping Traefik config`
            );
            continue;
        }

        if (resource.mode == "http") {
            if (!resource.domainId) {
                logger.debug(
                    `Resource ${resource.name} does not have a domainId, skipping Traefik config`
                );
                continue;
            }

            if (!resource.fullDomain) {
                logger.debug(
                    `Resource ${resource.name} does not have a fullDomain, skipping Traefik config`
                );
                continue;
            }

            // add routers and services empty objects if they don't exist
            if (!config_output.http.routers) {
                config_output.http.routers = {};
            }

            if (!config_output.http.services) {
                config_output.http.services = {};
            }

            const additionalMiddlewares =
                config.getRawConfig().traefik.additional_middlewares || [];

            const routerMiddlewares = [
                badgerMiddlewareName,
                ...additionalMiddlewares
            ];

            let rule: string = buildHostRule(fullDomain, resource.wildcard);

            const priority = computeRoutePriority(
                resource.priority,
                resource.path,
                resource.pathMatchType
            );

            let tls = {};
            if (!privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
                tls = buildWildcardTls({
                    fullDomain,
                    hasSubdomain: !!resource.subdomain,
                    domainCertResolver: resource.domainCertResolver,
                    preferWildcardCert:
                        resource.preferWildcardCert || resource.wildcard
                });
            } else {
                // find a cert that matches the full domain, if not continue
                const matchingCert = validCerts.find(
                    (cert) => cert.queriedDomain === resource.fullDomain
                );
                if (!matchingCert) {
                    logger.debug(
                        `No matching certificate found for domain: ${resource.fullDomain}`
                    );
                    continue;
                }
            }

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

            const availableServers = targets.filter((target) => {
                if (!target.enabled) return false;

                if (!target.site.online) return false;

                if (target.health == "unhealthy") return false;

                return true;
            });

            const hasHealthyServers = availableServers.length > 0;

            let showMaintenancePage = false;
            if (resource.maintenanceModeEnabled) {
                if (resource.maintenanceModeType === "forced") {
                    showMaintenancePage = true;
                    // logger.debug(
                    //     `Resource ${resource.name} (${fullDomain}) is in FORCED maintenance mode`
                    // );
                } else if (resource.maintenanceModeType === "automatic") {
                    showMaintenancePage = !hasHealthyServers;
                    // if (showMaintenancePage) {
                    //     logger.warn(
                    //         `Resource ${resource.name} (${fullDomain}) has no healthy servers - showing maintenance page (AUTOMATIC mode)`
                    //     );
                    // }
                }
            }

            if (showMaintenancePage && maintenancePageUiUrl) {
                const maintenanceServiceName = `${key}-maintenance-service`;
                const maintenanceRouterName = `${key}-maintenance-router`;
                const rewriteMiddlewareName = `${key}-maintenance-rewrite`;
                const maintenanceHeadersMiddlewareName = `${key}-maintenance-headers`;

                const entrypointHttp =
                    config.getRawConfig().traefik.http_entrypoint;
                const entrypointHttps =
                    config.getRawConfig().traefik.https_entrypoint;

                const fullDomain = resource.fullDomain;
                const domainParts = fullDomain.split(".");
                const wildCard = resource.subdomain
                    ? `*.${domainParts.slice(1).join(".")}`
                    : fullDomain;

                config_output.http.services[maintenanceServiceName] = {
                    loadBalancer: {
                        servers: [
                            {
                                url: maintenancePageUiUrl
                            }
                        ],
                        passHostHeader: true
                    }
                };

                // middleware to rewrite path to /maintenance-screen
                if (!config_output.http.middlewares) {
                    config_output.http.middlewares = {};
                }

                config_output.http.middlewares[rewriteMiddlewareName] = {
                    replacePathRegex: {
                        regex: "^/(.*)",
                        replacement: "/maintenance-screen"
                    }
                };

                config_output.http.middlewares[
                    maintenanceHeadersMiddlewareName
                ] = {
                    headers: {
                        customRequestHeaders: {
                            Host: "app.pangolin.net", // if we are sending to the cloud the host needs to be this but we will pull the p-host to find the resource
                            "p-host": fullDomain
                        }
                    }
                };

                config_output.http.routers[maintenanceRouterName] = {
                    entryPoints: [
                        resource.ssl ? entrypointHttps : entrypointHttp
                    ],
                    service: maintenanceServiceName,
                    middlewares: [
                        rewriteMiddlewareName,
                        maintenanceHeadersMiddlewareName
                    ],
                    rule: rule,
                    priority: 2000,
                    ...(resource.ssl ? { tls } : {})
                };

                // Router to allow Next.js assets to load without rewrite
                config_output.http.routers[`${maintenanceRouterName}-assets`] =
                    {
                        entryPoints: [
                            resource.ssl ? entrypointHttps : entrypointHttp
                        ],
                        service: maintenanceServiceName,
                        middlewares: [maintenanceHeadersMiddlewareName],
                        rule: `${rule} && (PathPrefix(\`/_next\`) || PathRegexp(\`^/__nextjs*\`) || Path(\`/favicon.ico\`)) `,
                        priority: 2001,
                        ...(resource.ssl ? { tls } : {})
                    };

                // logger.info(`Maintenance mode active for ${fullDomain}`);

                continue;
            }

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
        } else if (resource.mode == "tcp" || resource.mode == "udp") {
            // Non-HTTP (TCP/UDP) configuration
            if (!resource.enableProxy) {
                continue;
            }

            const protocol = resource.mode == "udp" ? "udp" : "tcp";
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
                    ...(resource.proxyProtocol && protocol == "tcp" // proxy protocol only works for tcp
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
            }) => {
                if (
                    !privateConfig.getRawPrivateConfig().flags.use_pangolin_dns
                ) {
                    return buildWildcardTls({
                        fullDomain,
                        hasSubdomain,
                        domainCertResolver,
                        preferWildcardCert
                    });
                }
                const matchingCert = validCerts.find(
                    (cert) => cert.queriedDomain === fullDomain
                );
                if (!matchingCert) {
                    logger.debug(
                        `No matching certificate found for browser gateway domain: ${fullDomain}`
                    );
                    return null;
                }
                return {};
            }
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
            resolveTls: (fullDomain) => {
                if (
                    !privateConfig.getRawPrivateConfig().flags.use_pangolin_dns
                ) {
                    // siteResource aliases don't have a per-domain cert
                    // resolver stored, so always fall back to the global
                    // defaults.
                    return buildWildcardTls({
                        fullDomain,
                        hasSubdomain: true
                    });
                }
                // pangolin-dns: only add route if we already have a valid cert
                const matchingCert = validCerts.find(
                    (cert) => cert.queriedDomain === fullDomain
                );
                if (!matchingCert) {
                    logger.debug(
                        `No matching certificate found for siteResource alias: ${fullDomain}`
                    );
                    return null;
                }
                return {};
            }
        });
    }

    if (aiGatewayUrl) {
        // The AI gateway may live on a different host than the inference
        // resource itself (e.g. a remote exit node forwarding to the
        // central dashboard over a tunnel). passHostHeader would forward
        // the resource's own Host, which that external host won't
        // recognize, so we pin the Host header to the gateway's own host
        // and smuggle the original resource host through in "p-host"
        // instead (same pattern as the maintenance-page routes above).
        const aiGatewayHost = getAiGatewayHost(aiGatewayUrl);

        // The p-host smuggling above is only necessary when the AI gateway
        // is overridden to a different host than the resource's own. In the
        // default case, leave the Host header untouched so it's visible on
        // the other end.
        const aiGatewayOverride =
            config.getRawConfig().server.ai_gateway_override;

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

            let tls: any = {};
            if (!privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
                tls = buildWildcardTls({
                    fullDomain,
                    hasSubdomain: !!ir.subdomain,
                    domainCertResolver: ir.domainCertResolver,
                    preferWildcardCert: ir.preferWildcardCert
                });
            } else {
                const matchingCert = validCerts.find(
                    (cert) => cert.queriedDomain === fullDomain
                );
                if (!matchingCert) {
                    logger.debug(
                        `No matching certificate found for inference resource domain: ${fullDomain}`
                    );
                    continue;
                }
            }

            const additionalMiddlewares =
                config.getRawConfig().traefik.additional_middlewares || [];
            const routerMiddlewares = [
                badgerMiddlewareName,
                AI_GATEWAY_TRUST_MIDDLEWARE_RESOURCE
            ];

            if (aiGatewayOverride) {
                const irHeadersMiddlewareName = `${irKey}-headers-middleware`;
                config_output.http.middlewares[irHeadersMiddlewareName] =
                    buildAiGatewayHostHeaderMiddleware(
                        aiGatewayHost,
                        fullDomain
                    );
                routerMiddlewares.push(irHeadersMiddlewareName);
            }

            routerMiddlewares.push(...additionalMiddlewares);

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

        if (exitNode) {
            // Private (siteResource) inference resources: routed by their alias
            // instead of a public fullDomain, and deliberately WITHOUT the
            // badger middleware - no per-user auth/policy stack exists for
            // siteResources today (see plan doc), so gating here is
            // reachability-only for now.
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

                let tls: any = {};
                if (
                    !privateConfig.getRawPrivateConfig().flags.use_pangolin_dns
                ) {
                    // siteResource aliases don't have a per-domain cert
                    // resolver stored, so always fall back to the global
                    // defaults.
                    tls = buildWildcardTls({
                        fullDomain,
                        hasSubdomain: true
                    });
                } else {
                    const matchingCert = validCerts.find(
                        (cert) => cert.queriedDomain === fullDomain
                    );
                    if (!matchingCert) {
                        logger.debug(
                            `No matching certificate found for inference siteResource fullDomain: ${fullDomain}`
                        );
                        continue;
                    }
                }

                const additionalMiddlewares =
                    config.getRawConfig().traefik.additional_middlewares || [];
                const routerMiddlewares: string[] = [
                    ...(enableAiGatewayClientIpHeader
                        ? [AI_GATEWAY_CLIENT_IP_MIDDLEWARE_NAME]
                        : []),
                    AI_GATEWAY_TRUST_MIDDLEWARE_SITE_RESOURCE
                ];

                if (aiGatewayOverride) {
                    const srHeadersMiddlewareName = `${srKey}-headers-middleware`;
                    config_output.http.middlewares[srHeadersMiddlewareName] =
                        buildAiGatewayHostHeaderMiddleware(
                            aiGatewayHost,
                            fullDomain
                        );
                    routerMiddlewares.push(srHeadersMiddlewareName);
                }

                routerMiddlewares.push(...additionalMiddlewares);

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

    if (generateLoginPageRouters) {
        const exitNodeLoginPages = await db
            .select({
                loginPageId: loginPage.loginPageId,
                fullDomain: loginPage.fullDomain,
                exitNodeId: exitNodes.exitNodeId,
                domainId: loginPage.domainId
            })
            .from(loginPage)
            .innerJoin(
                exitNodes,
                eq(exitNodes.exitNodeId, loginPage.exitNodeId)
            )
            .where(eq(exitNodes.exitNodeId, exitNodeId));

        let validCertsLoginPages: CertificateResult[] = [];
        if (privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
            // create a list of all domains to get certs for
            const domains = new Set<string>();
            for (const lp of exitNodeLoginPages) {
                if (lp.fullDomain) {
                    domains.add(lp.fullDomain);
                }
            }
            // get the valid certs for these domains
            validCertsLoginPages = await getValidCertificatesForDomains(
                domains,
                true
            ); // we are caching here because this is called often
        }

        if (exitNodeLoginPages.length > 0) {
            if (!config_output.http.services) {
                config_output.http.services = {};
            }

            if (!config_output.http.services["landing-service"]) {
                config_output.http.services["landing-service"] = {
                    loadBalancer: {
                        servers: [
                            {
                                url: `http://${
                                    config.getRawConfig().server
                                        .internal_hostname
                                }:${config.getRawConfig().server.next_port}`
                            }
                        ]
                    }
                };
            }

            for (const lp of exitNodeLoginPages) {
                if (!lp.domainId) {
                    continue;
                }

                if (!lp.fullDomain) {
                    continue;
                }

                const tls = {};
                if (
                    !privateConfig.getRawPrivateConfig().flags.use_pangolin_dns
                ) {
                    // TODO: we need to add the wildcard logic here too
                } else {
                    // find a cert that matches the full domain, if not continue
                    const matchingCert = validCertsLoginPages.find(
                        (cert) => cert.queriedDomain === lp.fullDomain
                    );
                    if (!matchingCert) {
                        logger.debug(
                            `No matching certificate found for login page domain: ${lp.fullDomain}`
                        );
                        continue;
                    }
                }

                // auth-allowed:
                //     rule: "Host(`auth.pangolin.internal`) && (PathRegexp(`^/auth/resource/[0-9]+$`) || PathPrefix(`/_next`))"
                //     service: next-service
                //     entryPoints:
                //         - websecure

                const routerName = `loginpage-${lp.loginPageId}`;
                const fullDomain = `${lp.fullDomain}`;

                if (!config_output.http.routers) {
                    config_output.http.routers = {};
                }

                config_output.http.routers![routerName + "-router"] = {
                    entryPoints: [
                        config.getRawConfig().traefik.https_entrypoint
                    ],
                    middlewares: [landingRateLimitMiddlewareName],
                    service: "landing-service",
                    rule: `Host(\`${fullDomain}\`) && (PathRegexp(\`^/auth/resource/[^/]+$\`) || PathRegexp(\`^/auth/idp/[0-9]+/oidc/callback\`) || PathPrefix(\`/_next\`) || Path(\`/auth/org\`) || PathRegexp(\`^/__nextjs*\`) || Path(\`/favicon.ico\`))`,
                    priority: 203,
                    tls: tls
                };

                // auth-catchall:
                //   rule: "Host(`auth.example.com`)"
                //   middlewares:
                //     - redirect-to-root
                //   service: next-service
                //   entryPoints:
                //     - web

                config_output.http.routers![routerName + "-catchall"] = {
                    entryPoints: [
                        config.getRawConfig().traefik.https_entrypoint
                    ],
                    middlewares: [
                        landingRateLimitMiddlewareName,
                        redirectToRootMiddlewareName
                    ],
                    service: "landing-service",
                    rule: `Host(\`${fullDomain}\`)`,
                    priority: 202,
                    tls: tls
                };

                // we need to add a redirect from http to https too
                config_output.http.routers![routerName + "-redirect"] = {
                    entryPoints: [
                        config.getRawConfig().traefik.http_entrypoint
                    ],
                    middlewares: [redirectHttpsMiddlewareName],
                    service: "landing-service",
                    rule: `Host(\`${fullDomain}\`)`,
                    priority: 201
                };
            }
        }
    }

    return config_output;
}
