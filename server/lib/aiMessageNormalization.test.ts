import {
    normalizeAiRequest,
    normalizeAiResponse
} from "./aiMessageNormalization";
import { assertEqualsObj } from "@test/assert";

// Tool calls carry no text content, so before they were rendered the session
// log showed an empty assistant message for OpenAI chat / Responses turns.

const CALL = '[tool_call: get_weather({"city":"Paris"})]';

function testChatNonStreamToolCall() {
    console.log("Running OpenAI chat non-stream tool call test...");
    const body = JSON.stringify({
        choices: [
            {
                message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            id: "call_1",
                            type: "function",
                            function: {
                                name: "get_weather",
                                arguments: '{"city":"Paris"}'
                            }
                        }
                    ]
                }
            }
        ]
    });
    assertEqualsObj(
        normalizeAiResponse("openai_chat", body, false),
        [{ role: "assistant", content: CALL }],
        "non-stream tool call is rendered"
    );
}

function testChatStreamToolCall() {
    console.log("Running OpenAI chat stream tool call test...");
    const frame = (delta: unknown) =>
        `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
    const text =
        frame({ role: "assistant", content: null }) +
        frame({
            tool_calls: [
                {
                    index: 0,
                    id: "call_1",
                    function: { name: "get_weather", arguments: "" }
                }
            ]
        }) +
        frame({
            tool_calls: [{ index: 0, function: { arguments: '{"city":' } }]
        }) +
        frame({
            tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }]
        }) +
        "data: [DONE]\n\n";
    assertEqualsObj(
        normalizeAiResponse("openai_chat", text, true),
        [{ role: "assistant", content: CALL }],
        "streamed tool call fragments are accumulated"
    );
}

function testChatRequestAssistantToolCall() {
    console.log("Running OpenAI chat request tool call test...");
    const body = {
        messages: [
            { role: "user", content: "weather?" },
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: "call_1",
                        type: "function",
                        function: {
                            name: "get_weather",
                            arguments: '{"city":"Paris"}'
                        }
                    }
                ]
            },
            { role: "tool", content: "sunny" }
        ]
    };
    assertEqualsObj(
        normalizeAiRequest("openai_chat", body),
        [
            { role: "user", content: "weather?" },
            { role: "assistant", content: CALL },
            { role: "tool", content: "sunny" }
        ],
        "assistant tool_calls in the request history are rendered"
    );
}

function testResponsesNonStreamFunctionCall() {
    console.log("Running OpenAI Responses function_call test...");
    const body = JSON.stringify({
        output: [
            {
                type: "function_call",
                name: "get_weather",
                arguments: '{"city":"Paris"}'
            }
        ]
    });
    assertEqualsObj(
        normalizeAiResponse("openai_responses", body, false),
        [{ role: "assistant", content: CALL }],
        "non-stream function_call is rendered"
    );
}

function testResponsesStreamFunctionCall() {
    console.log("Running OpenAI Responses stream function_call test...");
    const completed = {
        type: "response.completed",
        response: {
            output: [
                {
                    type: "message",
                    content: [{ type: "output_text", text: "Checking. " }]
                },
                {
                    type: "function_call",
                    name: "get_weather",
                    arguments: '{"city":"Paris"}'
                }
            ]
        }
    };
    const text = `data: ${JSON.stringify(completed)}\n\n`;
    assertEqualsObj(
        normalizeAiResponse("openai_responses", text, true),
        [{ role: "assistant", content: `Checking. ${CALL}` }],
        "text and function_call both survive in response.completed"
    );
}

try {
    testChatNonStreamToolCall();
    testChatStreamToolCall();
    testChatRequestAssistantToolCall();
    testResponsesNonStreamFunctionCall();
    testResponsesStreamFunctionCall();
    console.log("All aiMessageNormalization tests passed!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
