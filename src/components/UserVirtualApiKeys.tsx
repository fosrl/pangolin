"use client";

import { useTranslations } from "next-intl";
import moment from "moment";
import { Button } from "@app/components/ui/button";
import CopyTextBox from "@app/components/CopyTextBox";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { AiClientConfigSection } from "@app/components/ai-client-config/AiClientConfigSection";
import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle as SectionTitle
} from "@app/components/Settings";
import { useMyVirtualApiKeySecret } from "@app/hooks/useMyVirtualApiKeySecret";
import type {
    ListMyVirtualApiKeysResponse,
    VirtualApiKeyWithResources
} from "@server/routers/virtualApiKey/types";
import { formatVirtualApiKeyPreview } from "@app/lib/virtualApiKeyFormat";

type UserVirtualApiKeysProps = {
    orgId: string;
    initialData: ListMyVirtualApiKeysResponse;
    /** The resource's niceId, when this page is scoped to a single resource. */
    resourceNiceId?: string;
    /** The resource's real access URL, when known; falls back to a placeholder otherwise. */
    endpoint?: string;
};

function OwnedKeySecret({
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

function IdentityKeyCenterpiece({
    orgId,
    virtualApiKeyId,
    lastChars,
    resourceName
}: {
    orgId: string;
    virtualApiKeyId: string;
    lastChars: string;
    resourceName?: string | null;
}) {
    const t = useTranslations();
    const preview = formatVirtualApiKeyPreview(virtualApiKeyId, lastChars);
    const { credential, revealed, loading, getCopyText, revealSecret } =
        useMyVirtualApiKeySecret(orgId, virtualApiKeyId);
    const displayValue = revealed && credential ? credential : preview;
    const headline = resourceName
        ? t("myVirtualApiKeysIdentityResourceHeadline", { resourceName })
        : t("myVirtualApiKeysIdentityHeadline");
    const description = resourceName
        ? t("myVirtualApiKeysIdentityResourceDescription", { resourceName })
        : t("myVirtualApiKeysIdentityDescription");

    return (
        <div className="flex flex-col items-center text-center py-10 md:py-14 px-4">
            <h2 className="text-2xl font-semibold tracking-tight max-w-xl">
                {headline}
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg text-sm">
                {description}
            </p>
            <div className="mt-8 w-full max-w-2xl">
                <div className="[&_pre]:text-base [&_code]:font-mono [&_code]:tracking-wide">
                    <CopyTextBox
                        text={displayValue}
                        getCopyText={getCopyText}
                        wrapText={false}
                        centered
                    />
                </div>
                {!revealed ? (
                    <div className="mt-3 flex justify-center">
                        <Button
                            variant="link"
                            className="px-0 h-auto"
                            loading={loading}
                            onClick={revealSecret}
                        >
                            {t("myVirtualApiKeysRevealSecret")}
                        </Button>
                    </div>
                ) : null}
            </div>
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
        <div className="flex flex-col gap-3 border rounded-md p-4">
            <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">
                        {keyRow.name || t("myVirtualApiKeysUnnamed")}
                    </p>
                </div>
                {keyRow.description ? (
                    <p className="text-sm text-muted-foreground">
                        {keyRow.description}
                    </p>
                ) : null}
                <div className="pt-1">
                    <OwnedKeySecret
                        orgId={orgId}
                        virtualApiKeyId={keyRow.virtualApiKeyId}
                        lastChars={keyRow.lastChars}
                    />
                </div>
                <p className="text-xs text-muted-foreground">
                    {t("created")} {moment(keyRow.createdAt).format("lll")}
                </p>
            </div>
        </div>
    );
}

export default function UserVirtualApiKeys({
    orgId,
    initialData,
    resourceNiceId,
    endpoint
}: UserVirtualApiKeysProps) {
    const t = useTranslations();
    const resourceName = initialData.resourceName;
    const { getCopyText: getKeyCopyText } = useMyVirtualApiKeySecret(
        orgId,
        initialData.userKey.virtualApiKeyId
    );

    return (
        <>
            <SettingsContainer>
                <IdentityKeyCenterpiece
                    orgId={orgId}
                    virtualApiKeyId={initialData.userKey.virtualApiKeyId}
                    lastChars={initialData.userKey.lastChars}
                    resourceName={resourceName}
                />

                {initialData.manualKeys.length > 0 ? (
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SectionTitle>
                                {t("myVirtualApiKeysManualTitle")}
                            </SectionTitle>
                            <SettingsSectionDescription>
                                {resourceName
                                    ? t(
                                          "myVirtualApiKeysManualResourceDescription",
                                          { resourceName }
                                      )
                                    : t("myVirtualApiKeysManualDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <SettingsFormGrid>
                                {initialData.manualKeys.map((keyRow) => (
                                    <SettingsFormCell
                                        key={keyRow.virtualApiKeyId}
                                        span="half"
                                    >
                                        <ManualKeyRow
                                            orgId={orgId}
                                            keyRow={keyRow}
                                        />
                                    </SettingsFormCell>
                                ))}
                            </SettingsFormGrid>
                        </SettingsSectionBody>
                    </SettingsSection>
                ) : null}

                <AiClientConfigSection
                    layout="wide"
                    endpoint={endpoint ?? t("aiClientConfigEndpointPlaceholder")}
                    auth={{
                        mode: "keyed",
                        getKeyText: getKeyCopyText
                    }}
                    resourceNiceId={resourceNiceId}
                />
            </SettingsContainer>
        </>
    );
}
