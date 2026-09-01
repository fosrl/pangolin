import {
    AI_CAPABILITY_DEFS,
    type AiCapability,
    type AiProtocolFamily
} from "@server/lib/aiCapabilities";
import HttpCode from "@server/types/HttpCode";

export type ClientErrorResponse = {
    statusCode?: number;
    contentType?: string;
    body: string;
};

export type AiCapabilityErrorKind =
    | "authentication"
    | "invalid_request"
    | "not_found"
    | "permission"
    | "rate_limit"
    | "internal";

const AUTH_MESSAGE = "Invalid API key provided.";

type KindFields = {
    openaiType: string;
    openaiCode: string | null;
    anthropicType: string;
    googleStatus: string;
};

const KIND_FIELDS: Record<AiCapabilityErrorKind, KindFields> = {
    authentication: {
        openaiType: "authentication_error",
        openaiCode: "invalid_api_key",
        anthropicType: "authentication_error",
        googleStatus: "UNAUTHENTICATED"
    },
    invalid_request: {
        openaiType: "invalid_request_error",
        openaiCode: null,
        anthropicType: "invalid_request_error",
        googleStatus: "INVALID_ARGUMENT"
    },
    not_found: {
        openaiType: "invalid_request_error",
        openaiCode: null,
        anthropicType: "not_found_error",
        googleStatus: "NOT_FOUND"
    },
    permission: {
        openaiType: "invalid_request_error",
        openaiCode: null,
        anthropicType: "permission_error",
        googleStatus: "PERMISSION_DENIED"
    },
    rate_limit: {
        openaiType: "rate_limit_error",
        openaiCode: "rate_limit_exceeded",
        anthropicType: "rate_limit_error",
        googleStatus: "RESOURCE_EXHAUSTED"
    },
    internal: {
        openaiType: "api_error",
        openaiCode: null,
        anthropicType: "api_error",
        googleStatus: "INTERNAL"
    }
};

function resolveProtocolFamily(
    capability: AiCapability | null
): AiProtocolFamily {
    if (capability == null) {
        return "openai";
    }
    return AI_CAPABILITY_DEFS[capability].protocolFamily;
}

/**
 * Build a protocol-native error body for the given capability.
 * Message stays contextual; only the envelope/machine fields follow the
 * capability's native API shape.
 */
export function buildAiCapabilityErrorBody(
    capability: AiCapability | null,
    kind: AiCapabilityErrorKind,
    message: string,
    httpStatus?: number
): Record<string, unknown> {
    const family = resolveProtocolFamily(capability);
    const fields = KIND_FIELDS[kind];

    switch (family) {
        case "openai":
            return {
                error: {
                    message,
                    type: fields.openaiType,
                    param: null,
                    code: fields.openaiCode
                }
            };
        case "anthropic":
            return {
                type: "error",
                error: {
                    type: fields.anthropicType,
                    message
                }
            };
        case "google":
            return {
                error: {
                    code: httpStatus ?? HttpCode.BAD_REQUEST,
                    message,
                    status: fields.googleStatus
                }
            };
        case "bedrock":
            return { message };
    }
}

export function buildInferenceAuthClientError(
    capability: AiCapability | null
): ClientErrorResponse {
    return {
        statusCode: HttpCode.UNAUTHORIZED,
        contentType: "application/json",
        body: JSON.stringify(
            buildAiCapabilityErrorBody(
                capability,
                "authentication",
                AUTH_MESSAGE,
                HttpCode.UNAUTHORIZED
            )
        )
    };
}
