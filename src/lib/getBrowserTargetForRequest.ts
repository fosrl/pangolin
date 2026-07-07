import { priv } from "@app/lib/api";
import { GetBrowserTargetResponse } from "@server/routers/browserGatewayTarget";
import { AxiosResponse } from "axios";
import { headers } from "next/headers";
import { cache } from "react";

export const getBrowserTargetForRequest = cache(async () => {
    const headersList = await headers();
    const host = headersList.get("p-host") || headersList.get("host") || "";
    const hostname = host.split(":")[0];

    try {
        const res = await priv.get<AxiosResponse<GetBrowserTargetResponse>>(
            `/resource/browser-target?fullDomain=${encodeURIComponent(hostname)}`
        );
        return { target: res.data.data };
    } catch {
        return { target: null };
    }
});
