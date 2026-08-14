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
    Target,
    targets
} from "@server/db";
import {
    sanitize,
    encodePath,
    validatePathRewriteConfig
} from "@server/lib/traefik/utils";
import privateConfig from "#private/lib/config";
import createPathRewriteMiddleware from "@server/lib/traefik/middleware";
import {
    CertificateResult,
    getValidCertificatesForDomains
} from "#private/lib/certificates";
import { build } from "@server/build";

const redirectHttpsMiddlewareName = "redirect-to-https";
const redirectToRootMiddlewareName = "redirect-to-root";
const badgerMiddlewareName = "badger";
const landingRateLimitMiddlewareName = "landing-ratelimit";
const bgRateLimitMiddlewareName = "bg-ratelimit";

// Define extended target type with site information
type TargetWithSite = Target & {
    resourceId: number;
    targetId: number;
    ip: string | null;
    method: string | null;
    port: number | null;
    internalPort: number | null;
    enabled: boolean;
    health: string | null;
    site: {
        siteId: number;
        type: string;
        subnet: string | null;
        exitNodeId: number | null;
        online: boolean;
    };
};

export async function getTraefikConfig(
    exitNodeId: number,
    siteTypes: string[],
    filterOutNamespaceDomains = false,
    generateLoginPageRouters = false,
    allowRawResources = true,
    maintenancePageUiUrl: string | null = null,
    browserGatewayUiUrl: string | null = null
): Promise<any> {
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
            headers: resources.headers,
            proxyProtocol: resources.proxyProtocol,
            proxyProtocolVersion: resources.proxyProtocolVersion,
            enableCache: resources.enableCache,
            enableCachePath: resources.enableCachePath,
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
            subnet: sites.subnet,
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
                headers: row.headers,
                proxyProtocol: row.proxyProtocol,
                proxyProtocolVersion: row.proxyProtocolVersion ?? 1,
                enableCache: row.enableCache,
                enableCachePath: row.enableCachePath,
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
    type BrowserGatewayResourceEntry = {
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
    const browserGatewayResourcesMap = new Map<
        number,
        BrowserGatewayResourceEntry
    >();

    if (browserGatewayUiUrl) {
        for (const row of resourcesWithTargetsAndSites) {
            if (!["ssh", "vnc", "rdp"].includes(row.mode)) {
                continue;
            }
            if (filterOutNamespaceDomains && row.domainNamespaceId) {
                continue;
            }
            if (!browserGatewayResourcesMap.has(row.resourceId)) {
                browserGatewayResourcesMap.set(row.resourceId, {
                    resourceId: row.resourceId,
                    name: sanitize(row.resourceName) || "",
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
            browserGatewayResourcesMap.get(row.resourceId)!.targets.push({
                targetId: row.targetId,
                bgType: row.mode,
                siteId: row.siteId,
                siteType: row.siteType,
                siteOnline: row.siteOnline,
                subnet: row.subnet
            });
        }
    }

    let siteResourcesWithFullDomain: {
        siteResourceId: number;
        fullDomain: string | null;
        mode: "http" | "host" | "cidr" | "ssh";
    }[] = [];
    if (
        build == "enterprise" &&
        !privateConfig.getRawPrivateConfig().flags
            .disable_private_http_placeholder
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
                    eq(siteResources.mode, "http"),
                    eq(siteResources.ssl, true),
                    eq(sites.exitNodeId, exitNodeId),
                    inArray(sites.type, siteTypes)
                )
            );
    }

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
                },
                [bgRateLimitMiddlewareName]: {
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

            let rule: string;
            if (resource.wildcard && fullDomain.startsWith("*.")) {
                // Convert *.foo.bar.com -> HostRegexp(`^[^.]+\.foo\.bar\.com$`)
                const escaped = fullDomain
                    .slice(2) // remove leading "*."
                    .replace(/\./g, "\\.");
                rule = `HostRegexp(\`^[^.]+\\.${escaped}$\`)`;
            } else {
                rule = `Host(\`${fullDomain}\`)`;
            }

            // priority logic
            let priority: number;
            if (resource.priority && resource.priority != 100) {
                priority = resource.priority;
            } else {
                priority = 100;
                if (resource.path && resource.pathMatchType) {
                    priority += 10;
                    if (resource.pathMatchType === "exact") {
                        priority += 5;
                    } else if (resource.pathMatchType === "prefix") {
                        priority += 3;
                    } else if (resource.pathMatchType === "regex") {
                        priority += 2;
                    }
                    if (resource.path === "/") {
                        priority = 1; // lowest for catch-all
                    }
                }
            }

            let tls = {};
            if (!privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
                const domainParts = fullDomain.split(".");
                let wildCard;
                if (domainParts.length <= 2) {
                    wildCard = `*.${domainParts.join(".")}`;
                } else {
                    wildCard = `*.${domainParts.slice(1).join(".")}`;
                }

                if (!resource.subdomain) {
                    wildCard = resource.fullDomain;
                }

                const globalDefaultResolver =
                    config.getRawConfig().traefik.cert_resolver;
                const globalDefaultPreferWildcard =
                    config.getRawConfig().traefik.prefer_wildcard_cert;

                const domainCertResolver = resource.domainCertResolver;
                const preferWildcardCert =
                    resource.preferWildcardCert || resource.wildcard;

                let resolverName: string | undefined;
                let preferWildcard: boolean | undefined;
                // Handle both letsencrypt & custom cases
                if (domainCertResolver) {
                    resolverName = domainCertResolver.trim();
                } else {
                    resolverName = globalDefaultResolver;
                }

                if (
                    preferWildcardCert !== undefined &&
                    preferWildcardCert !== null
                ) {
                    preferWildcard = preferWildcardCert;
                } else {
                    preferWildcard = globalDefaultPreferWildcard;
                }

                tls = {
                    certResolver: resolverName,
                    ...(preferWildcard
                        ? {
                              domains: [
                                  {
                                      main: wildCard
                                  }
                              ]
                          }
                        : {})
                };
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
            if (
                resource.rewritePath !== null &&
                resource.path !== null &&
                resource.pathMatchType &&
                resource.rewritePathType
            ) {
                // Create a unique middleware name
                const rewriteMiddlewareName = `rewrite-r${resource.resourceId}-${key}`;

                try {
                    const rewriteResult = createPathRewriteMiddleware(
                        rewriteMiddlewareName,
                        resource.path,
                        resource.pathMatchType,
                        resource.rewritePath,
                        resource.rewritePathType
                    );

                    // Initialize middlewares object if it doesn't exist
                    if (!config_output.http.middlewares) {
                        config_output.http.middlewares = {};
                    }

                    // the middleware to the config
                    Object.assign(
                        config_output.http.middlewares,
                        rewriteResult.middlewares
                    );

                    // middlewares to the router middleware chain
                    if (rewriteResult.chain) {
                        // For chained middlewares (like stripPrefix + addPrefix)
                        routerMiddlewares.push(...rewriteResult.chain);
                    } else {
                        // Single middleware
                        routerMiddlewares.push(rewriteMiddlewareName);
                    }

                    // logger.debug(
                    //     `Created path rewrite middleware ${rewriteMiddlewareName}: ${resource.pathMatchType}(${resource.path}) -> ${resource.rewritePathType}(${resource.rewritePath})`
                    // );
                } catch (error) {
                    logger.error(
                        `Failed to create path rewrite middleware for resource ${resource.resourceId}: ${error}`
                    );
                }
            }

            if (resource.headers || resource.setHostHeader) {
                // if there are headers, parse them into an object
                const headersObj: { [key: string]: string } = {};
                if (resource.headers) {
                    let headersArr: { name: string; value: string }[] = [];
                    try {
                        headersArr = JSON.parse(resource.headers) as {
                            name: string;
                            value: string;
                        }[];
                    } catch (e) {
                        logger.warn(
                            `Failed to parse headers for resource ${resource.resourceId}: ${e}`
                        );
                    }

                    headersArr.forEach((header) => {
                        headersObj[header.name] = header.value;
                    });
                }

                if (resource.setHostHeader) {
                    headersObj["Host"] = resource.setHostHeader;
                }

                // check if the object is not empty
                if (Object.keys(headersObj).length > 0) {
                    // Add the headers middleware
                    if (!config_output.http.middlewares) {
                        config_output.http.middlewares = {};
                    }
                    config_output.http.middlewares[headersMiddlewareName] = {
                        headers: {
                            customRequestHeaders: headersObj
                        }
                    };

                    routerMiddlewares.push(headersMiddlewareName);
                }
            }

            // Handle caching middleware if enabled
            if (resource.enableCache) {
                const cacheMiddlewareName = `${key}-cache-middleware`;
                if (!config_output.http.middlewares) {
                    config_output.http.middlewares = {};
                }
                config_output.http.middlewares[cacheMiddlewareName] = {
                    plugin: {
                        cache: {
                            path: resource.enableCachePath || "/tmp"
                        }
                    }
                };
                routerMiddlewares.push(cacheMiddlewareName);
            }

            if (resource.path && resource.pathMatchType) {
                //priority += 1;
                // add path to rule based on match type
                let path = resource.path;
                // if the path doesn't start with a /, add it
                if (!path.startsWith("/")) {
                    path = `/${path}`;
                }
                if (resource.pathMatchType === "exact") {
                    rule += ` && Path(\`${path}\`)`;
                } else if (resource.pathMatchType === "prefix") {
                    rule += ` && PathPrefix(\`${path}\`)`;
                } else if (resource.pathMatchType === "regex") {
                    rule += ` && PathRegexp(\`${resource.path}\`)`; // this is the raw path because it's a regex
                }
            }

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
                    servers: (() => {
                        // Check if any sites are online
                        // THIS IS SO THAT THERE IS SOME IMMEDIATE FEEDBACK
                        // EVEN IF THE SITES HAVE NOT UPDATED YET FROM THE
                        // RECEIVE BANDWIDTH ENDPOINT.

                        // TODO: HOW TO HANDLE ^^^^^^ BETTER
                        const anySitesOnline = targets.some(
                            (target) => target.site.online
                        );

                        return (
                            targets
                                .filter((target) => {
                                    if (!target.enabled) {
                                        return false;
                                    }

                                    if (target.health == "unhealthy") {
                                        return false;
                                    }

                                    // If any sites are online, exclude offline sites
                                    if (anySitesOnline && !target.site.online) {
                                        return false;
                                    }

                                    if (
                                        target.site.type === "local" ||
                                        target.site.type === "wireguard"
                                    ) {
                                        if (
                                            !target.ip ||
                                            !target.port ||
                                            !target.method
                                        ) {
                                            return false;
                                        }
                                    } else if (target.site.type === "newt") {
                                        if (
                                            !target.internalPort ||
                                            !target.method ||
                                            !target.site.subnet
                                        ) {
                                            return false;
                                        }
                                    }
                                    return true;
                                })
                                .map((target) => {
                                    if (
                                        target.site.type === "local" ||
                                        target.site.type === "wireguard"
                                    ) {
                                        return {
                                            url: `${target.method}://${target.ip}:${target.port}`
                                        };
                                    } else if (target.site.type === "newt") {
                                        const ip =
                                            target.site.subnet!.split("/")[0];
                                        return {
                                            url: `${target.method}://${ip}:${target.internalPort}`
                                        };
                                    }
                                })
                                // filter out duplicates
                                .filter(
                                    (v, i, a) =>
                                        a.findIndex(
                                            (t) => t && v && t.url === v.url
                                        ) === i
                                )
                        );
                    })(),
                    ...(resource.stickySession
                        ? {
                              sticky: {
                                  cookie: {
                                      name: "p_sticky", // TODO: make this configurable via config.yml like other cookies
                                      secure: resource.ssl,
                                      httpOnly: true
                                  }
                              }
                          }
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
                    servers: (() => {
                        // Check if any sites are online
                        const anySitesOnline = targets.some(
                            (target) => target.site.online
                        );

                        return targets
                            .filter((target) => {
                                if (!target.enabled) {
                                    return false;
                                }

                                // If any sites are online, exclude offline sites
                                if (anySitesOnline && !target.site.online) {
                                    return false;
                                }

                                if (
                                    target.site.type === "local" ||
                                    target.site.type === "wireguard"
                                ) {
                                    if (!target.ip || !target.port) {
                                        return false;
                                    }
                                } else if (target.site.type === "newt") {
                                    if (
                                        !target.internalPort ||
                                        !target.site.subnet
                                    ) {
                                        return false;
                                    }
                                }
                                return true;
                            })
                            .map((target) => {
                                if (
                                    target.site.type === "local" ||
                                    target.site.type === "wireguard"
                                ) {
                                    return {
                                        address: `${target.ip}:${target.port}`
                                    };
                                } else if (target.site.type === "newt") {
                                    const ip =
                                        target.site.subnet!.split("/")[0];
                                    return {
                                        address: `${ip}:${target.internalPort}`
                                    };
                                }
                            });
                    })(),
                    ...(resource.proxyProtocol && protocol == "tcp" // proxy protocol only works for tcp
                        ? {
                              serversTransport: `${ppPrefix}${resource.proxyProtocolVersion || 1}@file` // TODO: does @file here cause issues?
                          }
                        : {}),
                    ...(resource.stickySession
                        ? {
                              sticky: {
                                  ipStrategy: {
                                      depth: 0,
                                      sourcePort: true
                                  }
                              }
                          }
                        : {})
                }
            };
        }
    }

    if (browserGatewayUiUrl) {
        // Generate Traefik config for browser gateway resources
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
            let tls = {};
            if (!privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
                const domainParts = fullDomain.split(".");
                let wildCard: string;
                if (domainParts.length <= 2) {
                    wildCard = `*.${domainParts.join(".")}`;
                } else {
                    wildCard = `*.${domainParts.slice(1).join(".")}`;
                }
                if (!bgResource.subdomain) {
                    wildCard = fullDomain;
                }

                const globalDefaultResolver =
                    config.getRawConfig().traefik.cert_resolver;
                const globalDefaultPreferWildcard =
                    config.getRawConfig().traefik.prefer_wildcard_cert;
                const resolverName = bgResource.domainCertResolver
                    ? bgResource.domainCertResolver.trim()
                    : globalDefaultResolver;
                const preferWildcard =
                    bgResource.preferWildcardCert !== undefined &&
                    bgResource.preferWildcardCert !== null
                        ? bgResource.preferWildcardCert
                        : globalDefaultPreferWildcard;

                tls = {
                    certResolver: resolverName,
                    ...(preferWildcard ? { domains: [{ main: wildCard }] } : {})
                };
            } else {
                const matchingCert = validCerts.find(
                    (cert) => cert.queriedDomain === fullDomain
                );
                if (!matchingCert) {
                    logger.debug(
                        `No matching certificate found for browser gateway domain: ${fullDomain}`
                    );
                    continue;
                }
            }

            const bgUiServiceName = `bg-r${bgResource.resourceId}-ui-service`;

            if (bgResource.ssl) {
                const redirectRouterName = `bg-r${bgResource.resourceId}-redirect`;
                config_output.http.routers![redirectRouterName] = {
                    entryPoints: [
                        config.getRawConfig().traefik.http_entrypoint
                    ],
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

                if (!config_output.http.services)
                    config_output.http.services = {};
                if (!config_output.http.middlewares)
                    config_output.http.middlewares = {};
                if (!config_output.http.routers)
                    config_output.http.routers = {};

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

                config_output.http.routers![
                    `${bgMaintenanceRouterName}-assets`
                ] = {
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
                    .filter(
                        (v, i, a) => a.findIndex((u) => u.url === v.url) === i
                    );

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
            config_output.http.routers![
                `bg-r${bgResource.resourceId}-ui-router`
            ] = {
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

            // Middleware that rewrites any path to /maintenance-screen
            config_output.http.middlewares[siteResourceRewriteMiddlewareName] =
                {
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
            let tls: any = {};
            if (!privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
                const domainParts = fullDomain.split(".");
                const wildCard =
                    domainParts.length <= 2
                        ? `*.${domainParts.join(".")}`
                        : `*.${domainParts.slice(1).join(".")}`;

                const globalDefaultResolver =
                    config.getRawConfig().traefik.cert_resolver;
                const globalDefaultPreferWildcard =
                    config.getRawConfig().traefik.prefer_wildcard_cert;

                tls = {
                    certResolver: globalDefaultResolver,
                    ...(globalDefaultPreferWildcard
                        ? { domains: [{ main: wildCard }] }
                        : {})
                };
            } else {
                // pangolin-dns: only add route if we already have a valid cert
                const matchingCert = validCerts.find(
                    (cert) => cert.queriedDomain === fullDomain
                );
                if (!matchingCert) {
                    logger.debug(
                        `No matching certificate found for siteResource alias: ${fullDomain}`
                    );
                    continue;
                }
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
