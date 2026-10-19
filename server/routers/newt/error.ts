import { sendToClient } from "#dynamic/routers/ws";

// Error codes for registration failures
export const NewtErrorCodes = {
    NO_AVAILABLE_SUBNET: {
        code: "NO_AVAILABLE_SUBNET",
        message:
            "No available subnet could be assigned to this site on its exit node. Please contact your administrator to increase the available address space for this exit node's subnet."
    }
} as const;

// Helper function to send registration error
export async function sendNewtError(
    error: (typeof NewtErrorCodes)[keyof typeof NewtErrorCodes],
    newtId: string
) {
    sendToClient(newtId, {
        type: "newt/error",
        data: {
            code: error.code,
            message: error.message
        }
    });
}
