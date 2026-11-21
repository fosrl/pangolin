import type { RdpEntraMessage } from "@app/components/RdpEntraCallback";
import { RDP_ENTRA_MESSAGE_TYPE } from "@app/components/RdpEntraCallback";

// How long to wait for the Microsoft sign-in popup to report back.
const ENTRA_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export type RdpEntraPopupMessages = {
    noIdp: string;
    popupBlocked: string;
    cancelled: string;
    timeout: string;
};

/**
 * Opens the dashboard-domain popup for an Entra identity provider and
 * resolves with what its last page posts back.
 *
 * `params` runs after the window is open, so the click still counts as a user
 * gesture for the popup blocker.
 */
export async function runRdpEntraPopup(options: {
    dashboardUrl: string;
    idpId: string;
    params: () => Promise<Record<string, string>>;
    messages: RdpEntraPopupMessages;
}): Promise<RdpEntraMessage> {
    const { messages } = options;
    if (!options.idpId) {
        throw new Error(messages.noIdp);
    }

    const popup = window.open(
        "about:blank",
        "pangolin-rdp-entra",
        "popup,width=520,height=720"
    );
    if (!popup) {
        throw new Error(messages.popupBlocked);
    }

    try {
        const dashboardOrigin = new URL(options.dashboardUrl).origin;
        const startUrl = new URL(
            `/auth/idp/${options.idpId}/rdp/start`,
            dashboardOrigin
        );
        for (const [name, value] of Object.entries(await options.params())) {
            startUrl.searchParams.set(name, value);
        }
        startUrl.searchParams.set("origin", window.location.origin);
        popup.location.href = startUrl.toString();

        const result = await new Promise<RdpEntraMessage>((resolve, reject) => {
            const cleanup = () => {
                window.removeEventListener("message", onMessage);
                clearInterval(closedPoll);
                clearTimeout(timeout);
            };
            const onMessage = (event: MessageEvent) => {
                if (event.origin !== dashboardOrigin) return;
                const data = event.data as RdpEntraMessage | null;
                if (data?.type !== RDP_ENTRA_MESSAGE_TYPE) return;
                cleanup();
                resolve(data);
            };
            const closedPoll = setInterval(() => {
                if (popup.closed) {
                    cleanup();
                    reject(new Error(messages.cancelled));
                }
            }, 500);
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(messages.timeout));
            }, ENTRA_SIGN_IN_TIMEOUT_MS);
            window.addEventListener("message", onMessage);
        });

        if (result.error) {
            throw new Error(result.error);
        }
        return result;
    } catch (err) {
        if (!popup.closed) popup.close();
        throw err;
    }
}
