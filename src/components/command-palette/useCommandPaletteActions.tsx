"use client";

import { useEnvContext } from "@app/hooks/useEnvContext";
import { useUserContext } from "@app/hooks/useUserContext";
import { build } from "@server/build";
import {
    BellRing,
    Building2,
    Globe,
    GlobeLock,
    KeyRound,
    MonitorUp,
    Plus,
    Sparkles,
    SunMoon,
    UserPlus
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ListUserOrgsResponse } from "@server/routers/org";

export type CommandPaletteAction = {
    id: string;
    label: string;
    icon: ReactNode;
    href?: string;
    onSelect?: () => void;
};

export function useCommandPaletteActions(
    orgId?: string,
    orgs?: ListUserOrgsResponse["orgs"]
): CommandPaletteAction[] {
    const t = useTranslations();
    const pathname = usePathname();
    const { env } = useEnvContext();
    const { user } = useUserContext();
    const { setTheme, theme } = useTheme();
    const isAdminPage = pathname?.startsWith("/admin");

    return useMemo(() => {
        const actions: CommandPaletteAction[] = [];

        function cycleTheme() {
            const currentTheme = theme || "system";
            if (currentTheme === "light") {
                setTheme("dark");
            } else if (currentTheme === "dark") {
                setTheme("system");
            } else {
                setTheme("light");
            }
        }

        if (isAdminPage) {
            actions.push({
                id: "create-admin-api-key",
                label: t("commandPaletteCreateApiKey"),
                icon: <KeyRound className="size-4" />,
                href: "/admin/api-keys/create"
            });

            if (
                build === "oss" ||
                env?.app.identityProviderMode === "global" ||
                env?.app.identityProviderMode === undefined
            ) {
                actions.push({
                    id: "create-admin-idp",
                    label: t("commandPaletteCreateIdentityProvider"),
                    icon: <Plus className="size-4" />,
                    href: "/admin/idp/create"
                });
            }
        } else if (orgId) {
            actions.push({
                id: "my-api-keys",
                label: t("sidebarMyApiKeys"),
                icon: <KeyRound className="size-4" />,
                href: `/${orgId}/keys`
            });
            actions.push({
                id: "create-site",
                label: t("commandPaletteCreateSite"),
                icon: <Plus className="size-4" />,
                href: `/${orgId}/settings/sites/create`
            });
            actions.push({
                id: "create-proxy-resource",
                label: t("commandPaletteCreateProxyResource"),
                icon: <Globe className="size-4" />,
                href: `/${orgId}/settings/resources/proxy/create`
            });
            actions.push({
                id: "create-private-resource",
                label: t("commandPaletteCreatePrivateResource"),
                icon: <GlobeLock className="size-4" />,
                href: `/${orgId}/settings/resources/private/create`
            });
            actions.push({
                id: "create-machine-client",
                label: t("commandPaletteCreateMachineClient"),
                icon: <MonitorUp className="size-4" />,
                href: `/${orgId}/settings/clients/machine/create`
            });
            actions.push({
                id: "create-user",
                label: t("commandPaletteCreateUser"),
                icon: <UserPlus className="size-4" />,
                href: `/${orgId}/settings/access/users/create`
            });
            actions.push({
                id: "create-api-key",
                label: t("commandPaletteCreateApiKey"),
                icon: <KeyRound className="size-4" />,
                href: `/${orgId}/settings/api-keys/create`
            });
            actions.push({
                id: "create-ai-provider",
                label: t("commandPaletteCreateAiProvider"),
                icon: <Sparkles className="size-4" />,
                href: `/${orgId}/settings/ai-providers/create`
            });
            actions.push({
                id: "create-virtual-api-key",
                label: t("commandPaletteCreateVirtualApiKey"),
                icon: <KeyRound className="size-4" />,
                href: `/${orgId}/settings/virtual-api-keys/keys`
            });

            if (!env?.flags.disableEnterpriseFeatures) {
                actions.push({
                    id: "create-alert-rule",
                    label: t("commandPaletteCreateAlertRule"),
                    icon: <BellRing className="size-4" />,
                    href: `/${orgId}/settings/alerting/create`
                });
            }

            if (
                (build === "oss" && !env?.flags.disableEnterpriseFeatures) ||
                build === "saas" ||
                env?.app.identityProviderMode === "org" ||
                (env?.app.identityProviderMode === undefined && build !== "oss")
            ) {
                actions.push({
                    id: "create-idp",
                    label: t("commandPaletteCreateIdentityProvider"),
                    icon: <Plus className="size-4" />,
                    href: `/${orgId}/settings/idp/create`
                });
            }
        }

        actions.push({
            id: "toggle-theme",
            label: t("commandPaletteToggleTheme"),
            icon: <SunMoon className="size-4" />,
            onSelect: cycleTheme
        });

        if (user.serverAdmin && !isAdminPage) {
            actions.push({
                id: "go-admin",
                label: t("serverAdmin"),
                icon: <Building2 className="size-4" />,
                href: "/admin/users"
            });
        }

        return actions;
    }, [isAdminPage, orgId, orgs, env, user.serverAdmin, theme, setTheme, t]);
}
