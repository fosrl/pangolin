import { createHash } from "crypto";
import config from "@server/lib/config";

export const AI_GATEWAY_TRUST_HEADER = "X-Pangolin-Ai-Gateway-Auth";

// Injected by the same Traefik trust middleware as AI_GATEWAY_TRUST_HEADER,
// but its value differs per router (public inference resource vs. private
// siteResource) so the gateway can tell which kind of resource a trusted
// request arrived on without re-deriving it from resourceId/siteResourceId.
export const AI_GATEWAY_RESOURCE_TYPE_HEADER =
    "X-Pangolin-Ai-Gateway-Resource-Type";

export type AiGatewayResourceType = "resource" | "site-resource";

// Opt-in (server.enable_ai_gateway_client_ip_header): carries the client IP
// that Badger resolved at the Traefik hop, so it survives an intermediary
// proxy between Traefik and the AI gateway that overwrites
// X-Forwarded-For/X-Real-Ip instead of appending to them. Set by a
// disableForwardAuth Badger middleware instance (see getTraefikConfig.ts)
// on the site-resource inference router only, since that's the sole path
// that resolves request identity from the client IP.
export const AI_GATEWAY_CLIENT_IP_HEADER = "X-Pangolin-Client-Ip";

/**
 * Derive a Traefik-injected trust token from the server secret.
 * Traefik overwrites this header on inference routes so the AI gateway can
 * trust Badger-injected Remote-* identity without re-validating credentials.
 */
export function deriveAiGatewayTrustToken(secret: string): string {
    return createHash("sha256")
        .update(`ai-gateway-trust:${secret}`)
        .digest("hex");
}

export function getAiGatewayTrustToken(): string {
    const secret = config.getRawConfig().server.secret;
    if (!secret) {
        throw new Error("Server secret is required for AI gateway trust token");
    }
    return deriveAiGatewayTrustToken(secret);
}

export function isAiGatewayTrustHeaderValid(
    headers: Record<string, string | string[] | undefined> | undefined,
    expectedToken?: string
): boolean {
    if (!headers) {
        return false;
    }
    const expected = expectedToken ?? getAiGatewayTrustToken();
    const raw =
        headers[AI_GATEWAY_TRUST_HEADER] ??
        headers[AI_GATEWAY_TRUST_HEADER.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value === expected;
}

export function getAiGatewayResourceType(
    headers: Record<string, string | string[] | undefined> | undefined
): AiGatewayResourceType | null {
    if (!headers) {
        return null;
    }
    const raw =
        headers[AI_GATEWAY_RESOURCE_TYPE_HEADER] ??
        headers[AI_GATEWAY_RESOURCE_TYPE_HEADER.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value === "resource" || value === "site-resource" ? value : null;
}
