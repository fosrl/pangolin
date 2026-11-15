import { Response } from "express";
import { stripInjectedUsageFrame } from "@server/lib/aiUsageExtraction";

const RELAYED_AI_GATEWAY_HEADER_NAMES = new Set([
    "retry-after",
    "x-request-id",
    "request-id"
]);

function shouldRelayAiGatewayHeader(name: string): boolean {
    const lower = name.toLowerCase();
    return (
        RELAYED_AI_GATEWAY_HEADER_NAMES.has(lower) ||
        lower.includes("ratelimit")
    );
}

// Candidate header names used as a fallback when the upstream headers object
// only exposes a `.get()` accessor (no enumeration), so we can still relay the
// documented allowlist instead of silently dropping everything.
const RELAYED_AI_GATEWAY_HEADER_CANDIDATES = [
    "retry-after",
    "retry-after-ms",
    "x-request-id",
    "request-id",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "anthropic-ratelimit-requests-limit",
    "anthropic-ratelimit-requests-remaining",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-limit",
    "anthropic-ratelimit-tokens-remaining",
    "anthropic-ratelimit-tokens-reset",
    "ratelimit-limit",
    "ratelimit-remaining",
    "ratelimit-reset",
    "x-ratelimit-bucket"
];

function getRelayedUpstreamHeaders(
    headers: globalThis.Headers | any
): Array<[string, string]> {
    const result: Array<[string, string]> = [];
    const seen = new Set<string>();

    const push = (key: unknown, value: unknown) => {
        if (value == null) return;
        const name = String(key);
        if (!shouldRelayAiGatewayHeader(name)) return;
        const lower = name.toLowerCase();
        if (seen.has(lower)) return;
        seen.add(lower);
        result.push([lower, String(value)]);
    };

    if (headers) {
        if (typeof headers.forEach === "function") {
            headers.forEach((value: unknown, key: unknown) => {
                push(key, value);
            });
            return result;
        }
        if (typeof headers.entries === "function") {
            for (const entry of headers.entries()) {
                if (Array.isArray(entry) && entry.length >= 2) {
                    push(entry[0], entry[1]);
                }
            }
            return result;
        }
        if (typeof headers[Symbol.iterator] === "function") {
            for (const entry of headers) {
                if (Array.isArray(entry) && entry.length >= 2) {
                    push(entry[0], entry[1]);
                }
            }
            return result;
        }
        if (typeof headers.get === "function") {
            for (const name of RELAYED_AI_GATEWAY_HEADER_CANDIDATES) {
                push(name, headers.get(name));
            }
        }
        if (typeof headers === "object") {
            for (const key of Object.keys(headers)) {
                const value = headers[key];
                if (typeof value === "function") continue;
                push(key, value);
            }
        }
    }

    return result;
}

/**
 * Reads an upstream AI provider response, writes it through to the client
 * (streaming or buffered), and returns the full response text once done, so
 * the caller can extract usage/cost and log the completed session. Shared by
 * both the direct-upstream path (pipeline.ts) and the "custom"/target
 * routing-mode path (targetRouting.ts) so usage/cost tracking and session
 * logging apply identically to both instead of each maintaining its own copy
 * of this loop.
 *
 * Callers own fetching the upstream response and the AbortController/
 * `res.on("close", onClientClose)` wiring, since those differ meaningfully
 * between the two transports (direct upstream fetch with TLS-skip support vs
 * a plain fetch to gerbil) - only the "read the stream, write to the client,
 * accumulate the full text" part is actually identical logic between them.
 */
export async function streamAiGatewayResponse(args: {
    res: Response;
    upstreamRes: globalThis.Response;
    isStream: boolean;
    // True when we injected stream_options.include_usage ourselves (the
    // caller didn't ask for it) and need to strip the extra usage-only frame
    // back out of what's forwarded to the client.
    injectedUsageOurselves: boolean;
    abortController: AbortController;
    onClientClose: () => void;
}): Promise<{ fullText: string; aborted: boolean }> {
    const {
        res,
        upstreamRes,
        isStream,
        injectedUsageOurselves,
        abortController,
        onClientClose
    } = args;

    const contentType = upstreamRes.headers.get("content-type") || "";
    res.status(upstreamRes.status);
    res.setHeader("Content-Type", contentType || "application/json");

    // Relay a small allowlist of upstream headers that clients need in order
    // to honour provider backoff hints (Retry-After) and correlate requests
    // (x-request-id / request-id / *ratelimit*). Everything else (content-
    // length, content-encoding, set-cookie, transfer-encoding, ...) is left
    // unforwarded because fetch has already decoded the body.
    for (const [headerName, headerValue] of getRelayedUpstreamHeaders(
        upstreamRes.headers
    )) {
        res.setHeader(headerName, headerValue);
    }

    if (isStream && upstreamRes.body) {
        res.flushHeaders();
        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        // Frame-boundary buffer, only used when we need to filter the
        // usage-only frame we injected out of what reaches the client.
        let sseCarry = "";
        try {
            while (!abortController.signal.aborted) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunkText = decoder.decode(value, { stream: true });
                fullText += chunkText;
                if (injectedUsageOurselves) {
                    sseCarry += chunkText;
                    const lastBoundary = sseCarry.lastIndexOf("\n\n");
                    if (lastBoundary !== -1) {
                        const toEmit = sseCarry.slice(0, lastBoundary + 2);
                        sseCarry = sseCarry.slice(lastBoundary + 2);
                        res.write(stripInjectedUsageFrame(toEmit));
                    }
                } else {
                    res.write(value);
                }
            }
            if (injectedUsageOurselves && sseCarry) {
                res.write(stripInjectedUsageFrame(sseCarry));
            }
        } finally {
            await reader.cancel().catch(() => {});
            res.off("close", onClientClose);
        }
        if (!res.writableEnded) {
            res.end();
        }
        return { fullText, aborted: abortController.signal.aborted };
    }

    res.off("close", onClientClose);
    const text = await upstreamRes.text();
    res.send(text);
    return { fullText: text, aborted: abortController.signal.aborted };
}
