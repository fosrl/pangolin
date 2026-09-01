"use client";

import CopyToClipboard from "@app/components/CopyToClipboard";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { useMyVirtualApiKeySecret } from "@app/hooks/useMyVirtualApiKeySecret";
import { launcherQueries } from "@app/lib/queries";
import type { VirtualApiKeyWithResources } from "@server/routers/virtualApiKey/types";
import { formatVirtualApiKeyPreview } from "@app/lib/virtualApiKeyFormat";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

type LauncherInferenceApiKeysSectionProps = {
    orgId: string;
    resourceGuid: string;
};

function PanelKeySecret({
    orgId,
    virtualApiKeyId,
    lastChars
}: {
    orgId: string;
    virtualApiKeyId: string;
    lastChars: string;
}) {
    const t = useTranslations();
    const preview = formatVirtualApiKeyPreview(virtualApiKeyId, lastChars);
    const { credential, revealed, loading, getCopyText, revealSecret } =
        useMyVirtualApiKeySecret(orgId, virtualApiKeyId);
    const displayValue = revealed && credential ? credential : preview;

    return (
        <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0 flex-1">
                <CopyToClipboard
                    text={displayValue}
                    displayText={displayValue}
                    getCopyText={getCopyText}
                />
            </div>
            {!revealed ? (
                <Button
                    variant="link"
                    size="sm"
                    className="shrink-0 px-0 h-auto"
                    loading={loading}
                    onClick={revealSecret}
                >
                    {t("myVirtualApiKeysRevealSecret")}
                </Button>
            ) : null}
        </div>
    );
}

function ManualKeyRow({
    orgId,
    keyRow
}: {
    orgId: string;
    keyRow: VirtualApiKeyWithResources;
}) {
    const t = useTranslations();

    return (
        <div className="space-y-1 min-w-0">
            <p className="font-medium truncate">
                {keyRow.name || t("myVirtualApiKeysUnnamed")}
            </p>
            {keyRow.description ? (
                <p className="text-sm text-muted-foreground">
                    {keyRow.description}
                </p>
            ) : null}
            <PanelKeySecret
                orgId={orgId}
                virtualApiKeyId={keyRow.virtualApiKeyId}
                lastChars={keyRow.lastChars}
            />
        </div>
    );
}

export function LauncherInferenceApiKeysSection({
    orgId,
    resourceGuid
}: LauncherInferenceApiKeysSectionProps) {
    const t = useTranslations();
    const { data, isPending, isError } = useQuery(
        launcherQueries.myVirtualApiKeys(orgId, resourceGuid)
    );

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("resourceLauncherApiKeys")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("resourceLauncherApiKeysDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                {isPending ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                        <Loader2 className="size-5 animate-spin" />
                    </div>
                ) : null}
                {isError ? (
                    <p className="text-sm text-muted-foreground">
                        {t("resourceLauncherApiKeysError")}
                    </p>
                ) : null}
                {!isPending && !isError && data ? (
                    <div className="space-y-4">
                        <div className="space-y-1 min-w-0">
                            <p className="font-medium">
                                {t("resourceLauncherApiKeysIdentity")}
                            </p>
                            <PanelKeySecret
                                orgId={orgId}
                                virtualApiKeyId={data.userKey.virtualApiKeyId}
                                lastChars={data.userKey.lastChars}
                            />
                        </div>
                        {data.manualKeys.length > 0 ? (
                            <div>
                                <SettingsSubsectionHeader>
                                    <SettingsSubsectionTitle>
                                        {t("resourceLauncherApiKeysManual")}
                                    </SettingsSubsectionTitle>
                                    <SettingsSubsectionDescription>
                                        {t(
                                            "myVirtualApiKeysManualResourceDescription",
                                            {
                                                resourceName:
                                                    data.resourceName ??
                                                    t("resource")
                                            }
                                        )}
                                    </SettingsSubsectionDescription>
                                </SettingsSubsectionHeader>
                                <div className="space-y-3">
                                    {data.manualKeys.map((keyRow) => (
                                        <ManualKeyRow
                                            key={keyRow.virtualApiKeyId}
                                            orgId={orgId}
                                            keyRow={keyRow}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </SettingsSectionBody>
        </SettingsSection>
    );
}
