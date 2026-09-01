import { encode } from "gpt-tokenizer";
import type { AiCapability } from "@server/lib/aiCapabilities";
import logger from "@server/logger";

export type AiUsage = {
    // Input tokens billed at the normal input rate (i.e. NOT already
    // covered by cacheReadTokens/cacheWriteTokens below).
    promptTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    // Output tokens billed at the normal output rate (i.e. NOT already
    // covered by reasoningTokens below).
    completionTokens: number;
    reasoningTokens: number;
    // True when these numbers are our own best-guess estimate (the upstream
    // response didn't report usage), rather than provider-reported figures.
    estimated: boolean;
};

export function emptyUsage(): AiUsage {
    return {
        promptTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        estimated: false
    };
}

/**
 * Scans raw (possibly binary-framed, e.g. Bedrock's vnd.amazon.eventstream)
 * text for `"fieldName":123` occurrences and returns the last value seen for
 * each field. Used as a best-effort fallback for response shapes we can't
 * fully parse as JSON/SSE (streaming Bedrock, raw predict passthroughs).
 */
function scanNumericFields(
    text: string,
    fields: string[]
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const field of fields) {
        const re = new RegExp(`"${field}"\\s*:\\s*(\\d+)`, "g");
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
            out[field] = Number(match[1]);
        }
    }
    return out;
}

// Exported for reuse by server/lib/aiMessageNormalization.ts, which needs
// the same SSE-frame/JSON-parsing groundwork to extract message content
// instead of usage numbers.
export function sseDataFrames(text: string): string[] {
    const frames: string[] = [];
    for (const rawFrame of text.split(/\r?\n\r?\n/)) {
        for (const line of rawFrame.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice("data:".length).trim();
            if (data && data !== "[DONE]") {
                frames.push(data);
            }
        }
    }
    return frames;
}

export function tryParseJson(text: string): any | null {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function extractOpenAiChat(text: string, isStream: boolean): AiUsage | null {
    let usage: any = null;

    if (isStream) {
        for (const frame of sseDataFrames(text)) {
            const parsed = tryParseJson(frame);
            if (parsed?.usage) {
                usage = parsed.usage;
            }
        }
    } else {
        usage = tryParseJson(text)?.usage ?? null;
    }

    if (!usage) {
        return null;
    }

    const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const reasoningTokens =
        usage.completion_tokens_details?.reasoning_tokens ?? 0;

    return {
        promptTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cacheReadTokens),
        cacheReadTokens,
        cacheWriteTokens: 0,
        completionTokens: Math.max(
            0,
            (usage.completion_tokens ?? 0) - reasoningTokens
        ),
        reasoningTokens,
        estimated: false
    };
}

function extractOpenAiResponses(
    text: string,
    isStream: boolean
): AiUsage | null {
    let usage: any = null;

    if (isStream) {
        for (const frame of sseDataFrames(text)) {
            const parsed = tryParseJson(frame);
            if (
                parsed?.type === "response.completed" &&
                parsed?.response?.usage
            ) {
                usage = parsed.response.usage;
            } else if (parsed?.usage) {
                usage = parsed.usage;
            }
        }
    } else {
        const parsed = tryParseJson(text);
        usage = parsed?.usage ?? parsed?.response?.usage ?? null;
    }

    if (!usage) {
        return null;
    }

    const cacheReadTokens = usage.input_tokens_details?.cached_tokens ?? 0;
    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;

    return {
        promptTokens: Math.max(0, (usage.input_tokens ?? 0) - cacheReadTokens),
        cacheReadTokens,
        cacheWriteTokens: 0,
        completionTokens: Math.max(
            0,
            (usage.output_tokens ?? 0) - reasoningTokens
        ),
        reasoningTokens,
        estimated: false
    };
}

function extractAnthropicMessages(
    text: string,
    isStream: boolean
): AiUsage | null {
    let inputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let outputTokens = 0;
    let found = false;

    const applyUsage = (usage: any) => {
        if (!usage) return;
        found = true;
        if (typeof usage.input_tokens === "number") {
            inputTokens = usage.input_tokens;
        }
        if (typeof usage.cache_read_input_tokens === "number") {
            cacheReadTokens = usage.cache_read_input_tokens;
        }
        if (typeof usage.cache_creation_input_tokens === "number") {
            cacheWriteTokens = usage.cache_creation_input_tokens;
        }
        if (typeof usage.output_tokens === "number") {
            outputTokens = usage.output_tokens;
        }
    };

    if (isStream) {
        for (const frame of sseDataFrames(text)) {
            const parsed = tryParseJson(frame);
            if (!parsed) continue;
            applyUsage(parsed.message?.usage);
            applyUsage(parsed.usage);
        }
    } else {
        applyUsage(tryParseJson(text)?.usage);
    }

    if (!found) {
        return null;
    }

    return {
        promptTokens: inputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        completionTokens: outputTokens,
        // Anthropic bills extended-thinking output at the normal output
        // rate, so there's no separate reasoning bucket to report.
        reasoningTokens: 0,
        estimated: false
    };
}

