import { internal } from "@app/lib/api";
import { GetIdpResponse as GetOrgIdpResponse } from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { authCookieHeader } from "@app/lib/api/cookies";
import { HorizontalTabs, TabItem } from "@app/components/HorizontalTabs";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { getTranslations } from "next-intl/server";

interface SettingsLayoutProps {
    children: React.ReactNode;
    params: Promise<{ orgId: string; idpId: string }>;
}

export default async function SettingsLayout(props: SettingsLayoutProps) {
    const params = await props.params;
    const { children } = props;
    const t = await getTranslations();

    let idp = null;
    try {
        const res = await internal.get<AxiosResponse<GetOrgIdpResponse>>(
            `/org/${params.orgId}/idp/${params.idpId}`,
            await authCookieHeader()
        );
        idp = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/idp`);
    }

    const navItems: TabItem[] = [
        {
            title: t("general"),
            href: `/${params.orgId}/settings/idp/${params.idpId}/general`
        }
    ];

    return (
        <>
            <SettingsSectionTitle
                title={t("idpSettings", { idpName: idp.idp.name })}
                description={t("idpSettingsDescription")}
            />

            <div className="space-y-6">
                <HorizontalTabs items={navItems}>{children}</HorizontalTabs>
            </div>
        </>
    );
}
