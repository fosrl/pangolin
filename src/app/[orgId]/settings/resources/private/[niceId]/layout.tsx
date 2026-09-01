import { HorizontalTabs } from "@app/components/HorizontalTabs";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { fetchSiteResourceByNiceId } from "@app/lib/fetchSiteResourceByNiceId";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import OrgProvider from "@app/providers/OrgProvider";
import SiteResourceProvider from "@app/providers/SiteResourceProvider";
import SiteResourceInfoBox from "@app/components/PrivateResourceInfoBox";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Private Resource"
};

export const dynamic = "force-dynamic";

type PrivateResourceLayoutProps = {
    children: React.ReactNode;
    params: Promise<{ niceId: string; orgId: string }>;
};

export default async function PrivateResourceLayout(
    props: PrivateResourceLayoutProps
) {
    const params = await props.params;
    const t = await getTranslations();
    const { children } = props;

    const siteResource = await fetchSiteResourceByNiceId(
        params.orgId,
        params.niceId
    );

    if (!siteResource) {
        redirect(`/${params.orgId}/settings/resources/private`);
    }

    let org = null;
    try {
        const res = await getCachedOrg(params.orgId);
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources/private`);
    }

    if (!org) {
        redirect(`/${params.orgId}/settings/resources/private`);
    }

    const modeSettingsKey = `${siteResource.mode}Settings` as
        | "hostSettings"
        | "cidrSettings"
        | "httpSettings"
        | "sshSettings"
        | "inferenceSettings";

    const navItems = [
        {
            title: t("general"),
            href: `/{orgId}/settings/resources/private/{niceId}/general`
        },
        {
            title: t(modeSettingsKey),
            href: `/{orgId}/settings/resources/private/{niceId}/${siteResource.mode === "inference" ? "ai-gateway" : siteResource.mode}`
        },
        {
            title: t("authentication"),
            href: `/{orgId}/settings/resources/private/{niceId}/access`
        }
    ];

    if (siteResource.mode === "inference") {
        navItems.push({
            title: t("resourceBudgetSettings"),
            href: `/{orgId}/settings/resources/private/{niceId}/budget`
        });
    }

    return (
        <>
            <SettingsSectionTitle
                title={t("resourceSetting", {
                    resourceName: siteResource.name
                })}
                description={t("resourceSettingDescription")}
            />

            <OrgProvider org={org}>
                <SiteResourceProvider siteResource={siteResource}>
                    <div className="space-y-6">
                        <SiteResourceInfoBox />
                        <HorizontalTabs items={navItems}>
                            {children}
                        </HorizontalTabs>
                    </div>
                </SiteResourceProvider>
            </OrgProvider>
        </>
    );
}
