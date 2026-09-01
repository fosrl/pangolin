import { AiUsageAnalyticsData } from "@app/components/AiUsageAnalyticsData";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations();
    return {
        title: t("aiUsageAnalyticsTitle")
    };
}

export interface AiUsageAnalyticsPageProps {
    params: Promise<{ orgId: string }>;
}

export default async function AiUsageAnalyticsPage(
    props: AiUsageAnalyticsPageProps
) {
    const orgId = (await props.params).orgId;
    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("aiUsageAnalyticsTitle")}
                description={t("aiUsageAnalyticsDescription")}
            />

            <div className="container mx-auto max-w-12xl">
                <AiUsageAnalyticsData orgId={orgId} />
            </div>
        </>
    );
}