function extractGoogleGenerateContent(
    text: string,
    _isStream: boolean
): AiUsage | null {
    // Both the plain-JSON-array stream format and the SSE (?alt=sse) format
    // repeat a cumulative `usageMetadata` object per chunk; the regex scan
    // below naturally picks up the last (most complete) one either way.
    const fields = scanNumericFields(text, [
        "promptTokenCount",
        "candidatesTokenCount",
        "cachedContentTokenCount",
        "thoughtsTokenCount"
    ]);

    if (fields.promptTokenCount === undefined) {
        return null;
    }

    const cacheReadTokens = fields.cachedContentTokenCount ?? 0;
    const reasoningTokens = fields.thoughtsTokenCount ?? 0;

    return {
        promptTokens: Math.max(0, fields.promptTokenCount - cacheReadTokens),
        cacheReadTokens,
        cacheWriteTokens: 0,
        completionTokens: fields.candidatesTokenCount ?? 0,
        reasoningTokens,
        estimated: false
    };
}

function extractBedrockConverse(
    text: string,
    _isStream: boolean
): AiUsage | null {
    // Non-streaming responses are plain JSON; converse-stream frames the
    // final `metadata` event's usage object inside binary event-stream
    // framing, but the JSON text survives intact inside that binary
    // envelope, so the same field scan works for both.
    const parsed = tryParseJson(text);
    const usage = parsed?.usage;
    if (usage) {
        const cacheReadTokens = usage.cacheReadInputTokens ?? 0;
        return {
            promptTokens: Math.max(
                0,
                (usage.inputTokens ?? 0) - cacheReadTokens
            ),
            cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteInputTokens ?? 0,
            completionTokens: usage.outputTokens ?? 0,
            reasoningTokens: 0,
            estimated: false
        };
    }

    const fields = scanNumericFields(text, [
        "inputTokens",
        "outputTokens",
        "cacheReadInputTokens",
        "cacheWriteInputTokens"
    ]);
    if (fields.inputTokens === undefined) {
        return null;
    }
    const cacheReadTokens = fields.cacheReadInputTokens ?? 0;
    return {
        promptTokens: Math.max(0, fields.inputTokens - cacheReadTokens),
        cacheReadTokens,
        cacheWriteTokens: fields.cacheWriteInputTokens ?? 0,
        completionTokens: fields.outputTokens ?? 0,
        reasoningTokens: 0,
        estimated: false
    };
}

function extractBedrockModelInvoke(
    text: string,
    _isStream: boolean,
    headers: Headers
): AiUsage | null {
    // Non-streaming invoke reports counts via response headers regardless
    // of the underlying model's payload format.
    const headerInput = headers.get("x-amzn-bedrock-input-token-count");
    const headerOutput = headers.get("x-amzn-bedrock-output-token-count");
    if (headerInput !== null || headerOutput !== null) {
        return {
            promptTokens: Number(headerInput ?? 0),
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            completionTokens: Number(headerOutput ?? 0),
            reasoningTokens: 0,
            estimated: false
        };
    }

    // invoke-with-response-stream has no equivalent headers; the model's
    // own usage shape (frequently Anthropic-style on Bedrock) is embedded
    // inside binary event-stream framing, so fall back to a couple of
    // known field-name shapes via regex.
    const anthropicStyle = extractAnthropicMessages(text, true);
    if (anthropicStyle) {
        return anthropicStyle;
    }

    const fields = scanNumericFields(text, [
        "inputTokenCount",
        "outputTokenCount"
    ]);
    if (fields.inputTokenCount === undefined) {
        return null;
    }
    return {
        promptTokens: fields.inputTokenCount,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        completionTokens: fields.outputTokenCount ?? 0,
        reasoningTokens: 0,
        estimated: false
    };
}

const EXTRACTORS: Record<
    AiCapability,
    (text: string, isStream: boolean, headers: Headers) => AiUsage | null
