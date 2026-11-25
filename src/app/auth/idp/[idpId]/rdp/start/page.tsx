import { formatAxiosError, priv } from "@app/lib/api";
import RdpEntraCallback from "@app/components/RdpEntraCallback";
import { GenerateRdpEntraUrlResponse } from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Microsoft Entra ID sign-in"
};

export const dynamic = "force-dynamic";

/**
 * Opened in a popup by the browser RDP client. Builds the Entra authorization
 * URL for the requested host and sends the popup there; Entra then returns to
 * the sibling callback page.
 */
export default async function Page(props: {
    params: Promise<{ idpId: string }>;
    searchParams: Promise<{
        purpose?: string;
        deviceName?: string;
        reqCnf?: string;
        origin?: string;
    }>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;

    const origin = searchParams.origin ?? null;
    let redirectUrl: string | null = null;
    let error: string | null = null;

    try {
        const res = await priv.post<AxiosResponse<GenerateRdpEntraUrlResponse>>(
            `/idp/${params.idpId}/rdp-entra/generate-url`,
            searchParams.purpose === "devices"
                ? { purpose: "devices", origin: origin ?? "" }
                : {
                      purpose: "token",
                      deviceName: searchParams.deviceName ?? "",
                      reqCnf: searchParams.reqCnf ?? "",
                      origin: origin ?? ""
                  }
        );
        redirectUrl = res.data.data.redirectUrl;
    } catch (e) {
        error = formatAxiosError(e);
    }

    // redirect() works by throwing, so it must stay outside the try block.
    if (redirectUrl) {
        redirect(redirectUrl);
    }

    return <RdpEntraCallback origin={origin} error={error} result={null} />;
}
