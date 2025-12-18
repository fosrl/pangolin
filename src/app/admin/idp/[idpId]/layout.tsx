import { internal } from "@app/lib/api";
import { GetIdpResponse } from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { authCookieHeader } from "@app/lib/api/cookies";
import { HorizontalTabs, TabItem } from "@app/components/HorizontalTabs";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { getTranslations } from "next-intl/server";

interface SettingsLayoutProps {
    children: React.ReactNode;
    params: Promise<{ idpId: string }>;
}

export default async function SettingsLayout(props: SettingsLayoutProps) {
    const params = await props.params;
    const { children } = props;
    const t = await getTranslations();

    let idp = null;
    try {
        const res = await internal.get<AxiosResponse<GetIdpResponse>>(
            `/idp/${params.idpId}`,
            await authCookieHeader()
        );
        idp = res.data.data;
    } catch {
        redirect("/admin/idp");
    }

    const navItems: TabItem[] = [
        {
            title: t("general"),
            href: `/admin/idp/${params.idpId}/general`
        },
        {
            title: t("orgPolicies"),
            href: `/admin/idp/${params.idpId}/policies`
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
