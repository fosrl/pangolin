import config from "@server/lib/config";
import {
    AI_GATEWAY_TRUST_HEADER,
    AI_GATEWAY_RESOURCE_TYPE_HEADER,
    AI_GATEWAY_CLIENT_IP_HEADER,
    getAiGatewayTrustToken
} from "@server/lib/aiGatewayTrust";

// The trust token is the same for every inference route on an exit node, so
// these middlewares are built once and attached to each inference router.
// Two variants exist (public resource vs. siteResource) so the resource
// type header lets the gateway know which kind of router the request came
// through without re-deriving it from resourceId.
export const AI_GATEWAY_TRUST_MIDDLEWARE_RESOURCE =
    "ai-gateway-trust-headers-resource";
export const AI_GATEWAY_TRUST_MIDDLEWARE_SITE_RESOURCE =
    "ai-gateway-trust-headers-site-resource";

// Opt-in: a Badger instance with forward auth disabled, used only to stamp
// the resolved client IP into a dedicated header before the request reaches
// whatever sits between Traefik and the AI gateway. Only the site-resource
// router needs this - it's the only path that resolves request identity
// from the client IP (see resolveRequestUser in aiGateway/pipeline.ts) -
// and it's the only inference router that doesn't already run Badger.
export const AI_GATEWAY_CLIENT_IP_MIDDLEWARE_NAME = "ai-gateway-client-ip";

/**
 * The AI gateway may live on a different host than the inference resource
 * itself (e.g. a remote exit node forwarding to the central dashboard over
 * a tunnel), so callers use this to decide whether to pin the Host header
 * to the gateway's own host.
 */
export function getAiGatewayHost(aiGatewayUrl: string): string | undefined {
    try {
        return new URL(aiGatewayUrl).host;
    } catch {
        return undefined;
    }
}

/**
 * Header middleware that pins the Host header to the AI gateway's own host
 * (when it differs from the resource's) and smuggles the original resource
 * host through in "p-host" instead, so passHostHeader can't leak the wrong
 * Host to a gateway that lives on a different host than the resource.
 */
export function buildAiGatewayHostHeaderMiddleware(
    aiGatewayHost: string | undefined,
    fullDomain: string
): { headers: { customRequestHeaders: Record<string, string> } } {
    return {
        headers: {
            customRequestHeaders: {
                ...(aiGatewayHost ? { Host: aiGatewayHost } : {}),
                "p-host": fullDomain
            }
        }
    };
}

export function buildAiGatewayTrustMiddlewares(): Record<string, any> {
    const token = getAiGatewayTrustToken();
    return {
        [AI_GATEWAY_TRUST_MIDDLEWARE_RESOURCE]: {
            headers: {
                customRequestHeaders: {
                    [AI_GATEWAY_TRUST_HEADER]: token,
                    [AI_GATEWAY_RESOURCE_TYPE_HEADER]: "resource"
                }
            }
        },
        [AI_GATEWAY_TRUST_MIDDLEWARE_SITE_RESOURCE]: {
            headers: {
                customRequestHeaders: {
                    [AI_GATEWAY_TRUST_HEADER]: token,
                    [AI_GATEWAY_RESOURCE_TYPE_HEADER]: "site-resource"
                }
            }
        }
    };
}

export function buildAiGatewayClientIpMiddleware(): Record<string, any> | null {
    const enabled =
        config.getRawConfig().server.enable_ai_gateway_client_ip_header;
    if (!enabled) {
        return null;
    }
    return {
        [AI_GATEWAY_CLIENT_IP_MIDDLEWARE_NAME]: {
            plugin: {
                badger: {
                    disableForwardAuth: true,
                    realIpHeader: AI_GATEWAY_CLIENT_IP_HEADER
                }
            }
        }
    };
}

/**
 * Build the redirect (if ssl), main router, and single-server service for
 * an AI-gateway-backed inference router. Identical between the public
 * inference-resource and siteResource-inference cases, and between the OSS
 * and private config generators - only the rule/tls/middleware chain
 * differs, which callers resolve themselves beforehand.
 */
export function buildAiGatewayRouterAndService(params: {
    routerName: string;
    serviceName: string;
    rule: string;
    ssl: boolean | null;
    tls: any;
    priority: number;
    routerMiddlewares: string[];
    aiGatewayUrl: string;
    redirectHttpsMiddlewareName: string;
}): { routers: Record<string, any>; services: Record<string, any> } {
    const {
        routerName,
        serviceName,
        rule,
        ssl,
        tls,
        priority,
        routerMiddlewares,
        aiGatewayUrl,
        redirectHttpsMiddlewareName
    } = params;

    const routers: Record<string, any> = {};

    if (ssl) {
        routers[`${routerName}-redirect`] = {
            entryPoints: [config.getRawConfig().traefik.http_entrypoint],
            middlewares: [redirectHttpsMiddlewareName],
            service: serviceName,
            rule,
            priority
        };
    }

    routers[routerName] = {
        entryPoints: [
            ssl
                ? config.getRawConfig().traefik.https_entrypoint
                : config.getRawConfig().traefik.http_entrypoint
        ],
        middlewares: routerMiddlewares,
        service: serviceName,
        rule,
        priority,
        ...(ssl ? { tls } : {})
    };

    const services = {
        [serviceName]: {
            loadBalancer: {
                servers: [{ url: aiGatewayUrl }]
            }
        }
    };

    return { routers, services };
}
