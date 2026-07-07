import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import { Button } from "@app/components/ui/button";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ResourcePolicyProvider } from "@app/providers/ResourcePolicyProvider";
import type { GetResourcePolicyResponse } from "@server/routers/policy";
import type { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Resource Policy"
};

export const dynamic = "force-dynamic";

type EditPolicyLayoutProps = {
    children: React.ReactNode;
    params: Promise<{ niceId: string; orgId: string }>;
};

export default async function EditPolicyLayout(props: EditPolicyLayoutProps) {
    const params = await props.params;
    const t = await getTranslations();

    let policyResponse: GetResourcePolicyResponse | null = null;
    try {
        const res = await internal.get<
            AxiosResponse<GetResourcePolicyResponse>
        >(
            `/org/${params.orgId}/resource-policy/${params.niceId}`,
            await authCookieHeader()
        );
        policyResponse = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/policies/resources/public`);
    }

    if (!policyResponse) {
        redirect(`/${params.orgId}/settings/policies/resources/public`);
    }

    const navItems = [
        {
            title: t("general"),
            href: "/{orgId}/settings/policies/resources/public/{niceId}/general"
        },
        {
            title: t("authentication"),
            href: "/{orgId}/settings/policies/resources/public/{niceId}/authentication"
        },
        {
            title: t("policyAccessRulesTitle"),
            href: "/{orgId}/settings/policies/resources/public/{niceId}/rules"
        }
    ];

    return (
        <>
            <div className="flex justify-between">
                <SettingsSectionTitle
                    title={t("resourcePolicySetting", {
                        policyName: policyResponse.name
                    })}
                    description={t("resourcePolicySettingDescription")}
                />

                <Button asChild variant="outline">
                    <Link
                        href={`/${params.orgId}/settings/policies/resources/public`}
                    >
                        {t("resourcePoliciesSeeAll")}
                    </Link>
                </Button>
            </div>

            <ResourcePolicyProvider policy={policyResponse}>
                <HorizontalTabs items={navItems}>{props.children}</HorizontalTabs>
            </ResourcePolicyProvider>
        </>
    );
}
