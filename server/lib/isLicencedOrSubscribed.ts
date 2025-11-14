import { build } from "@server/build";
import license from "@server/license/license";
import { getOrgTierData } from "#dynamic/lib/billing";
import { TierId } from "./billing/tiers";

export async function isLicensedOrSubscribed(orgId: string): Promise<boolean> {
    if (build === "enterprise") {
        const isUnlocked = await license.isUnlocked();
        if (!isUnlocked) {
            return false;
        }
    }

    if (build === "saas") {
        const { tier } = await getOrgTierData(orgId);
        const subscribed = tier === TierId.STANDARD;
        if (!subscribed) {
            return false;
        }
    }

    return true;
}
