"use client";

import { OptionSelect } from "@app/components/OptionSelect";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SwitchInput } from "@app/components/SwitchInput";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Textarea } from "@app/components/ui/textarea";
import { createApiClient } from "@app/lib/api";
import { orgQueries } from "@app/lib/queries";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { RoleClientSettingsValues } from "@server/routers/role/types";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

export const defaultRoleClientSettings: RoleClientSettingsValues = {
    enabled: false,
    overrideDns: null,
    mtu: null,
    tunnelDns: null,
    primaryDns: null,
    secondaryDns: null,
    exitNodeTakesPrecedence: null,
    exitNodeSiteResourceId: null,
    exitNodeLocked: false,
    matchDomains: null,
    preferLocalRoutes: null
};

type ManagedBoolean = "unmanaged" | "on" | "off";

type BooleanSetting =
    | "overrideDns"
    | "tunnelDns"
    | "exitNodeTakesPrecedence"
    | "preferLocalRoutes";

const NO_EXIT_NODE = "none";

export async function saveRoleClientSettings(
    api: ReturnType<typeof createApiClient>,
    roleId: number,
    settings: RoleClientSettingsValues
) {
    await api.post(`/role/${roleId}/client-settings`, settings);
}

type RoleClientSettingsFieldsProps = {
    orgId: string;
    value: RoleClientSettingsValues;
    onChange: (value: RoleClientSettingsValues) => void;
    disabled?: boolean;
};

export function RoleClientSettingsFields({
    orgId,
    value,
    onChange,
    disabled = false
}: RoleClientSettingsFieldsProps) {
    const t = useTranslations();

    const gatewaysQuery = useQuery({
        ...orgQueries.gatewayResources({ orgId }),
        enabled: !disabled
    });

    const fieldsDisabled = disabled || !value.enabled;

    function update(changes: Partial<RoleClientSettingsValues>) {
        onChange({ ...value, ...changes });
    }

    function renderBooleanSetting(
        setting: BooleanSetting,
        label: string,
        description: string
    ) {
        const current = value[setting];
        return (
            <div className="space-y-2">
                <Label>{label}</Label>
                <OptionSelect<ManagedBoolean>
                    options={[
                        {
                            value: "unmanaged",
                            label: t("clientSettingsUnmanaged")
                        },
                        { value: "on", label: t("clientSettingsOn") },
                        { value: "off", label: t("clientSettingsOff") }
                    ]}
                    value={
                        current === null ? "unmanaged" : current ? "on" : "off"
                    }
                    onChange={(option) =>
                        update({
                            [setting]:
                                option === "unmanaged" ? null : option === "on"
                        })
                    }
                    cols={3}
                    disabled={fieldsDisabled}
                />
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PaidFeaturesAlert tiers={tierMatrix.clientSettings} />

            <SwitchInput
                id="client-settings-enabled"
                label={t("clientSettingsEnabled")}
                description={t("clientSettingsEnabledDescription")}
                checked={value.enabled}
                disabled={disabled}
                onCheckedChange={(enabled) => update({ enabled })}
            />

            {renderBooleanSetting(
                "overrideDns",
                t("clientSettingsOverrideDns"),
                t("clientSettingsOverrideDnsDescription")
            )}
            {renderBooleanSetting(
                "tunnelDns",
                t("clientSettingsTunnelDns"),
                t("clientSettingsTunnelDnsDescription")
            )}

            <div className="space-y-2">
                <Label htmlFor="client-settings-primary-dns">
                    {t("clientSettingsPrimaryDns")}
                </Label>
                <Input
                    id="client-settings-primary-dns"
                    value={value.primaryDns ?? ""}
                    disabled={fieldsDisabled}
                    onChange={(e) =>
                        update({ primaryDns: e.target.value.trim() || null })
                    }
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="client-settings-secondary-dns">
                    {t("clientSettingsSecondaryDns")}
                </Label>
                <Input
                    id="client-settings-secondary-dns"
                    value={value.secondaryDns ?? ""}
                    disabled={fieldsDisabled}
                    onChange={(e) =>
                        update({ secondaryDns: e.target.value.trim() || null })
                    }
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="client-settings-match-domains">
                    {t("clientSettingsMatchDomains")}
                </Label>
                <Textarea
                    id="client-settings-match-domains"
                    className="h-20 min-h-20"
                    value={value.matchDomains?.join("\n") ?? ""}
                    disabled={fieldsDisabled}
                    onChange={(e) => {
                        const lines = e.target.value.split(/\r?\n/);
                        update({
                            matchDomains: e.target.value ? lines : null
                        });
                    }}
                />
                <p className="text-sm text-muted-foreground">
                    {t("clientSettingsMatchDomainsDescription")}
                </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="client-settings-mtu">
                    {t("clientSettingsMtu")}
                </Label>
                <Input
                    id="client-settings-mtu"
                    type="number"
                    min={576}
                    max={65535}
                    value={value.mtu ?? ""}
                    disabled={fieldsDisabled}
                    onChange={(e) =>
                        update({
                            mtu: e.target.value ? Number(e.target.value) : null
                        })
                    }
                />
                <p className="text-sm text-muted-foreground">
                    {t("clientSettingsMtuDescription")}
                </p>
            </div>

            {renderBooleanSetting(
                "preferLocalRoutes",
                t("clientSettingsPreferLocalRoutes"),
                t("clientSettingsPreferLocalRoutesDescription")
            )}
            {renderBooleanSetting(
                "exitNodeTakesPrecedence",
                t("clientSettingsExitNodePrecedence"),
                t("clientSettingsExitNodePrecedenceDescription")
            )}

            <div className="space-y-2">
                <Label>{t("clientSettingsExitNode")}</Label>
                <Select
                    value={
                        value.exitNodeSiteResourceId?.toString() ?? NO_EXIT_NODE
                    }
                    disabled={fieldsDisabled}
                    onValueChange={(option) => {
                        const exitNodeSiteResourceId =
                            option === NO_EXIT_NODE ? null : Number(option);
                        update({
                            exitNodeSiteResourceId,
                            exitNodeLocked:
                                exitNodeSiteResourceId !== null &&
                                value.exitNodeLocked
                        });
                    }}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NO_EXIT_NODE}>
                            {t("clientSettingsUnmanaged")}
                        </SelectItem>
                        {gatewaysQuery.data?.map((gateway) => (
                            <SelectItem
                                key={gateway.siteResourceId}
                                value={gateway.siteResourceId.toString()}
                            >
                                {gateway.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                    {t("clientSettingsExitNodeDescription")}
                </p>
            </div>

            {value.exitNodeSiteResourceId !== null && (
                <div className="space-y-2">
                    <Label>{t("clientSettingsExitNodeMode")}</Label>
                    <OptionSelect<"default" | "locked">
                        options={[
                            {
                                value: "default",
                                label: t("clientSettingsExitNodeDefault")
                            },
                            {
                                value: "locked",
                                label: t("clientSettingsExitNodeLocked")
                            }
                        ]}
                        value={value.exitNodeLocked ? "locked" : "default"}
                        onChange={(mode) =>
                            update({ exitNodeLocked: mode === "locked" })
                        }
                        cols={2}
                        disabled={fieldsDisabled}
                    />
                    <p className="text-sm text-muted-foreground">
                        {t("clientSettingsExitNodeModeDescription")}
                    </p>
                </div>
            )}
        </div>
    );
}
