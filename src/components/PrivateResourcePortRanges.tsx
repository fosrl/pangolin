"use client";

import {
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import {
    getPortModeFromString,
    getPortStringFromMode,
    type PortMode
} from "@app/lib/privateResourceForm";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import type { Control, UseFormSetValue } from "react-hook-form";

type PrivateResourceNetworkAccessFieldsProps = {
    control: Control<any>;
    setValue: UseFormSetValue<any>;
    showPortRanges?: boolean;
    initialTcp?: string | null;
    initialUdp?: string | null;
    disabled?: boolean;
    icmpId?: string;
    embedInParentGrid?: boolean;
};

export function PrivateResourceAllowIcmpField({
    control,
    id = "private-resource-allow-icmp",
    disabled = false
}: {
    control: Control<any>;
    id?: string;
    disabled?: boolean;
}) {
    const t = useTranslations();

    return (
        <FormField
            control={control}
            name="disableIcmp"
            render={({ field }) => (
                <FormItem>
                    <FormControl>
                        <SwitchInput
                            id={id}
                            label={t("privateResourceAllowIcmpPing")}
                            checked={!field.value}
                            onCheckedChange={(checked) =>
                                field.onChange(!checked)
                            }
                            disabled={disabled}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

function PrivateResourceNetworkAccessHeader() {
    const t = useTranslations();

    return (
        <SettingsFormCell span="full">
            <SettingsSubsectionHeader>
                <SettingsSubsectionTitle>
                    {t("privateResourceNetworkAccess")}
                </SettingsSubsectionTitle>
                <SettingsSubsectionDescription>
                    {t("privateResourceNetworkAccessDescription")}
                </SettingsSubsectionDescription>
            </SettingsSubsectionHeader>
        </SettingsFormCell>
    );
}

export function PrivateResourceNetworkAccessFields({
    control,
    setValue,
    showPortRanges = true,
    initialTcp,
    initialUdp,
    disabled = false,
    icmpId = "private-resource-allow-icmp",
    embedInParentGrid = false
}: PrivateResourceNetworkAccessFieldsProps) {
    const t = useTranslations();
    const resolvedInitialTcp = initialTcp !== undefined ? initialTcp : "*";
    const resolvedInitialUdp = initialUdp !== undefined ? initialUdp : "*";
    const [tcpPortMode, setTcpPortMode] = useState<PortMode>(() =>
        getPortModeFromString(resolvedInitialTcp)
    );
    const [udpPortMode, setUdpPortMode] = useState<PortMode>(() =>
        getPortModeFromString(resolvedInitialUdp)
    );
    const [tcpCustomPorts, setTcpCustomPorts] = useState(() =>
        resolvedInitialTcp && resolvedInitialTcp !== "*"
            ? resolvedInitialTcp
            : ""
    );
    const [udpCustomPorts, setUdpCustomPorts] = useState(() =>
        resolvedInitialUdp && resolvedInitialUdp !== "*"
            ? resolvedInitialUdp
            : ""
    );

    useEffect(() => {
        if (!showPortRanges) return;

        setValue(
            "tcpPortRangeString",
            getPortStringFromMode(tcpPortMode, tcpCustomPorts)
        );
    }, [showPortRanges, tcpPortMode, tcpCustomPorts, setValue]);

    useEffect(() => {
        if (!showPortRanges) return;

        setValue(
            "udpPortRangeString",
            getPortStringFromMode(udpPortMode, udpCustomPorts)
        );
    }, [showPortRanges, udpPortMode, udpCustomPorts, setValue]);

    const content: ReactNode = (
        <>
            <PrivateResourceNetworkAccessHeader />

            {showPortRanges ? (
                <>
                    <SettingsFormCell span="full">
                        <FormField
                            control={control}
                            name="tcpPortRangeString"
                            render={() => (
                                <FormItem>
                                    <FormLabel>
                                        {t("editInternalResourceDialogTcp")}
                                    </FormLabel>
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={tcpPortMode}
                                            onValueChange={(v: PortMode) =>
                                                setTcpPortMode(v)
                                            }
                                        >
                                            <FormControl>
                                                <SelectTrigger className="w-[110px]">
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="all">
                                                    {t("allPorts")}
                                                </SelectItem>
                                                <SelectItem value="blocked">
                                                    {t("blocked")}
                                                </SelectItem>
                                                <SelectItem value="custom">
                                                    {t("custom")}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {tcpPortMode === "custom" ? (
                                            <FormControl>
                                                <Input
                                                    className="flex-1"
                                                    placeholder="80,443,8000-9000"
                                                    value={tcpCustomPorts}
                                                    onChange={(e) =>
                                                        setTcpCustomPorts(
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                        ) : (
                                            <Input
                                                className="flex-1"
                                                disabled
                                                placeholder={
                                                    tcpPortMode === "all"
                                                        ? t("allPortsAllowed")
                                                        : t("allPortsBlocked")
                                                }
                                            />
                                        )}
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </SettingsFormCell>

                    <SettingsFormCell span="full">
                        <FormField
                            control={control}
                            name="udpPortRangeString"
                            render={() => (
                                <FormItem>
                                    <FormLabel>
                                        {t("editInternalResourceDialogUdp")}
                                    </FormLabel>
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={udpPortMode}
                                            onValueChange={(v: PortMode) =>
                                                setUdpPortMode(v)
                                            }
                                        >
                                            <FormControl>
                                                <SelectTrigger className="w-[110px]">
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="all">
                                                    {t("allPorts")}
                                                </SelectItem>
                                                <SelectItem value="blocked">
                                                    {t("blocked")}
                                                </SelectItem>
                                                <SelectItem value="custom">
                                                    {t("custom")}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {udpPortMode === "custom" ? (
                                            <FormControl>
                                                <Input
                                                    className="flex-1"
                                                    placeholder="53,123,500-600"
                                                    value={udpCustomPorts}
                                                    onChange={(e) =>
                                                        setUdpCustomPorts(
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                            </FormControl>
                                        ) : (
                                            <Input
                                                className="flex-1"
                                                disabled
                                                placeholder={
                                                    udpPortMode === "all"
                                                        ? t("allPortsAllowed")
                                                        : t("allPortsBlocked")
                                                }
                                            />
                                        )}
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </SettingsFormCell>
                </>
            ) : null}

            <SettingsFormCell span="full">
                <PrivateResourceAllowIcmpField
                    control={control}
                    id={icmpId}
                    disabled={disabled}
                />
            </SettingsFormCell>
        </>
    );

    if (embedInParentGrid) {
        return content;
    }

    return <SettingsFormGrid>{content}</SettingsFormGrid>;
}

export function PrivateResourcePortRanges(
    props: Omit<
        PrivateResourceNetworkAccessFieldsProps,
        "showPortRanges" | "embedInParentGrid"
    >
) {
    return <PrivateResourceNetworkAccessFields showPortRanges {...props} />;
}
