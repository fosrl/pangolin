import { timingSafeEqual } from "crypto";

// Keep in sync with server/lib/browserGatewayTrust.ts
const TRUST_HEADER = "x-pangolin-browser-gateway-auth";

/**
 * Host the request was originally addressed to. Traefik rewrites Host to the
 * dashboard and puts the real one in "p-host", but any client can send p-host
 * too. Only honor it when the request carries the Traefik trust token.
 */
export function getTrustedHost(headersList: Headers): string {
    const expected = process.env.BROWSER_GATEWAY_TRUST_TOKEN;
    const provided = headersList.get(TRUST_HEADER);
    const pHost = headersList.get("p-host");

    if (
        expected &&
        provided &&
        pHost &&
        provided.length === expected.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
        return pHost;
    }
    return headersList.get("host") || "";
}
