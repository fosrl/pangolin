import logger from "@server/logger";
import config from "@server/lib/config";
import { applyMtlsConfig } from "@server/lib/traefik/mtls";
import {
    buildHostRule,
    appendPathMatch,
    computeRedirectPriority
} from "@server/lib/traefik/rule";

export type RedirectRouteRow = {
    redirectId: number;
    /** Host the redirect listens on (resource fullDomain or subdomain.baseDomain). */
    fullDomain: string;
    hasSubdomain: boolean;
    attachedTo: "resource" | "domain";
    /** Set when attachedTo is "resource". */
    resourceId: number | null;
    enabled: boolean;
    name: string;
    wildcard: boolean | null;
    ssl: boolean;
    matchPath: string | null;
    pathMatchType: string;
    priority: number | null;
    domainCertResolver?: string | null;
    preferWildcardCert?: boolean | null;
};

// Traefik requires a service on every router, but a redirect router's
// middleware chain always terminates the request with a 30x, so the service
// is never reached. noop@internal answers 418 if it ever is - treat that as
// a bug in the middleware chain, not something to route around.
const NOOP_SERVICE = "noop@internal";

export function buildRedirectConfig(params: {
    config_output: any;
    redirects: RedirectRouteRow[];
    badgerMiddlewareName: string;
    redirectHttpsMiddlewareName: string;
    resolveTls: (row: RedirectRouteRow) => any | null;
    // trusted client-CA PEMs for resources that require mTLS
    mtlsCaCertsByResource: Map<number, string[]>;
}): void {
    const {
        config_output,
        redirects,
        badgerMiddlewareName,
        redirectHttpsMiddlewareName,
        resolveTls,
        mtlsCaCertsByResource
    } = params;

    if (redirects.length === 0) {
        return;
    }

    const httpEntrypoint = config.getRawConfig().traefik.http_entrypoint;
    const httpsEntrypoint = config.getRawConfig().traefik.https_entrypoint;
    const additionalMiddlewares =
        config.getRawConfig().traefik.additional_middlewares || [];
    const routerMiddlewares = [badgerMiddlewareName, ...additionalMiddlewares];

    for (const redirect of redirects) {
        const routerName = `${redirect.redirectId}-redirect-${redirect.name}-router`;

        if (!redirect.enabled) {
            logger.debug(
                `Redirect ${redirect.name} is disabled, skipping Traefik config`
            );
            continue;
        }

        let tls: any = {};
        if (redirect.ssl) {
            tls = resolveTls(redirect);
            if (tls === null) {
                continue;
            }
        }

        // A redirect attached to a resource listens on the resource's host,
        // and Traefik resolves TLS options per host: unless it references the
        // resource's mTLS options too, Traefik falls back to the defaults and
        // the resource's mTLS is no longer enforced.
        const redirectMiddlewares = [...routerMiddlewares];
        if (
            redirect.ssl &&
            redirect.attachedTo === "resource" &&
            redirect.resourceId !== null
        ) {
            const mtlsOptionsName = applyMtlsConfig(
                config_output,
                redirect.resourceId,
                mtlsCaCertsByResource.get(redirect.resourceId),
                redirectMiddlewares
            );
            if (mtlsOptionsName) {
                tls = { ...tls, options: mtlsOptionsName };
            }
        }

        if (!config_output.http.routers) {
            config_output.http.routers = {};
        }

        if (redirect.matchPath && redirect.pathMatchType === "regex") {
            try {
                new RegExp(redirect.matchPath);
            } catch {
                logger.debug(
                    `Invalid regex pattern in redirect ${redirect.redirectId} match path: ${redirect.matchPath}`
                );
                continue;
            }
        }

        const rule = appendPathMatch(
            buildHostRule(redirect.fullDomain, redirect.wildcard),
            redirect.matchPath,
            redirect.pathMatchType
        );

        const priority = computeRedirectPriority(
            redirect.priority,
            redirect.matchPath,
            redirect.pathMatchType
        );

        // if resource is already attached to resource, we don't need to add the https redirect
        // as it is already added in the resource traefik config
        if (redirect.attachedTo !== "resource" && redirect.ssl) {
            config_output.http.routers[`${routerName}-redirect`] = {
                entryPoints: [httpEntrypoint],
                middlewares: [redirectHttpsMiddlewareName],
                service: NOOP_SERVICE,
                rule,
                priority
            };
        }

        config_output.http.routers[routerName] = {
            entryPoints: [redirect.ssl ? httpsEntrypoint : httpEntrypoint],
            middlewares: redirectMiddlewares,
            service: NOOP_SERVICE,
            rule,
            priority,
            ...(redirect.ssl ? { tls } : {})
        };
    }
}