> = {
    openai_chat: extractOpenAiChat,
    openai_responses: extractOpenAiResponses,
    anthropic_messages: extractAnthropicMessages,
    // Model discovery never runs a model, so there are no tokens to bill.
    v1_models: () => null,
    gemini_generate_content: extractGoogleGenerateContent,
    google_generate_content: extractGoogleGenerateContent,
    // rawPredict is a passthrough to whatever the underlying publisher
    // model speaks (often Anthropic-shaped on Vertex); try that, then give
    // up to the token-count estimate.
    google_raw_predict: (text, isStream) =>
        extractAnthropicMessages(text, isStream),
    bedrock_model_invoke: extractBedrockModelInvoke,
    bedrock_converse: extractBedrockConverse
};

/**
 * Attempts to pull provider-reported token usage out of an upstream AI
 * gateway response. Returns null if the response didn't contain (or we
 * couldn't find) usage data, in which case callers should fall back to
 * `estimateUsage`.
 */
export function extractUsage(
    capability: AiCapability,
    responseText: string,
    isStream: boolean,
    headers: Headers
): AiUsage | null {
    try {
        return EXTRACTORS[capability](responseText, isStream, headers);
    } catch (error) {
        logger.debug("Failed to extract AI usage from response", {
            capability,
            error
        });
        return null;
    }
}

/**
 * Best-guess token estimate for when the provider doesn't report usage.
 * Uses OpenAI's BPE tokenizer as a stand-in for whatever tokenizer the
 * actual model uses - close enough for an approximate cost figure, not
 * exact for non-OpenAI models.
 */
export function estimateUsage(
    promptText: string,
    completionText: string
): AiUsage {
    const usage = emptyUsage();
    usage.estimated = true;
    try {
        usage.promptTokens = promptText ? encode(promptText).length : 0;
    } catch (error) {
        logger.debug("Failed to estimate prompt tokens", { error });
    }
    try {
        usage.completionTokens = completionText
            ? encode(completionText).length
            : 0;
    } catch (error) {
        logger.debug("Failed to estimate completion tokens", { error });
    }
    return usage;
}

/**
 * OpenAI's Chat Completions API only includes a `usage` field in a
 * streaming response when the request opts in via `stream_options:
 * {include_usage: true}` - unlike the Responses API, Anthropic, Gemini and
 * Bedrock, which report usage in a streaming response by default. Returns
 * whether we need to inject that option ourselves to be able to track cost.
 */
export function needsStreamUsageInjection(
    capability: AiCapability,
    body: any
): boolean {
    return (
        capability === "openai_chat" &&
        body?.stream === true &&
        body?.stream_options?.include_usage !== true
    );
}

/**
 * Returns a shallow-cloned body with `stream_options.include_usage`
 * injected, for capabilities/requests where `needsStreamUsageInjection`
 * is true. Leaves the original body untouched.
 */
export function withStreamUsageOption(body: any): any {
    return {
        ...body,
        stream_options: { ...body.stream_options, include_usage: true }
    };
}

/**
 * When we injected stream_options.include_usage ourselves (the caller
 * didn't ask for it), OpenAI appends an extra terminal SSE frame with an
 * empty `choices: []` array carrying only the usage data. Callers that
 * don't expect that shape (most minimal SSE parsers assume a non-empty
 * choices array) shouldn't see it, so it's stripped back out of the bytes
 * forwarded to the client.
 */
export function stripInjectedUsageFrame(sseText: string): string {
    const parts = sseText.split(/(\r?\n\r?\n)/);
    let out = "";
    for (let i = 0; i < parts.length; i += 2) {
        const frame = parts[i];
        const separator = parts[i + 1] ?? "";
        const dataLine = frame
            .split(/\r?\n/)
            .find((line) => line.startsWith("data:"));
        if (dataLine) {
            const data = dataLine.slice("data:".length).trim();
            const parsed = data !== "[DONE]" ? tryParseJson(data) : null;
            if (
                parsed &&
                Array.isArray(parsed.choices) &&
                parsed.choices.length === 0 &&
                parsed.usage
            ) {
                continue;
            }
        }
        out += frame + separator;
    }
    return out;
}

/**
 * Best-effort extraction of the model the upstream provider actually
 * served, which some gateways/routers echo back and which may differ from
 * the model the caller requested (e.g. an alias resolving to a dated
 * snapshot). Falls back to the caller's requested model when absent.
 */
export function extractResponseModel(responseText: string): string | null {
    const match = responseText.match(/"model"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
}

export function isUsageEmpty(usage: AiUsage): boolean {
    return (
        usage.promptTokens === 0 &&
        usage.cacheReadTokens === 0 &&
        usage.cacheWriteTokens === 0 &&
        usage.completionTokens === 0 &&
        usage.reasoningTokens === 0
    );
}
