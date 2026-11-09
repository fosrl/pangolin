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

// A Responses API stream that stops early (max_output_tokens) ends with
// `response.incomplete`, which carries the same `response.usage` as
// `response.completed`.
function testOpenAiResponsesIncompleteStream() {
    console.log("Running OpenAI Responses incomplete stream test...");
    const body =
        'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
        'data: {"type":"response.incomplete","response":{"status":"incomplete","usage":{"input_tokens":50,"input_tokens_details":{"cached_tokens":10},"output_tokens":30,"output_tokens_details":{"reasoning_tokens":5}}}}\n\n';
    assertEqualsObj(
        extractUsage("openai_responses", body, true, headers),
        {
            promptTokens: 40,
            cacheReadTokens: 10,
            cacheWriteTokens: 0,
            completionTokens: 25,
            reasoningTokens: 5,
            estimated: false
        },
        "usage is read from response.incomplete"
    );
}

try {
    testConverseJsonWithCache();
    testConverseStreamWithCache();
    testConverseWithoutCache();
    testGeminiToolUsePromptTokens();
    testOpenAiResponsesIncompleteStream();
    console.log("All aiUsageExtraction tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
