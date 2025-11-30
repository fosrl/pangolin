import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import { verifySession } from "@app/lib/auth/verifySession";
import OrgProvider from "@app/providers/OrgProvider";
import OrgUserProvider from "@app/providers/OrgUserProvider";
import { GetOrgResponse } from "@server/routers/org";
import { GetOrgUserResponse } from "@server/routers/user";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getTranslations } from 'next-intl/server';

type GeneralSettingsProps = {
    children: React.ReactNode;
    params: Promise<{ orgId: string }>;
};

export default async function GeneralSettingsPage({
    children,
    params,
}: GeneralSettingsProps) {
    const { orgId } = await params;

    const getUser = cache(verifySession);
    const user = await getUser();

    if (!user) {
        redirect(`/`);
    }

    let orgUser = null;
    try {
        const getOrgUser = cache(async () =>
            internal.get<AxiosResponse<GetOrgUserResponse>>(
                `/org/${orgId}/user/${user.userId}`,
                await authCookieHeader(),
            ),
        );
        const res = await getOrgUser();
        orgUser = res.data.data;
    } catch {
        redirect(`/${orgId}`);
    }

    let org = null;
    try {
        const getOrg = cache(async () =>
            internal.get<AxiosResponse<GetOrgResponse>>(
                `/org/${orgId}`,
                await authCookieHeader(),
            ),
        );
        const res = await getOrg();
        org = res.data.data;
    } catch {
        redirect(`/${orgId}`);
    }

    const t = await getTranslations();

    const navItems = [
        {
            title: t('general'),
            href: `/{orgId}/settings/general`,
        },
    ];

    return (
        <>
            <OrgProvider org={org}>
                <OrgUserProvider orgUser={orgUser}>
                    <SettingsSectionTitle
                        title={t('orgGeneralSettings')}
                        description={t('orgSettingsDescription')}
                    />

                    <HorizontalTabs items={navItems}>
                        {children}
                    </HorizontalTabs>
                </OrgUserProvider>
            </OrgProvider>
        </>
    );
}
