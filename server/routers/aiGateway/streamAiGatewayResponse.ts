import { Response } from "express";
import { stripInjectedUsageFrame } from "@server/lib/aiUsageExtraction";

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
