import { build } from "@server/build";
import license from "#dynamic/license/license";
import { getOrgTierData } from "#dynamic/lib/billing";
import { TierId } from "@server/lib/billing/tiers";

export async function isLicensedOrSubscribed(orgId: string): Promise<boolean> {
    if (build === "enterprise") {
        return await license.isUnlocked();
    }

    if (build === "saas") {
        const { tier } = await getOrgTierData(orgId);
        return tier === TierId.STANDARD;
    }

    return true;
}
