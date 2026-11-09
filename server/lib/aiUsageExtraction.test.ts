import { extractUsage } from "./aiUsageExtraction";
import { assertEqualsObj } from "@test/assert";

// Bedrock reports `inputTokens` as the NON-cached input tokens when prompt
// caching is on; cache reads/writes are separate counters. So `promptTokens`
// (input billed at the normal rate) must equal `inputTokens` as-is.

const headers = new Headers();

function testConverseJsonWithCache() {
    console.log("Running Bedrock Converse JSON cache usage test...");
    const body = JSON.stringify({
        usage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 1120,
            cacheReadInputTokens: 800,
            cacheWriteInputTokens: 200
        }
    });
    assertEqualsObj(
        extractUsage("bedrock_converse", body, false, headers),
        {
            promptTokens: 100,
            cacheReadTokens: 800,
            cacheWriteTokens: 200,
            completionTokens: 20,
            reasoningTokens: 0,
            estimated: false
        },
        "cache reads must not be subtracted from inputTokens"
    );
}

function testConverseStreamWithCache() {
    console.log("Running Bedrock Converse stream cache usage test...");
    // converse-stream frames the metadata event in binary envelope; the JSON
    // text survives inside it, so it is not valid JSON as a whole.
    const body =
        '\u0000\u0001{"metrics":{"latencyMs":5},"usage":{"cacheReadInputTokens":800,' +
        '"cacheWriteInputTokens":0,"inputTokens":100,"outputTokens":20,"totalTokens":920}}\u0002';
    assertEqualsObj(
        extractUsage("bedrock_converse", body, true, headers),
        {
            promptTokens: 100,
            cacheReadTokens: 800,
            cacheWriteTokens: 0,
            completionTokens: 20,
            reasoningTokens: 0,
            estimated: false
        },
        "streamed cache reads must not be subtracted from inputTokens"
    );
}

function testConverseWithoutCache() {
    console.log("Running Bedrock Converse no-cache usage test...");
    const body = JSON.stringify({
        usage: { inputTokens: 50, outputTokens: 7, totalTokens: 57 }
    });
    assertEqualsObj(
        extractUsage("bedrock_converse", body, false, headers),
        {
            promptTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            completionTokens: 7,
            reasoningTokens: 0,
            estimated: false
        },
        "uncached usage is unchanged"
    );
}

// invoke-with-response-stream wraps each model event as
// {"bytes":"<base64 of the event JSON>","p":"..."} inside event-stream frames.
function frame(event: object): string {
    const b64 = Buffer.from(JSON.stringify(event)).toString("base64");
    return `\u0000\u0001{"bytes":"${b64}","p":"abc"}\u0002`;
}

function testInvokeStreamAnthropicChunks() {
    console.log("Running Bedrock invoke stream (Anthropic chunks) test...");
    const body = [
        frame({
            type: "message_start",
            message: {
                usage: {
                    input_tokens: 100,
                    cache_read_input_tokens: 800,
                    cache_creation_input_tokens: 0,
                    output_tokens: 1
                }
            }
        }),
        frame({ type: "message_delta", usage: { output_tokens: 20 } }),
        frame({ type: "message_stop" })
    ].join("");
    assertEqualsObj(
        extractUsage("bedrock_model_invoke", body, true, headers),
        {
            promptTokens: 100,
            cacheReadTokens: 800,
            cacheWriteTokens: 0,
            completionTokens: 20,
            reasoningTokens: 0,
            estimated: false
        },
        "usage inside base64 chunks must be read"
    );
}

function testInvokeStreamInvocationMetrics() {
    console.log("Running Bedrock invoke stream (invocationMetrics) test...");
    const body = frame({
        "amazon-bedrock-invocationMetrics": {
            inputTokenCount: 100,
            outputTokenCount: 20
        }
    });
    assertEqualsObj(
        extractUsage("bedrock_model_invoke", body, true, headers),
        {
            promptTokens: 100,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            completionTokens: 20,
            reasoningTokens: 0,
            estimated: false
        },
        "invocationMetrics inside base64 chunks must be read"
    );
}

function testInvokeHeadersStillWin() {
    console.log("Running Bedrock invoke header usage test...");
    const h = new Headers({
        "x-amzn-bedrock-input-token-count": "7",
        "x-amzn-bedrock-output-token-count": "3"
    });
    assertEqualsObj(
        extractUsage("bedrock_model_invoke", "{}", false, h),
        {
            promptTokens: 7,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            completionTokens: 3,
            reasoningTokens: 0,
            estimated: false
        },
        "headers keep priority"
    );
}

// Gemini reports tool-result tokens (Google Search, URL context) in
// `toolUsePromptTokenCount`, separately from `promptTokenCount`; they are
// billed as input.
function testGeminiToolUsePromptTokens() {
    console.log("Running Gemini tool-use prompt tokens test...");
    const body = JSON.stringify({
        usageMetadata: {
            promptTokenCount: 100,
            cachedContentTokenCount: 20,
            toolUsePromptTokenCount: 40,
            candidatesTokenCount: 15,
            thoughtsTokenCount: 5,
            totalTokenCount: 160
        }
    });
    assertEqualsObj(
        extractUsage("gemini_generate_content", body, false, headers),
        {
            promptTokens: 120,
            cacheReadTokens: 20,
            cacheWriteTokens: 0,
            completionTokens: 15,
            reasoningTokens: 5,
            estimated: false
        },
        "tool-use prompt tokens are added to promptTokens"
    );
}

try {
    testConverseJsonWithCache();
    testConverseStreamWithCache();
    testConverseWithoutCache();
    testInvokeStreamAnthropicChunks();
    testInvokeStreamInvocationMetrics();
    testInvokeHeadersStillWin();
    testGeminiToolUsePromptTokens();
    console.log("All aiUsageExtraction tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
