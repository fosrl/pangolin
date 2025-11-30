import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { Button } from "@app/components/ui/button";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import CreateBlueprintForm from "@app/components/CreateBlueprintForm";

export interface CreateBlueprintPageProps {
    params: Promise<{ orgId: string }>;
}

export const metadata: Metadata = {
    title: "Create blueprint"
};

export default async function CreateBlueprintPage(
    props: CreateBlueprintPageProps
) {
    const t = await getTranslations();

    const orgId = (await props.params).orgId;

    return (
        <>
            <div className="flex gap-2 justify-between">
                <SettingsSectionTitle
                    title={t("blueprintCreate")}
                    description={t("blueprintCreateDescription2")}
                />
                <Button variant="outline" asChild>
                    <Link href={`/${orgId}/settings/blueprints`}>
                        {t("blueprintGoBack")}
                    </Link>
                </Button>
            </div>

            <CreateBlueprintForm orgId={orgId} />
        </>
    );
}
