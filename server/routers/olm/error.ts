import { sendToClient } from "#dynamic/routers/ws";
import config from "@server/lib/config";

const udpPort = config.getRawConfig().gerbil.clients_start_port;

// Error codes for registration failures
export const OlmErrorCodes = {
    OLM_NOT_FOUND: {
        code: "OLM_NOT_FOUND",
        message: "The specified device could not be found."
    },
    CLIENT_ID_NOT_FOUND: {
        code: "CLIENT_ID_NOT_FOUND",
        message: "No client ID was provided in the request."
    },
    CLIENT_NOT_FOUND: {
        code: "CLIENT_NOT_FOUND",
        message: "The specified client does not exist."
    },
    CLIENT_BLOCKED: {
        code: "CLIENT_BLOCKED",
        message:
            "This client has been blocked in this organization and cannot connect. Please contact your administrator."
    },
    CLIENT_PENDING: {
        code: "CLIENT_PENDING",
        message:
            "This client is pending approval and cannot connect yet. Please contact your administrator."
    },
    ORG_NOT_FOUND: {
        code: "ORG_NOT_FOUND",
        message:
            "The organization could not be found. Please select a valid organization."
    },
    USER_ID_NOT_FOUND: {
        code: "USER_ID_NOT_FOUND",
        message: "No user ID was provided in the request."
    },
    INVALID_USER_SESSION: {
        code: "INVALID_USER_SESSION",
        message:
            "Your user session is invalid or has expired. Please log in again."
    },
    USER_ID_MISMATCH: {
        code: "USER_ID_MISMATCH",
        message: "The provided user ID does not match the session."
    },
    ORG_ACCESS_POLICY_DENIED: {
        code: "ORG_ACCESS_POLICY_DENIED",
        message:
            "Access to this organization has been denied by policy. Please contact your administrator."
    },
    ORG_ACCESS_POLICY_PASSWORD_EXPIRED: {
        code: "ORG_ACCESS_POLICY_PASSWORD_EXPIRED",
        message:
            "Access to this organization has been denied because your password has expired. Please visit this organization's dashboard to update your password."
    },
    ORG_ACCESS_POLICY_SESSION_EXPIRED: {
        code: "ORG_ACCESS_POLICY_SESSION_EXPIRED",
        message:
            "Access to this organization has been denied because your session has expired. Please log in again to refresh the session."
    },
    ORG_ACCESS_POLICY_2FA_REQUIRED: {
        code: "ORG_ACCESS_POLICY_2FA_REQUIRED",
        message:
            "Access to this organization requires two-factor authentication. Please visit this organization's dashboard to enable two-factor authentication."
    },
    TERMINATED_REKEYED: {
        code: "TERMINATED_REKEYED",
        message:
            "This session was terminated because encryption keys were regenerated."
    },
    TERMINATED_ORG_DELETED: {
        code: "TERMINATED_ORG_DELETED",
        message:
            "This session was terminated because the organization was deleted."
    },
    TERMINATED_INACTIVITY: {
        code: "TERMINATED_INACTIVITY",
        message: "This session was terminated due to inactivity."
    },
    TERMINATED_DELETED: {
        code: "TERMINATED_DELETED",
        message: "This session was terminated because it was deleted."
    },
    TERMINATED_ARCHIVED: {
        code: "TERMINATED_ARCHIVED",
        message: "This session was terminated because it was archived."
    },
    TERMINATED_BLOCKED: {
        code: "TERMINATED_BLOCKED",
        message: "This session was terminated because access was blocked."
    },
    HOLEPUNCH_MISSING: {
        code: "HOLEPUNCH_MISSING",
        message: `Unable to coordinate client P2P connection. Please ensure your client can reach the server on UDP port ${udpPort} and try registering again.`
    }
} as const;

// Helper function to send registration error
export async function sendOlmError(
    error: (typeof OlmErrorCodes)[keyof typeof OlmErrorCodes],
    olmId: string
) {
    sendToClient(olmId, {
        type: "olm/error",
        data: {
            code: error.code,
            message: error.message
        }
    });
}
