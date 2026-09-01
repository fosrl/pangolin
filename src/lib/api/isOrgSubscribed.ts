import { build } from "@server/build";
import { cache } from "react";
import { getCachedSubscription } from "./getCachedSubscription";
import { priv } from ".";
import { AxiosResponse } from "axios";
import { GetLicenseStatusResponse } from "@server/routers/license/types";
import { Tier } from "@server/types/Tiers";

const DEFAULT_PAID_TIERS: Tier[] = ["tier1", "tier2", "tier3", "enterprise"];

export const isOrgSubscribed = cache(async (orgId: string, tiers?: Tier[]) => {
    let subscribed = false;
    const allowedTiers = tiers ?? DEFAULT_PAID_TIERS;

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
                !!subRes.data.data.tier &&
                allowedTiers.includes(subRes.data.data.tier as Tier) &&
                subRes.data.data.active;
        } catch {}
    }

    return subscribed;
});
