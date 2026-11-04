import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import IdpBanner from "@app/components/IdpBanner";
import IdpTable, { IdpRow } from "@app/components/OrgIdpTable";
import { getTranslations } from "next-intl/server";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { IdpGlobalModeBanner } from "@app/components/IdpGlobalModeBanner";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Identity Providers"
};

type OrgIdpPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function OrgIdpPage(props: OrgIdpPageProps) {
    const params = await props.params;

    let idps: IdpRow[] = [];
    try {
        const res = await internal.get<AxiosResponse<{ idps: IdpRow[] }>>(
            `/org/${params.orgId}/idp`,
            await authCookieHeader()
        );
        idps = res.data.data.idps;
    } catch (e) {
        console.error(e);
    }

    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("idpManage")}
                description={t("idpManageDescription")}
            />
            <IdpBanner />
            <IdpGlobalModeBanner />

            <PaidFeaturesAlert tiers={tierMatrix.orgOidc} />

            <IdpTable idps={idps} orgId={params.orgId} />
        </>
    );
}
