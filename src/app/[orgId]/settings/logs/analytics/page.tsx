import { LogAnalyticsData } from "@app/components/LogAnalyticsData";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "HTTP Analytics"
};

export interface AnalyticsPageProps {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
}

export default async function AnalyticsPage(props: AnalyticsPageProps) {
    const t = await getTranslations();

    const orgId = (await props.params).orgId;

    return (
        <>
            <SettingsSectionTitle
                title={t("requestAnalytics")}
                description={t("requestAnalyticsDescription")}
            />

            <div className="container mx-auto max-w-12xl">
                <LogAnalyticsData orgId={orgId} />
            </div>
        </>
    );
}
