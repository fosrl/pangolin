import { CreatePolicyForm } from "@app/components/resource-policy/CreatePolicyForm";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { Button } from "@app/components/ui/button";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export interface CreateResourcePolicyPageProps {
    params: Promise<{ orgId: string }>;
}

export default async function CreateResourcePolicyPage(
    props: CreateResourcePolicyPageProps
) {
    const params = await props.params;
    const t = await getTranslations();

    return (
        <>
            <div className="flex justify-between">
                <SettingsSectionTitle
                    title={t("resourcePoliciesCreate")}
                    description={t("resourcePoliciesCreateDescription")}
                />

                <Button asChild variant="outline">
                    <Link
                        href={`/${params.orgId}/settings/policies/resources/public`}
                    >
                        {t("resourcePoliciesSeeAll")}
                    </Link>
                </Button>
            </div>

            <CreatePolicyForm />
        </>
    );
}
