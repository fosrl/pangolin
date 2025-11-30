import BlueprintsTable, {
    type BlueprintRow
} from "@app/components/BlueprintsTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import OrgProvider from "@app/providers/OrgProvider";
import { ListBlueprintsResponse } from "@server/routers/blueprints";
import { AxiosResponse } from "axios";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

type BluePrintsPageProps = {
    params: Promise<{ orgId: string }>;
};

export const metadata: Metadata = {
    title: "Blueprints"
};

export default async function BluePrintsPage(props: BluePrintsPageProps) {
    const params = await props.params;

    let blueprints: BlueprintRow[] = [];
    try {
        const res = await internal.get<AxiosResponse<ListBlueprintsResponse>>(
            `/org/${params.orgId}/blueprints`,
            await authCookieHeader()
        );

        blueprints = res.data.data.blueprints;
    } catch (e) {
        console.error(e);
    }

    let org = null;
    try {
        const res = await getCachedOrg(params.orgId);
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}`);
    }

    const t = await getTranslations();

    return (
        <OrgProvider org={org}>
            <SettingsSectionTitle
                title={t("blueprints")}
                description={t("blueprintsDescription")}
            />
            <BlueprintsTable blueprints={blueprints} orgId={params.orgId} />
        </OrgProvider>
    );
}
