import { RoleAiBudgetSettings } from "@app/components/RoleSettingsTabs";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getAiBudgetScopeListPath } from "@app/lib/aiBudgetScope";
import { pullEnv } from "@app/lib/pullEnv";
import type { ListAiBudgetsByScopeResponse } from "@server/routers/aiBudget/types";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";

type PageProps = {
    params: Promise<{ orgId: string; roleId: string }>;
};

export default async function Page(props: PageProps) {
    const { orgId, roleId } = await props.params;
    if (pullEnv().flags.disableEnterpriseFeatures) {
        redirect(`/${orgId}/settings/access/roles/${roleId}/general`);
    }

    // Load on the server so the tab renders with the saved budgets.
    const res = await internal
        .get<AxiosResponse<ListAiBudgetsByScopeResponse>>(
            getAiBudgetScopeListPath({ type: "role", id: Number(roleId) }),
            await authCookieHeader()
        )
        .catch(() => null);

    return <RoleAiBudgetSettings initialBudgets={res?.data.data.budgets} />;
}
