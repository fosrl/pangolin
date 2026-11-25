import { formatAxiosError, priv } from "@app/lib/api";
import RdpEntraCallback from "@app/components/RdpEntraCallback";
import { ValidateRdpEntraCallbackResponse } from "@server/routers/idp";
import { AxiosResponse } from "axios";
import jsonwebtoken from "jsonwebtoken";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Microsoft Entra ID sign-in"
};

export const dynamic = "force-dynamic";

/**
 * Entra redirects the sign-in popup here. The code is exchanged for a token
 * bound to the RDP client's key, which the page then posts to the RDP page.
 */
export default async function Page(props: {
    params: Promise<{ idpId: string }>;
    searchParams: Promise<{
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
    }>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;

    // The origin is read without verifying the signature only to address the
    // error message; the API verifies the state before issuing anything.
    const origin = originFromState(searchParams.state);

    if (searchParams.error) {
        const description =
            searchParams.error_description ?? searchParams.error;
        return (
            <RdpEntraCallback
                origin={origin}
                error={description}
                result={null}
            />
        );
    }

    if (!searchParams.code || !searchParams.state) {
        return (
            <RdpEntraCallback
                origin={origin}
                error="The identity provider did not return an authorization code."
                result={null}
            />
        );
    }

    try {
        const res = await priv.post<
            AxiosResponse<ValidateRdpEntraCallbackResponse>
        >(`/idp/${params.idpId}/rdp-entra/validate-callback`, {
            code: searchParams.code,
            state: searchParams.state
        });
        const data = res.data.data;
        return (
            <RdpEntraCallback
                origin={data.origin}
                error={null}
                result={
                    "devices" in data
                        ? { devices: data.devices }
                        : {
                              accessToken: data.accessToken,
                              nonce: data.nonce,
                              deviceName: data.deviceName
                          }
                }
            />
        );
    } catch (e) {
        return (
            <RdpEntraCallback
                origin={origin}
                error={formatAxiosError(e)}
                result={null}
            />
        );
    }
}

function originFromState(state: string | undefined): string | null {
    if (!state) {
        return null;
    }
    const decoded = jsonwebtoken.decode(state);
    if (decoded && typeof decoded === "object" && "origin" in decoded) {
        return typeof decoded.origin === "string" ? decoded.origin : null;
    }
    return null;
}
