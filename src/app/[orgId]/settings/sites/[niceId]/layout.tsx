import SiteProvider from "@app/providers/SiteProvider";
import OrgProvider from "@app/providers/OrgProvider";
import { internal } from "@app/lib/api";
import { GetSiteResponse } from "@server/routers/site";
import { GetOrgResponse } from "@server/routers/org";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { authCookieHeader } from "@app/lib/api/cookies";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import SiteInfoCard from "@app/components/SiteInfoCard";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Site"
};

interface SettingsLayoutProps {
    children: React.ReactNode;
    params: Promise<{ niceId: string; orgId: string }>;
}

export default async function SettingsLayout(props: SettingsLayoutProps) {
    const params = await props.params;

    const { children } = props;

    let site = null;
    try {
        const res = await internal.get<AxiosResponse<GetSiteResponse>>(
            `/org/${params.orgId}/site/${params.niceId}`,
            await authCookieHeader()
        );
        site = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/sites`);
    }

    let org = null;
    try {
        const res = await internal.get<AxiosResponse<GetOrgResponse>>(
            `/org/${params.orgId}`,
            await authCookieHeader()
        );
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/sites`);
    }

    const t = await getTranslations();

    const navItems = [
        {
            title: t("general"),
            href: `/${params.orgId}/settings/sites/${params.niceId}/general`
        },
        {
            title: t("siteResourcesTab"),
            href: `/${params.orgId}/settings/sites/${params.niceId}/resources`
        },
        ...(site.type !== "local"
            ? [
                  {
                      title: t("credentials"),
                      href: `/${params.orgId}/settings/sites/${params.niceId}/credentials`
                  }
              ]
            : [])
    ];

    return (
        <>
            <SettingsSectionTitle
                title={t("siteSetting", { siteName: site?.name })}
                description={t("siteSettingDescription")}
            />

            <SiteProvider site={site}>
                <OrgProvider org={org}>
                    <div className="space-y-4">
                        <SiteInfoCard />
                        <HorizontalTabs items={navItems}>
                            {children}
                        </HorizontalTabs>
                    </div>
                </OrgProvider>
            </SiteProvider>
        </>
    );
}
