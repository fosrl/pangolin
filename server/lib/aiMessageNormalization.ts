import type { AiCapability } from "@server/lib/aiCapabilities";
import { sseDataFrames, tryParseJson } from "@server/lib/aiUsageExtraction";
import logger from "@server/logger";

// Uniform, capability-agnostic representation of a chat message, used so
// the AI session log can be searched/displayed the same way regardless of
// which provider/capability produced it. Content is flattened to plain text
// - non-text parts (images, tool calls/results) are rendered as readable
// placeholders rather than preserved as structured data, which is enough for
// a transcript-style replay view without a per-capability renderer.
export type NormalizedRole = "system" | "user" | "assistant" | "tool";

export type NormalizedAiMessage = {
    role: NormalizedRole;
    content: string;
};

function normalizeRole(role: unknown): NormalizedRole {
    if (
        role === "system" ||
        role === "user" ||
        role === "assistant" ||
        role === "tool"
    ) {
        return role;
    }
    if (role === "model") return "assistant"; // Gemini
    if (role === "function") return "tool"; // OpenAI legacy function role
    return "user";
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return "";
    }
}

/**
 * Flattens one message "part"/"block" (OpenAI content parts, Anthropic
 * content blocks, Gemini parts, Bedrock converse content blocks - they all
 * follow the same rough shape) into readable text.
 */
function flattenContentPart(part: unknown): string {
    if (typeof part === "string") return part;
    if (part == null || typeof part !== "object") return "";
    const p = part as Record<string, unknown>;

    if (typeof p.text === "string") return p.text;

    if (
        p.type === "image_url" ||
        p.type === "image" ||
        p.type === "input_image" ||
        p.type === "output_image" ||
        "inlineData" in p
    ) {
        return "[image]";
    }

    // Anthropic-style tool_use / tool_result blocks
    if (p.type === "tool_use") {
        const name = typeof p.name === "string" ? p.name : "tool";
        return `[tool_call: ${name}(${safeJsonStringify(p.input)})]`;
    }
    if (p.type === "tool_result") {
        const content = p.content;
        const text =
            typeof content === "string"
                ? content
                : Array.isArray(content)
                  ? flattenContentParts(content)
                  : "";
        return `[tool_result: ${text}]`;
    }

    // Gemini-style functionCall / functionResponse parts
    if (p.functionCall && typeof p.functionCall === "object") {
        const fc = p.functionCall as Record<string, unknown>;
        return `[tool_call: ${fc.name}(${safeJsonStringify(fc.args)})]`;
    }
    if (p.functionResponse && typeof p.functionResponse === "object") {
        const fr = p.functionResponse as Record<string, unknown>;
        return `[tool_result: ${fr.name}(${safeJsonStringify(fr.response)})]`;
    }

    // Bedrock converse-style toolUse / toolResult content blocks
    if (p.toolUse && typeof p.toolUse === "object") {
        const tu = p.toolUse as Record<string, unknown>;
        return `[tool_call: ${tu.name}(${safeJsonStringify(tu.input)})]`;
    }
    if (p.toolResult && typeof p.toolResult === "object") {
        const tr = p.toolResult as Record<string, unknown>;
        const content = tr.content;
        const text = Array.isArray(content) ? flattenContentParts(content) : "";
        return `[tool_result: ${text}]`;
    }

    return "";
}

function flattenContentParts(parts: unknown[]): string {
    return parts.map(flattenContentPart).join("");
}

function flattenContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return flattenContentParts(content);
    return "";
}

/**
 * Best-effort scan for every `"text":"..."` JSON string value in raw text,
 * concatenated in order. Fallback for streaming formats we can't fully parse
 * as JSON/SSE (Gemini's array-JSON stream, Bedrock's binary event-stream
 * framing) - same spirit as aiUsageExtraction's scanNumericFields.
 */
function scanTextFragments(text: string): string {
    const out: string[] = [];
    const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        try {
            out.push(JSON.parse(`"${match[1]}"`));
        } catch {
            out.push(match[1]);
        }
    }
    return out.join("");
}

// ---------------------------------------------------------------------------
// Request (input) normalizers - operate on the already-parsed outbound body.
// ---------------------------------------------------------------------------

