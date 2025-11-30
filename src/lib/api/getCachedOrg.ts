import type { GetOrgResponse } from "@server/routers/org";
import type { AxiosResponse } from "axios";
import { cache } from "react";
import { authCookieHeader } from "./cookies";
import { internal } from ".";

export const getCachedOrg = cache(async (orgId: string) =>
    internal.get<AxiosResponse<GetOrgResponse>>(
        `/org/${orgId}`,
        await authCookieHeader()
    )
);
