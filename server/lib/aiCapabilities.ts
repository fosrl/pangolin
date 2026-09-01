import type { Request } from "express";
import { AI_CAPABILITIES, type AiCapability } from "@app/lib/aiCapabilities";

export { AI_CAPABILITIES, type AiCapability };

export type AiCapabilityRoute = {
    method: "GET" | "POST";
    path: string;
};

export type AiProtocolFamily = "openai" | "anthropic" | "google" | "bedrock";

export type AiCapabilityDefinition = {
    id: AiCapability;
    protocolFamily: AiProtocolFamily;
    routes: AiCapabilityRoute[];
    extractModel: (req: Request) => string | undefined;
    resolveUpstreamUrl: (
        baseUrl: string,
        req: Request,
        model: string
    ) => string;
    isStreaming: (req: Request, contentType: string) => boolean;
};

function bodyModel(req: Request): string | undefined {
    return typeof req.body?.model === "string" ? req.body.model : undefined;
}

function paramModel(req: Request): string | undefined {
    const model = req.params?.model;
    return typeof model === "string" && model.length > 0 ? model : undefined;
}

export function joinUpstreamUrl(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    let suffix = path.startsWith("/") ? path : `/${path}`;

    let basePathname = "/";
    try {
        basePathname = new URL(base).pathname.replace(/\/+$/, "") || "/";
    } catch {
        // Fall through with "/" non-absolute bases are not expected in
        // production, but keep joining usable for malformed input.
    }

    if (basePathname !== "/") {
        const baseSegs = basePathname.split("/").filter(Boolean);
        const pathSegs = suffix.split("/").filter(Boolean);
        const max = Math.min(baseSegs.length, pathSegs.length);
        let overlap = 0;
        for (let n = max; n >= 1; n--) {
            const baseSuffix = baseSegs.slice(-n);
            const pathPrefix = pathSegs.slice(0, n);
            if (baseSuffix.every((seg, i) => seg === pathPrefix[i])) {
                overlap = n;
                break;
            }
        }
        if (overlap > 0) {
            const remaining = pathSegs.slice(overlap);
            suffix = remaining.length > 0 ? `/${remaining.join("/")}` : "/";
        }
    }

    if (suffix === "/") {
        return base;
    }

    return `${base}${suffix}`;
}

function pathFromRequest(req: Request): string {
    const raw = req.originalUrl || req.url || req.path;
    return raw.startsWith("/") ? raw : `/${raw}`;
}

function bodyRequestsStream(req: Request): boolean {
    return req.body?.stream === true;
}

function contentTypeIsSse(contentType: string): boolean {
    return contentType.includes("text/event-stream");
}

function contentTypeIsAmazonEventStream(contentType: string): boolean {
    return contentType.includes("application/vnd.amazon.eventstream");
}

function pathIncludes(req: Request, fragment: string): boolean {
    return pathFromRequest(req).includes(fragment);
}

function isBodyOrSseStreaming(req: Request, contentType: string): boolean {
    return bodyRequestsStream(req) || contentTypeIsSse(contentType);
}

function isGeminiStyleStreaming(req: Request, contentType: string): boolean {
    return (
        pathIncludes(req, "streamGenerateContent") ||
        pathIncludes(req, "alt=sse") ||
        contentTypeIsSse(contentType)
    );
}

