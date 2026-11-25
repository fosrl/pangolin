import { createHash } from "crypto";

// Stamped by the Traefik routers that serve the browser gateway pages and the
// maintenance page. The dashboard only honors the "p-host" header when this
// header carries the right token, so a client cannot pick the target itself.
export const BROWSER_GATEWAY_TRUST_HEADER = "X-Pangolin-Browser-Gateway-Auth";

// Next.js reads the expected token from this env var (set in config.ts)
export const BROWSER_GATEWAY_TRUST_ENV = "BROWSER_GATEWAY_TRUST_TOKEN";

export function deriveBrowserGatewayTrustToken(secret: string): string {
    return createHash("sha256")
        .update(`browser-gateway-trust:${secret}`)
        .digest("hex");
}

/**
 * Request headers that make the dashboard trust "p-host". Empty when no
 * server secret is configured, in which case p-host is ignored.
 */
export function buildPHostHeaders(
    secret: string | undefined,
    fullDomain: string
): Record<string, string> {
    return {
        "p-host": fullDomain,
        ...(secret
            ? {
                  [BROWSER_GATEWAY_TRUST_HEADER]:
                      deriveBrowserGatewayTrustToken(secret)
              }
            : {})
    };
}
