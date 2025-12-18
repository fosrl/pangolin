import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { HorizontalTabs, type TabItem } from "@app/components/HorizontalTabs";
import { verifySession } from "@app/lib/auth/verifySession";
import OrgProvider from "@app/providers/OrgProvider";
import OrgUserProvider from "@app/providers/OrgUserProvider";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import { getCachedOrgUser } from "@app/lib/api/getCachedOrgUser";
import { build } from "@server/build";

type GeneralSettingsProps = {
    children: React.ReactNode;
    params: Promise<{ orgId: string }>;
};

export default async function GeneralSettingsPage({
    children,
    params
}: GeneralSettingsProps) {
    const { orgId } = await params;

    const user = await verifySession();

    if (!user) {
        redirect(`/`);
    }

    let orgUser = null;
    try {
        const res = await getCachedOrgUser(orgId, user.userId);
        orgUser = res.data.data;
    } catch {
        redirect(`/${orgId}`);
    }

    let org = null;
    try {
        const res = await getCachedOrg(orgId);
        org = res.data.data;
    } catch {
        redirect(`/${orgId}`);
    }

    const t = await getTranslations();

    const navItems: TabItem[] = [
        {
            title: t("general"),
            href: `/{orgId}/settings/general`,
            exact: true
        }
    ];
    if (build !== "oss") {
        navItems.push({
            title: t("authPage"),
            href: `/{orgId}/settings/general/auth-page`
        });
    }

    return (
        <>
            <OrgProvider org={org}>
                <OrgUserProvider orgUser={orgUser}>
                    <SettingsSectionTitle
                        title={t("orgGeneralSettings")}
                        description={t("orgSettingsDescription")}
                    />

                    <HorizontalTabs items={navItems}>{children}</HorizontalTabs>
                </OrgUserProvider>
            </OrgProvider>
        </>
    );
}
