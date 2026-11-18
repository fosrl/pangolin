import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { HorizontalTabs, type TabItem } from "@app/components/HorizontalTabs";
import { verifySession } from "@app/lib/auth/verifySession";
import OrgProvider from "@app/providers/OrgProvider";
import OrgUserProvider from "@app/providers/OrgUserProvider";
import OrgInfoCard from "@app/components/OrgInfoCard";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import { getCachedOrgUser } from "@app/lib/api/getCachedOrgUser";
import { build } from "@server/build";
import { pullEnv } from "@app/lib/pullEnv";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Organization"
};

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
    const env = pullEnv();

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
        },
        {
            title: t("security"),
            href: `/{orgId}/settings/general/security`
        },
        {
            title: t("logs"),
            href: `/{orgId}/settings/general/logs`
        },
        // PaidFeaturesAlert
        ...(!env.flags.disableEnterpriseFeatures
            ? [
                  {
                      title: t("authPage"),
                      href: `/{orgId}/settings/general/auth-page`
                  }
              ]
            : [])
    ];

    return (
        <>
            <OrgProvider org={org}>
                <OrgUserProvider orgUser={orgUser}>
                    <SettingsSectionTitle
                        title={t("orgGeneralSettings")}
                        description={t("orgSettingsDescription")}
                    />

                    <div className="space-y-4">
                        <OrgInfoCard />
                        <HorizontalTabs items={navItems}>
                            {children}
                        </HorizontalTabs>
                    </div>
                </OrgUserProvider>
            </OrgProvider>
        </>
    );
}
