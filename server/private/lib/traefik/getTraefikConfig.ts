/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
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
import { orgs, resources, sites, Target, targets } from "@server/db";
import { sanitize, validatePathRewriteConfig } from "@server/lib/traefik/utils";
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

export async function getTraefikConfig(
    exitNodeId: number,
    siteTypes: string[],
    filterOutNamespaceDomains = false,
    generateLoginPageRouters = false,
    allowRawResources = true
): Promise<any> {
    // Define extended target type with site information
    type TargetWithSite = Target & {
        site: {
            siteId: number;
            type: string;
            subnet: string | null;
            exitNodeId: number | null;
            online: boolean;
        };
    };

    // Get resources with their targets and sites in a single optimized query
    // Start from sites on this exit node, then join to targets and resources
    const resourcesWithTargetsAndSites = await db
        .select({
            // Resource fields
            resourceId: resources.resourceId,
            resourceName: resources.name,
            fullDomain: resources.fullDomain,
            ssl: resources.ssl,
            http: resources.http,
            proxyPort: resources.proxyPort,
            protocol: resources.protocol,
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
                or(
                    ne(targetHealthCheck.hcHealth, "unhealthy"), // Exclude unhealthy targets
                    isNull(targetHealthCheck.hcHealth) // Include targets with no health check record
                ),
                inArray(sites.type, siteTypes),
                allowRawResources
                    ? isNotNull(resources.http) // ignore the http check if allow_raw_resources is true
                    : eq(resources.http, true)
            )
        )
        .orderBy(desc(targets.priority), targets.targetId); // stable ordering

    // Group by resource and include targets with their unique site data
    const resourcesMap = new Map();

    resourcesWithTargetsAndSites.forEach((row) => {
        const resourceId = row.resourceId;
        const resourceName = sanitize(row.resourceName) || "";
        const targetPath = sanitize(row.path) || ""; // Handle null/undefined paths
        const pathMatchType = row.pathMatchType || "";
        const rewritePath = row.rewritePath || "";
        const rewritePathType = row.rewritePathType || "";
        const priority = row.priority ?? 100;

        if (filterOutNamespaceDomains && row.domainNamespaceId) {
            return;
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

        if (!resourcesMap.has(key)) {
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
                return;
            }

            resourcesMap.set(key, {
                resourceId: row.resourceId,
                name: resourceName,
                fullDomain: row.fullDomain,
                ssl: row.ssl,
                http: row.http,
                proxyPort: row.proxyPort,
                protocol: row.protocol,
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
                path: row.path, // the targets will all have the same path
                pathMatchType: row.pathMatchType, // the targets will all have the same pathMatchType
                rewritePath: row.rewritePath,
                rewritePathType: row.rewritePathType,
                priority: priority, // may be null, we fallback later
                domainCertResolver: row.domainCertResolver,
                preferWildcardCert: row.preferWildcardCert,

                maintenanceModeEnabled: row.maintenanceModeEnabled,
                maintenanceModeType: row.maintenanceModeType,
                maintenanceTitle: row.maintenanceTitle,
                maintenanceMessage: row.maintenanceMessage,
                maintenanceEstimatedTime: row.maintenanceEstimatedTime,
            });
        }

        // Add target with its associated site data
        resourcesMap.get(key).targets.push({
            resourceId: row.resourceId,
            targetId: row.targetId,
            ip: row.ip,
            method: row.method,
            port: row.port,
            internalPort: row.internalPort,
            enabled: row.targetEnabled,
            site: {
                siteId: row.siteId,
                type: row.siteType,
                subnet: row.subnet,
                exitNodeId: row.exitNodeId,
                online: row.siteOnline
            }
        });
    });

    let validCerts: CertificateResult[] = [];
    if (privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
        // create a list of all domains to get certs for
        const domains = new Set<string>();
        for (const resource of resourcesMap.values()) {
            if (resource.enabled && resource.ssl && resource.fullDomain) {
                domains.add(resource.fullDomain);
            }
        }
        // get the valid certs for these domains
        validCerts = await getValidCertificatesForDomains(domains, true); // we are caching here because this is called often
        // logger.debug(`Valid certs for domains: ${JSON.stringify(validCerts)}`);
    }

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
                }
            }
        }
    };

    // get the key and the resource
    for (const [key, resource] of resourcesMap.entries()) {
        const targets = resource.targets;

        const routerName = `${key}-${resource.name}-router`;
        const serviceName = `${key}-${resource.name}-service`;
        const fullDomain = `${resource.fullDomain}`;
        const transportName = `${key}-transport`;
        const headersMiddlewareName = `${key}-headers-middleware`;

        if (!resource.enabled) {
            continue;
        }

        if (resource.http) {
            if (!resource.domainId) {
                continue;
            }

            if (!resource.fullDomain) {
                continue;
            }

            // add routers and services empty objects if they don't exist
            if (!config_output.http.routers) {
                config_output.http.routers = {};
            }

            if (!config_output.http.services) {
                config_output.http.services = {};
            }

            const availableServers = (targets as TargetWithSite[]).filter(
                (target: TargetWithSite) => {
                    if (!target.enabled) return false;

                    const anySitesOnline = (targets as TargetWithSite[]).some(
                        (t: TargetWithSite) => t.site.online
                    );
                    if (anySitesOnline && !target.site.online) return false;

                    if (target.site.type === "local" || target.site.type === "wireguard") {
                        return target.ip && target.port && target.method;
                    } else if (target.site.type === "newt") {
                        return target.internalPort && target.method && target.site.subnet;
                    }
                    return false;
                }
            );

            const hasHealthyServers = availableServers.length > 0;

            let showMaintenancePage = false;
            if (resource.maintenanceModeEnabled) {
                if (resource.maintenanceModeType === "forced") {
                    showMaintenancePage = true;
                    logger.debug(
                        `Resource ${resource.name} (${fullDomain}) is in FORCED maintenance mode`
                    );
                } else if (resource.maintenanceModeType === "automatic") {
                    showMaintenancePage = !hasHealthyServers;
                    if (showMaintenancePage) {
                        logger.warn(
                            `Resource ${resource.name} (${fullDomain}) has no healthy servers - showing maintenance page (AUTOMATIC mode)`
                        );
                    }
                }
            }

            if (showMaintenancePage) {
                const maintenanceServiceName = `${key}-maintenance-service`;
                const maintenanceRouterName = `${key}-maintenance-router`;
                const rewriteMiddlewareName = `${key}-maintenance-rewrite`;

                const entrypointHttp = config.getRawConfig().traefik.http_entrypoint;
                const entrypointHttps = config.getRawConfig().traefik.https_entrypoint;

                const fullDomain = resource.fullDomain;
                const domainParts = fullDomain.split(".");
                const wildCard = resource.subdomain
                    ? `*.${domainParts.slice(1).join(".")}`
                    : fullDomain;

                const tls = {
                    certResolver: resource.domainCertResolver?.trim() ||
                        config.getRawConfig().traefik.cert_resolver,
                    ...(config.getRawConfig().traefik.prefer_wildcard_cert
                        ? { domains: [{ main: wildCard }] }
                        : {})
                };

                const maintenancePort = config.getRawConfig().traefik?.maintenance_port;
                const maintenanceHost = config.getRawConfig().traefik?.maintenance_host || 'dev_pangolin';

                config_output.http.services[maintenanceServiceName] = {
                    loadBalancer: {
                        servers: [{ url: `http://${maintenanceHost}:${maintenancePort}` }],
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


                const rule = `Host(\`${fullDomain}\`)`;

                console.log('DEBUG: Generated rule:', rule); // Should show: Host(`pangolin.pallavi.fosrl.io`)

                config_output.http.routers[maintenanceRouterName] = {
                    entryPoints: [resource.ssl ? entrypointHttps : entrypointHttp],
                    service: maintenanceServiceName,
                    middlewares: [rewriteMiddlewareName],
                    rule: rule,
                    priority: 2000,
                    ...(resource.ssl ? { tls } : {})
                };

                if (resource.ssl) {
                    config_output.http.routers[`${maintenanceRouterName}-redirect`] = {
                        entryPoints: [entrypointHttp],
                        middlewares: [redirectHttpsMiddlewareName, rewriteMiddlewareName],
                        service: maintenanceServiceName,
                        rule: rule,
                        priority: 2000
                    };
                }

                logger.info(`Maintenance mode active for ${fullDomain}`);

                continue;
            }

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

            const configDomain = config.getDomain(resource.domainId);

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
                const preferWildcardCert = resource.preferWildcardCert;

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

            const additionalMiddlewares =
                config.getRawConfig().traefik.additional_middlewares || [];

            const routerMiddlewares = [
                badgerMiddlewareName,
                ...additionalMiddlewares
            ];

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

            let rule = `Host(\`${fullDomain}\`)`;

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
                    servers: (() => {
                        // Check if any sites are online
                        // THIS IS SO THAT THERE IS SOME IMMEDIATE FEEDBACK
                        // EVEN IF THE SITES HAVE NOT UPDATED YET FROM THE
                        // RECEIVE BANDWIDTH ENDPOINT.

                        // TODO: HOW TO HANDLE ^^^^^^ BETTER
                        const anySitesOnline = (
                            targets as TargetWithSite[]
                        ).some((target: TargetWithSite) => target.site.online);

                        return (
                            (targets as TargetWithSite[])
                                .filter((target: TargetWithSite) => {
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
                                .map((target: TargetWithSite) => {
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
        } else {
            // Non-HTTP (TCP/UDP) configuration
            if (!resource.enableProxy) {
                continue;
            }

            const protocol = resource.protocol.toLowerCase();
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
                        const anySitesOnline = (
                            targets as TargetWithSite[]
                        ).some((target: TargetWithSite) => target.site.online);

                        return (targets as TargetWithSite[])
                            .filter((target: TargetWithSite) => {
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
                            .map((target: TargetWithSite) => {
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
                                url: `http://${config.getRawConfig().server
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
                    service: "landing-service",
                    rule: `Host(\`${fullDomain}\`) && (PathRegexp(\`^/auth/resource/[^/]+$\`) || PathRegexp(\`^/auth/idp/[0-9]+/oidc/callback\`) || PathPrefix(\`/_next\`) || Path(\`/auth/org\`) || PathRegexp(\`^/__nextjs*\`))`,
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
                    middlewares: [redirectToRootMiddlewareName],
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
