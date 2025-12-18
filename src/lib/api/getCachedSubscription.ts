import type { AxiosResponse } from "axios";
import { cache } from "react";
import { priv } from ".";
import type { GetOrgTierResponse } from "@server/routers/billing/types";

export const getCachedSubscription = cache(async (orgId: string) =>
    priv.get<AxiosResponse<GetOrgTierResponse>>(`/org/${orgId}/billing/tier`)
);
