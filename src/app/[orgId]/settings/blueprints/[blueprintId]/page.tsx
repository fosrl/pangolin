import BlueprintDetailsForm from "@app/components/BlueprintDetailsForm";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { Button } from "@app/components/ui/button";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";
import { GetBlueprintResponse } from "@server/routers/blueprints";
import { AxiosResponse } from "axios";
import { ArrowLeft } from "lucide-react";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type BluePrintsPageProps = {
    params: Promise<{ orgId: string; blueprintId: string }>;
};

export const metadata: Metadata = {
    title: "Blueprint Detail"
};

export default async function BluePrintDetailPage(props: BluePrintsPageProps) {
    const params = await props.params;
    let org = null;
    try {
        const res = await getCachedOrg(params.orgId);
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}`);
    }

    let blueprint = null;
    try {
        const res = await internal.get<AxiosResponse<GetBlueprintResponse>>(
            `/org/${params.orgId}/blueprint/${params.blueprintId}`,
            await authCookieHeader()
        );

        blueprint = res.data.data;
    } catch (e) {
        console.error(e);
        notFound();
    }

    const t = await getTranslations();

    return (
        <>
            <SettingsSectionTitle
                title={t("blueprintDetails")}
                description={t("blueprintDetailsDescription")}
            />

            <BlueprintDetailsForm blueprint={blueprint} />
        </>
    );
}
