import type { GetOrgResponse } from "@server/routers/org";
import type { AxiosResponse } from "axios";
import { cache } from "react";
import { authCookieHeader } from "./cookies";
import { internal } from ".";
import type { GetOrgUserResponse } from "@server/routers/user";

export const getCachedOrgUser = cache(async (orgId: string, userId: string) =>
    internal.get<AxiosResponse<GetOrgUserResponse>>(
        `/org/${orgId}/user/${userId}`,
        await authCookieHeader()
    )
);
