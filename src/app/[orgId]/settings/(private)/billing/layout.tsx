import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { verifySession } from "@app/lib/auth/verifySession";
import OrgProvider from "@app/providers/OrgProvider";
import OrgUserProvider from "@app/providers/OrgUserProvider";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCachedOrgUser } from "@app/lib/api/getCachedOrgUser";
import { getCachedOrg } from "@app/lib/api/getCachedOrg";

type BillingSettingsProps = {
    children: React.ReactNode;
    params: Promise<{ orgId: string }>;
};

export default async function BillingSettingsPage({
    children,
    params
}: BillingSettingsProps) {
    const { orgId } = await params;

    const user = await verifySession();

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

    return (
        <>
            <OrgProvider org={org}>
                <OrgUserProvider orgUser={orgUser}>
                    <SettingsSectionTitle
                        title={t("billing")}
                        description={t("orgBillingDescription")}
                    />

                    {children}
                </OrgUserProvider>
            </OrgProvider>
        </>
    );
}