function normalizeOpenAiChatRequest(body: any): NormalizedAiMessage[] {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    return messages.map((m: any) => ({
        role: normalizeRole(m?.role),
        content: flattenContent(m?.content)
    }));
}

function normalizeOpenAiResponsesRequest(body: any): NormalizedAiMessage[] {
    const out: NormalizedAiMessage[] = [];
    if (typeof body?.instructions === "string" && body.instructions) {
        out.push({ role: "system", content: body.instructions });
    }
    const input = body?.input;
    if (typeof input === "string") {
        out.push({ role: "user", content: input });
    } else if (Array.isArray(input)) {
        for (const item of input) {
            if (item?.role) {
                out.push({
                    role: normalizeRole(item.role),
                    content: flattenContent(item.content)
                });
            } else if (typeof item?.type === "string") {
                out.push({ role: "tool", content: `[${item.type}]` });
            }
        }
    }
    return out;
}

function normalizeAnthropicRequest(body: any): NormalizedAiMessage[] {
    const out: NormalizedAiMessage[] = [];
    if (body?.system) {
        const sys = flattenContent(body.system);
        if (sys) out.push({ role: "system", content: sys });
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (const m of messages) {
        out.push({
            role: normalizeRole(m?.role),
            content: flattenContent(m?.content)
        });
    }
    return out;
}

function normalizeGeminiRequest(body: any): NormalizedAiMessage[] {
    const out: NormalizedAiMessage[] = [];
    const sysParts = body?.systemInstruction?.parts;
    if (Array.isArray(sysParts)) {
        const text = flattenContentParts(sysParts);
        if (text) out.push({ role: "system", content: text });
    }
    const contents = Array.isArray(body?.contents) ? body.contents : [];
    for (const c of contents) {
        out.push({
            role: normalizeRole(c?.role),
            content: Array.isArray(c?.parts) ? flattenContentParts(c.parts) : ""
        });
    }
    return out;
}

function normalizeBedrockConverseRequest(body: any): NormalizedAiMessage[] {
    const out: NormalizedAiMessage[] = [];
    if (Array.isArray(body?.system)) {
        const text = flattenContentParts(body.system);
        if (text) out.push({ role: "system", content: text });
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (const m of messages) {
        out.push({
            role: normalizeRole(m?.role),
            content: Array.isArray(m?.content)
                ? flattenContentParts(m.content)
                : ""
        });
    }
    return out;
}

/**
 * bedrock_model_invoke and google_raw_predict are passthroughs - the body
 * shape depends entirely on the underlying model, not the capability. Try
 * the two shapes we're most likely to see (Anthropic Claude, then plain
 * OpenAI-style) and give up otherwise, same fallback spirit
 * aiUsageExtraction.ts uses for these two capabilities' usage extraction.
 */
function normalizeBestEffortRequest(body: any): NormalizedAiMessage[] | null {
    if (!Array.isArray(body?.messages)) return null;
    const looksAnthropicShaped = body.messages.some((m: any) =>
        Array.isArray(m?.content)
    );
    return looksAnthropicShaped
        ? normalizeAnthropicRequest(body)
        : normalizeOpenAiChatRequest(body);
}

// ---------------------------------------------------------------------------
// Response (output) normalizers - operate on the raw response text, which
// may be a single JSON document (non-streaming) or provider-framed streaming
// text (SSE `data:` frames, a JSON-array stream, or binary event-stream
// framing with JSON payloads embedded in it).
// ---------------------------------------------------------------------------

function normalizeOpenAiChatResponse(
    text: string,
    isStream: boolean
): NormalizedAiMessage[] | null {
    if (isStream) {
        let role: unknown = "assistant";
        let content = "";
        let found = false;
        for (const frame of sseDataFrames(text)) {
            const delta = tryParseJson(frame)?.choices?.[0]?.delta;
            if (!delta) continue;
            found = true;
            if (typeof delta.role === "string") role = delta.role;
            if (typeof delta.content === "string") content += delta.content;
        }
        return found ? [{ role: normalizeRole(role), content }] : null;
    }

    const message = tryParseJson(text)?.choices?.[0]?.message;
    if (!message) return null;
    return [
        {
            role: normalizeRole(message.role),
            content: flattenContent(message.content)
        }
    ];
}

function extractOpenAiResponsesOutputText(response: any): string | null {
    if (typeof response?.output_text === "string") return response.output_text;
    const output = Array.isArray(response?.output) ? response.output : [];
    const pieces: string[] = [];
    for (const item of output) {
        if (item?.type === "message" && Array.isArray(item.content)) {
            pieces.push(flattenContentParts(item.content));
        }
    }
    return pieces.length > 0 ? pieces.join("") : null;
}

function normalizeOpenAiResponsesResponse(
    text: string,
    isStream: boolean
): NormalizedAiMessage[] | null {
    if (isStream) {
        let content = "";
        let found = false;
        for (const frame of sseDataFrames(text)) {
            const parsed = tryParseJson(frame);
            if (!parsed) continue;
            if (
                parsed.type === "response.output_text.delta" &&
                typeof parsed.delta === "string"
            ) {
                content += parsed.delta;
                found = true;
            } else if (
                parsed.type === "response.completed" &&
                parsed.response
            ) {
                const outputText = extractOpenAiResponsesOutputText(
                    parsed.response
                );
                if (outputText != null) {
                    content = outputText;
                    found = true;
                }
            }
        }
        return found ? [{ role: "assistant", content }] : null;
    }

    const parsed = tryParseJson(text);
    const outputText = extractOpenAiResponsesOutputText(
        parsed?.response ?? parsed
    );
    return outputText != null
        ? [{ role: "assistant", content: outputText }]
        : null;
}

function normalizeAnthropicResponse(
    text: string,
    isStream: boolean
): NormalizedAiMessage[] | null {
    if (isStream) {
        let role: unknown = "assistant";
        let content = "";
        let found = false;
        for (const frame of sseDataFrames(text)) {
            const parsed = tryParseJson(frame);
            if (!parsed) continue;
            if (parsed.type === "message_start" && parsed.message?.role) {
                role = parsed.message.role;
            }
            if (
                parsed.type === "content_block_start" &&
                parsed.content_block?.type === "tool_use"
            ) {
                const name = parsed.content_block.name ?? "tool";
                content += `[tool_call: ${name}]`;
                found = true;
            }
            if (
                parsed.type === "content_block_delta" &&
                typeof parsed.delta?.text === "string"
            ) {
                content += parsed.delta.text;
                found = true;
            }
        }
        return found ? [{ role: normalizeRole(role), content }] : null;
    }

    const parsed = tryParseJson(text);
    if (!parsed || !Array.isArray(parsed.content)) return null;
    return [
        {
            role: normalizeRole(parsed.role ?? "assistant"),
            content: flattenContentParts(parsed.content)
        }
    ];
}

function geminiCandidateParts(node: any): string {
    const parts = node?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? flattenContentParts(parts) : "";
}

function normalizeGeminiResponse(
    text: string,
    _isStream: boolean
): NormalizedAiMessage[] | null {
    const frames = sseDataFrames(text);
    let content = "";
    let role: unknown = "model";
    let found = false;

    if (frames.length > 0) {
        for (const frame of frames) {
            const parsed = tryParseJson(frame);
            const piece = geminiCandidateParts(parsed);
            if (piece) {
                content += piece;
                found = true;
            }
            const r = parsed?.candidates?.[0]?.content?.role;
            if (r) role = r;
        }
    } else {
        const parsed = tryParseJson(text);
        if (Array.isArray(parsed)) {
            for (const chunk of parsed) {
                const piece = geminiCandidateParts(chunk);
                if (piece) {
                    content += piece;
                    found = true;
                }
                const r = chunk?.candidates?.[0]?.content?.role;
                if (r) role = r;
            }
        } else if (parsed) {
            const piece = geminiCandidateParts(parsed);
            if (piece) {
                content = piece;
                found = true;
            }
            const r = parsed?.candidates?.[0]?.content?.role;
            if (r) role = r;
        }
    }

    if (!found) {
        const scanned = scanTextFragments(text);
        return scanned
            ? [{ role: normalizeRole(role), content: scanned }]
            : null;
    }
    return [{ role: normalizeRole(role), content }];
}

function normalizeBedrockConverseResponse(
    text: string,
    isStream: boolean
): NormalizedAiMessage[] | null {
    if (!isStream) {
        const message = tryParseJson(text)?.output?.message;
        if (!message) return null;
        return [
            {
                role: normalizeRole(message.role ?? "assistant"),
                content: Array.isArray(message.content)
                    ? flattenContentParts(message.content)
                    : ""
            }
        ];
    }
    // converse-stream uses AWS's binary event-stream framing, but the JSON
    // payload of each event survives intact inside it (same assumption
    // aiUsageExtraction.ts makes for usage) - scan for the text pieces.
    const scanned = scanTextFragments(text);
    return scanned ? [{ role: "assistant", content: scanned }] : null;
}

function normalizeBedrockModelInvokeResponse(
    text: string,
    isStream: boolean
): NormalizedAiMessage[] | null {
    const anthropicStyle = normalizeAnthropicResponse(text, isStream);
    if (anthropicStyle) return anthropicStyle;
    const scanned = scanTextFragments(text);
    return scanned ? [{ role: "assistant", content: scanned }] : null;
}

function normalizeGoogleRawPredictResponse(
    text: string,
    isStream: boolean
): NormalizedAiMessage[] | null {
    const anthropicStyle = normalizeAnthropicResponse(text, isStream);
    if (anthropicStyle) return anthropicStyle;
    const scanned = scanTextFragments(text);
    return scanned ? [{ role: "assistant", content: scanned }] : null;
}

const REQUEST_NORMALIZERS: Record<
    AiCapability,
    (body: any) => NormalizedAiMessage[] | null
> = {
    openai_chat: normalizeOpenAiChatRequest,
    openai_responses: normalizeOpenAiResponsesRequest,
    anthropic_messages: normalizeAnthropicRequest,
    // Model discovery carries no transcript to normalize.
    v1_models: () => null,
    gemini_generate_content: normalizeGeminiRequest,
    google_generate_content: normalizeGeminiRequest,
    google_raw_predict: normalizeBestEffortRequest,
    bedrock_model_invoke: normalizeBestEffortRequest,
    bedrock_converse: normalizeBedrockConverseRequest
};

const RESPONSE_NORMALIZERS: Record<
    AiCapability,
    (text: string, isStream: boolean) => NormalizedAiMessage[] | null
> = {
    openai_chat: normalizeOpenAiChatResponse,
    openai_responses: normalizeOpenAiResponsesResponse,
    anthropic_messages: normalizeAnthropicResponse,
    v1_models: () => null,
    gemini_generate_content: normalizeGeminiResponse,
    google_generate_content: normalizeGeminiResponse,
    google_raw_predict: normalizeGoogleRawPredictResponse,
    bedrock_model_invoke: normalizeBedrockModelInvokeResponse,
    bedrock_converse: normalizeBedrockConverseResponse
};

/**
 * Normalizes an outbound AI gateway request body into a uniform message
 * transcript, regardless of capability/provider. Returns null if the body
 * doesn't contain any recognizable messages (or parsing failed) - callers
 * should fall back to showing the raw request body.
 */
export function normalizeAiRequest(
    capability: AiCapability,
    body: unknown
): NormalizedAiMessage[] | null {
    try {
        const result = REQUEST_NORMALIZERS[capability](body);
        return result && result.length > 0 ? result : null;
    } catch (error) {
        logger.debug("Failed to normalize AI request messages", {
            capability,
            error
        });
        return null;
    }
}

/**
 * Normalizes a completed (non-streaming or fully-accumulated streaming) AI
 * gateway response into a uniform message transcript. Returns null if
 * nothing recognizable could be extracted - callers should fall back to
 * showing the raw response body.
 */
export function normalizeAiResponse(
    capability: AiCapability,
    responseText: string,
    isStream: boolean
): NormalizedAiMessage[] | null {
    try {
        const result = RESPONSE_NORMALIZERS[capability](responseText, isStream);
        return result && result.length > 0 ? result : null;
    } catch (error) {
        logger.debug("Failed to normalize AI response messages", {
            capability,
            error
        });
        return null;
    }
}
