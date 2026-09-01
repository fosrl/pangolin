"use client";

import { SettingsFormCell } from "@app/components/Settings";
import {
    StrategySelect,
    type StrategyOption
} from "@app/components/StrategySelect";
import { Badge } from "@app/components/ui/badge";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export type SshServerSettingsFormFields = {
    pamMode: "passthrough" | "push";
    standardDaemonLocation: "site" | "remote";
    authDaemonPort: string;
};

type SshServerSettingsFieldsProps = {
    pamMode: "passthrough" | "push";
    standardDaemonLocation: "site" | "remote";
    authDaemonPort: string;
    onPamModeChange: (value: "passthrough" | "push") => void;
    onStandardDaemonLocationChange: (value: "site" | "remote") => void;
    onAuthDaemonPortChange: (value: string) => void;
    authDaemonPortError?: string;
    sshServerMode: "standard" | "native";
    serverModeDisplay: "badge" | "select";
    onServerModeChange?: (mode: "standard" | "native") => void;
    sshServerModeOptions?: StrategyOption<"standard" | "native">[];
    idPrefix?: string;
};

export function SshServerSettingsFields({
    pamMode,
    standardDaemonLocation,
    authDaemonPort,
    onPamModeChange,
    onStandardDaemonLocationChange,
    onAuthDaemonPortChange,
    authDaemonPortError,
    sshServerMode,
    serverModeDisplay,
    onServerModeChange,
    sshServerModeOptions,
    idPrefix = "ssh-server"
}: SshServerSettingsFieldsProps) {
    const t = useTranslations();
    const isNative = sshServerMode === "native";
    const showDaemonLocation = !isNative && pamMode === "push";
    const showDaemonPort =
        !isNative && pamMode === "push" && standardDaemonLocation === "remote";

    const authMethodOptions = useMemo(
        (): StrategyOption<"passthrough" | "push">[] => [
            {
                id: "passthrough",
                title: t("sshAuthMethodManual"),
                description: t("sshAuthMethodManualDescription")
            },
            {
                id: "push",
                title: t("sshAuthMethodAutomated"),
                description: t("sshAuthMethodAutomatedDescription")
            }
        ],
        [t]
    );

    const daemonLocationOptions = useMemo(
        (): StrategyOption<"site" | "remote">[] => [
            {
                id: "site",
                title: t("internalResourceAuthDaemonSite"),
                description: t("sshDaemonLocationSiteDescription")
            },
            {
                id: "remote",
                title: t("sshDaemonLocationRemote"),
                description: t("sshDaemonLocationRemoteDescription")
            }
        ],
        [t]
    );

    const defaultSshServerModeOptions = useMemo(
        (): StrategyOption<"standard" | "native">[] => [
            {
                id: "native",
                title: t("sshServerModePangolin"),
                description: t("sshServerModeNativeDescription")
            },
            {
                id: "standard",
                title: t("sshServerModeStandard"),
                description: t("sshServerModeStandardDescription")
            }
        ],
        [t]
    );

    const modeOptions = sshServerModeOptions ?? defaultSshServerModeOptions;

    return (
        <>
            <SettingsFormCell span="full">
                <div className="space-y-2">
                    <p className="font-semibold text-sm">
                        {t("sshServerMode")}
                    </p>
                    {serverModeDisplay === "badge" ? (
                        <Badge variant="secondary">
                            {sshServerMode === "standard"
                                ? t("sshServerModeStandard")
                                : t("sshServerModePangolin")}
                        </Badge>
                    ) : (
                        <StrategySelect<"standard" | "native">
                            idPrefix={`${idPrefix}-mode`}
                            value={sshServerMode}
                            options={modeOptions}
                            onChange={(value) => onServerModeChange?.(value)}
                            cols={2}
                        />
                    )}
                </div>
            </SettingsFormCell>

            <SettingsFormCell span="full">
                <div className="space-y-2">
                    <p className="font-semibold text-sm">
                        {t("sshAuthenticationMethod")}
                    </p>
                    <StrategySelect<"passthrough" | "push">
                        idPrefix={`${idPrefix}-auth`}
                        value={pamMode}
                        options={authMethodOptions}
                        onChange={onPamModeChange}
                        cols={2}
                    />
                </div>
            </SettingsFormCell>

            {showDaemonLocation && (
                <SettingsFormCell span="full">
                    <div className="space-y-2">
                        <p className="font-semibold text-sm">
                            {t("sshAuthDaemonLocation")}
                        </p>
                        <StrategySelect<"site" | "remote">
                            idPrefix={`${idPrefix}-daemon`}
                            value={standardDaemonLocation}
                            options={daemonLocationOptions}
                            onChange={onStandardDaemonLocationChange}
                            cols={2}
                        />
                        <p className="text-sm text-muted-foreground">
                            {t("sshDaemonDisclaimer")}{" "}
                            <a
                                href="https://docs.pangolin.net/manage/ssh"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                                {t("learnMore")}
                                <ExternalLink className="size-3.5 shrink-0" />
                            </a>
                        </p>
                    </div>
                </SettingsFormCell>
            )}

            {showDaemonPort && (
                <SettingsFormCell span="half">
                    <div className="grid gap-2">
                        <Label htmlFor={`${idPrefix}-daemon-port`}>
                            {t("sshDaemonPort")}
                        </Label>
                        <Input
                            id={`${idPrefix}-daemon-port`}
                            type="number"
                            min={1}
                            max={65535}
                            value={authDaemonPort}
                            onChange={(e) =>
                                onAuthDaemonPortChange(e.target.value)
                            }
                        />
                        {authDaemonPortError ? (
                            <p className="text-destructive text-sm">
                                {authDaemonPortError}
                            </p>
                        ) : null}
                    </div>
                </SettingsFormCell>
            )}
        </>
    );
}
