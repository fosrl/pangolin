import { HorizontalTabs, type TabItem } from "@app/components/HorizontalTabs";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { pullEnv } from "@app/lib/pullEnv";
import RoleProvider from "@app/providers/RoleProvider";
import type { Role } from "@server/db";
import { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Role"
};

export const dynamic = "force-dynamic";

type RoleLayoutProps = {
    children: React.ReactNode;
    params: Promise<{ orgId: string; roleId: string }>;
};

export default async function RoleLayout({
    children,
    params
}: RoleLayoutProps) {
    const { orgId, roleId } = await params;
    const env = pullEnv();

    const res = await internal
        .get<AxiosResponse<Role>>(`/role/${roleId}`, await authCookieHeader())
        .catch(() => null);

    const role = res?.data.data;
    if (!role || role.orgId !== orgId) {
        redirect(`/${orgId}/settings/access/roles`);
    }

    const t = await getTranslations();
    const base = `/${orgId}/settings/access/roles/${roleId}`;

    const navItems: TabItem[] = [
        { title: t("general"), href: `${base}/general` },
        ...(!env.flags.disableEnterpriseFeatures
            ? [
                  {
                      title: t("accessRoleApprovals"),
                      href: `${base}/approvals`
                  },
                  { title: t("sshTitle"), href: `${base}/ssh` },
                  {
                      title: t("accessRoleInferenceBudget"),
                      href: `${base}/ai-budget`
                  },
                  {
                      title: t("accessRoleClientSettings"),
                      href: `${base}/client-settings`
                  }
              ]
            : [])
    ];

    return (
        <>
            <SettingsSectionTitle
                title={t("roleSetting", { roleName: role.name })}
                description={t("accessRoleEditDescription")}
            />
            <RoleProvider role={role}>
                <HorizontalTabs items={navItems}>{children}</HorizontalTabs>
            </RoleProvider>
        </>
    );
}
