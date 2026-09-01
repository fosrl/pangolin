import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import { getTranslations } from "next-intl/server";

type VirtualApiKeysListLayoutProps = {
    children: React.ReactNode;
    params: Promise<{ orgId: string }>;
};

export default async function VirtualApiKeysListLayout({
    children,
    params
}: VirtualApiKeysListLayoutProps) {
    const { orgId } = await params;
    const t = await getTranslations();

    const navItems = [
        {
            title: t("virtualApiKeysTabIdentity"),
            href: `/${orgId}/settings/virtual-api-keys/identity`
        },
        {
            title: t("virtualApiKeysTabVirtual"),
            href: `/${orgId}/settings/virtual-api-keys/keys`
        }
    ];

    return (
        <>
            <SettingsSectionTitle
                title={t("virtualApiKeysTitle")}
                description={t("virtualApiKeysDescription")}
            />
            <HorizontalTabs items={navItems}>{children}</HorizontalTabs>
        </>
    );
}