export const AI_CAPABILITY_DEFS: Record<AiCapability, AiCapabilityDefinition> =
    {
        openai_chat: {
            id: "openai_chat",
            protocolFamily: "openai",
            routes: [
                { method: "POST", path: "/v1/chat/completions" },
                { method: "POST", path: "/chat/completions" }
            ],
            extractModel: bodyModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: isBodyOrSseStreaming
        },
        openai_responses: {
            id: "openai_responses",
            protocolFamily: "openai",
            routes: [{ method: "POST", path: "/v1/responses" }],
            extractModel: bodyModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: isBodyOrSseStreaming
        },
        anthropic_messages: {
            id: "anthropic_messages",
            protocolFamily: "anthropic",
            routes: [{ method: "POST", path: "/v1/messages" }],
            extractModel: bodyModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: isBodyOrSseStreaming
        },
        v1_models: {
            id: "v1_models",
            protocolFamily: "anthropic",
            routes: [
                { method: "GET", path: "/v1/models" },
                { method: "GET", path: "/v1/models/:model" }
            ],
            extractModel: paramModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            // Model listings are answered from the gateway's own view of the
            // provider allow/block lists rather than proxied upstream, so
            // there is never a stream to detect.
            isStreaming: () => false
        },
        gemini_generate_content: {
            id: "gemini_generate_content",
            protocolFamily: "google",
            routes: [
                {
                    method: "POST",
                    path: "/v1beta/models/:model\\:generateContent"
                },
                {
                    method: "POST",
                    path: "/v1beta/models/:model\\:streamGenerateContent"
                }
            ],
            extractModel: paramModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: isGeminiStyleStreaming
        },
        google_generate_content: {
            id: "google_generate_content",
            protocolFamily: "google",
            routes: [
                {
                    method: "POST",
                    // Vertex publisher model generateContent
                    path: "/v1/projects/:project/locations/:location/publishers/:publisher/models/:model\\:generateContent"
                },
                {
                    method: "POST",
                    path: "/v1/projects/:project/locations/:location/publishers/:publisher/models/:model\\:streamGenerateContent"
                }
            ],
            extractModel: paramModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: isGeminiStyleStreaming
        },
        google_raw_predict: {
            id: "google_raw_predict",
            protocolFamily: "google",
            routes: [
                {
                    method: "POST",
                    path: "/v1/projects/:project/locations/:location/publishers/:publisher/models/:model\\:rawPredict"
                },
                {
                    method: "POST",
                    path: "/v1/projects/:project/locations/:location/publishers/:publisher/models/:model\\:streamRawPredict"
                }
            ],
            extractModel: paramModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: (req, contentType) =>
                pathIncludes(req, "streamRawPredict") ||
                pathIncludes(req, "alt=sse") ||
                contentTypeIsSse(contentType)
        },
        bedrock_model_invoke: {
            id: "bedrock_model_invoke",
            protocolFamily: "bedrock",
            routes: [
                { method: "POST", path: "/model/:model/invoke" },
                {
                    method: "POST",
                    path: "/model/:model/invoke-with-response-stream"
                }
            ],
            extractModel: paramModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: (req, contentType) =>
                pathIncludes(req, "invoke-with-response-stream") ||
                contentTypeIsAmazonEventStream(contentType) ||
                contentTypeIsSse(contentType)
        },
        bedrock_converse: {
            id: "bedrock_converse",
            protocolFamily: "bedrock",
            routes: [
                { method: "POST", path: "/model/:model/converse" },
                { method: "POST", path: "/model/:model/converse-stream" }
            ],
            extractModel: paramModel,
            resolveUpstreamUrl: (base, req) =>
                joinUpstreamUrl(base, pathFromRequest(req)),
            isStreaming: (req, contentType) =>
                pathIncludes(req, "converse-stream") ||
                contentTypeIsAmazonEventStream(contentType) ||
                contentTypeIsSse(contentType)
        }
    };

export function isAiCapability(value: unknown): value is AiCapability {
    return (
        typeof value === "string" &&
        (AI_CAPABILITIES as readonly string[]).includes(value)
    );
}

/**
 * Convert an Express-style route path from AI_CAPABILITY_DEFS into a RegExp.
 * Handles `:param` segments and escaped literal colons (`\:`).
 */
export function routePatternToRegExp(routePath: string): RegExp {
    let pattern = "";
    for (let i = 0; i < routePath.length; i++) {
        const ch = routePath[i];
        if (
            ch === "\\" &&
            i + 1 < routePath.length &&
            routePath[i + 1] === ":"
        ) {
            pattern += ":";
            i++;
            continue;
        }
        if (ch === ":") {
            // Named param: consume until next / or end
            i++;
            while (
                i < routePath.length &&
                routePath[i] !== "/" &&
                !(routePath[i] === "\\" && routePath[i + 1] === ":")
            ) {
                i++;
            }
            i--; // loop will ++
            pattern += "[^/]+";
            continue;
        }
        // Escape regex special chars
        if (/[.*+?^${}()|[\]\\]/.test(ch)) {
            pattern += "\\" + ch;
        } else {
            pattern += ch;
        }
    }
    return new RegExp(`^${pattern}$`);
}

export function resolveAiCapabilityFromPath(path: string): AiCapability | null {
    const pathname = path.split("?")[0] || "/";
    const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;

    for (const def of Object.values(AI_CAPABILITY_DEFS)) {
        for (const route of def.routes) {
            if (routePatternToRegExp(route.path).test(normalized)) {
                return def.id;
            }
        }
    }
    return null;
}

export function parseCapabilities(raw: unknown): AiCapability[] {
    if (raw == null) {
        return [];
    }

    let parsed: unknown = raw;
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) {
            return [];
        }
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            return [];
        }
    }

    if (!Array.isArray(parsed)) {
        return [];
    }

    const out: AiCapability[] = [];
    const seen = new Set<AiCapability>();
    for (const item of parsed) {
        if (isAiCapability(item) && !seen.has(item)) {
            seen.add(item);
            out.push(item);
        }
    }
    return out;
}

export function serializeCapabilities(capabilities: AiCapability[]): string {
    return JSON.stringify(capabilities);
}

export function providerHasCapability(
    capabilities: AiCapability[] | string | null | undefined,
    capability: AiCapability
): boolean {
    const list =
        typeof capabilities === "string" || capabilities == null
            ? parseCapabilities(capabilities)
            : capabilities;
    return list.includes(capability);
}
