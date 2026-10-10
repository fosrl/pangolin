import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import AdminIdpTable, { IdpRow } from "@app/components/AdminIdpTable";
import { getTranslations } from "next-intl/server";

export default async function IdpPage() {
    let idps: IdpRow[] = [];
    try {
        const res = await internal.get<AxiosResponse<{ idps: IdpRow[] }>>(
            `/idp`,
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
            <AdminIdpTable idps={idps} />
        </>
    );
}
