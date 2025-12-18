import { build } from "@server/build";
import { TierId } from "@server/lib/billing/tiers";
import { cache } from "react";
import { getCachedSubscription } from "./getCachedSubscription";
import { priv } from ".";
import { AxiosResponse } from "axios";
import { GetLicenseStatusResponse } from "@server/routers/license/types";

export const isOrgSubscribed = cache(async (orgId: string) => {
    let subscribed = false;

    if (build === "enterprise") {
        try {
            const licenseStatusRes =
                await priv.get<AxiosResponse<GetLicenseStatusResponse>>(
                    "/license/status"
                );
            subscribed = licenseStatusRes.data.data.isLicenseValid;
        } catch (error) {}
    } else if (build === "saas") {
        try {
            const subRes = await getCachedSubscription(orgId);
            subscribed =
                subRes.data.data.tier === TierId.STANDARD &&
                subRes.data.data.active;
        } catch {}
    }

    return subscribed;
});
