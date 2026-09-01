export const AI_CAPABILITIES = [
    "openai_chat",
    "openai_responses",
    "anthropic_messages",
    "v1_models",
    "gemini_generate_content",
    "bedrock_model_invoke",
    "google_generate_content",
    "google_raw_predict",
    "bedrock_converse"
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];
