import RedirectForm from "@app/components/RedirectForm";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { Button } from "@app/components/ui/button";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Create Redirect"
};

type CreateRedirectPageProps = {
    params: Promise<{ orgId: string }>;
};

export default async function CreateRedirectPage(
    props: CreateRedirectPageProps
) {
    const { orgId } = await props.params;
    const t = await getTranslations();

    return (
        <>
            <div className="flex gap-2 justify-between">
                <SettingsSectionTitle
                    title={t("redirectCreate")}
                    description={t("redirectCreateDescription")}
                />
                <Button variant="outline" asChild>
                    <Link href={`/${orgId}/settings/redirects`}>
                        {t("redirectGoBack")}
                    </Link>
                </Button>
            </div>

            <RedirectForm orgId={orgId} />
        </>
    );
}
