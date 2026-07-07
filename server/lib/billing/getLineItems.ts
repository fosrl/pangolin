import Stripe from "stripe";
import { LimitId, FeaturePriceSet } from "./features";
import { usageService } from "./usageService";

export async function getLineItems(
    featurePriceSet: FeaturePriceSet,
    orgId: string
): Promise<Stripe.Checkout.SessionCreateParams.LineItem[]> {
    const users = await usageService.getUsage(orgId, LimitId.USERS);

    return Object.entries(featurePriceSet).map(([featureId, priceId]) => {
        let quantity: number | undefined;

        if (featureId === LimitId.USERS) {
            quantity = users?.instantaneousValue || 1;
        } else if (featureId === LimitId.TIER1) {
            quantity = 1;
        }

        return {
            price: priceId,
            quantity: quantity
        };
    });
}
