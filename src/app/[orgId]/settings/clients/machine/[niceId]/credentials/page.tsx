"use client";

import { useState } from "react";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PickClientDefaultsResponse } from "@server/routers/client";
import { useClientContext } from "@app/hooks/useClientContext";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";
import { build } from "@server/build";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon } from "lucide-react";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";

export default function CredentialsPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams();
    const router = useRouter();
    const t = useTranslations();
    const { client } = useClientContext();

    const [modalOpen, setModalOpen] = useState(false);
    const [clientDefaults, setClientDefaults] =
        useState<PickClientDefaultsResponse | null>(null);
    const [currentOlmId, setCurrentOlmId] = useState<string | null>(
        client.olmId
    );
    const [regeneratedSecret, setRegeneratedSecret] = useState<string | null>(
        null
    );
    const [showCredentialsAlert, setShowCredentialsAlert] = useState(false);
    const [shouldDisconnect, setShouldDisconnect] = useState(true);

    const { licenseStatus, isUnlocked } = useLicenseStatusContext();
    const subscription = useSubscriptionStatusContext();

    const isSecurityFeatureDisabled = () => {
        const isEnterpriseNotLicensed = build === "enterprise" && !isUnlocked();
        const isSaasNotSubscribed =
            build === "saas" && !subscription?.isSubscribed();
        return isEnterpriseNotLicensed || isSaasNotSubscribed;
    };

    const handleConfirmRegenerate = async () => {
        try {
            const res = await api.get(`/org/${orgId}/pick-client-defaults`);
            if (res && res.status === 200) {
                const data = res.data.data;

                const rekeyRes = await api.post(
                    `/re-key/${client?.clientId}/regenerate-client-secret`,
                    {
                        secret: data.olmSecret,
                        disconnect: shouldDisconnect
                    }
                );

                if (rekeyRes && rekeyRes.status === 200) {
                    const rekeyData = rekeyRes.data.data;
                    if (rekeyData && rekeyData.olmId) {
                        setCurrentOlmId(rekeyData.olmId);
                        setRegeneratedSecret(data.olmSecret);
                        setClientDefaults({
                            ...data,
                            olmId: rekeyData.olmId
                        });
                        setShowCredentialsAlert(true);
                    }
                }

                toast({
                    title: t("credentialsSaved"),
                    description: t("credentialsSavedDescription")
                });
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("error") || "Error",
                description:
                    formatAxiosError(error) ||
                    t("credentialsRegenerateError") ||
                    "Failed to regenerate credentials"
            });
        }
    };

    const getConfirmationString = () => {
        return client?.name || client?.clientId?.toString() || "My client";
    };

    const displayOlmId = currentOlmId || clientDefaults?.olmId || null;
    const displaySecret = regeneratedSecret || null;

    return (
        <>
            <SettingsContainer>
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("clientOlmCredentials")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("clientOlmCredentialsDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <PaidFeaturesAlert />

                        <InfoSections cols={3}>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("olmEndpoint")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard
                                        text={env.app.dashboardUrl}
                                    />
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("olmId")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {displayOlmId ? (
                                        <CopyToClipboard text={displayOlmId} />
                                    ) : (
                                        <span>{"••••••••••••••••"}</span>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("olmSecretKey")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {displaySecret ? (
                                        <CopyToClipboard text={displaySecret} />
                                    ) : (
                                        <span>
                                            {"••••••••••••••••••••••••••••••••"}
                                        </span>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                        </InfoSections>

                        {showCredentialsAlert && displaySecret && (
                            <Alert variant="neutral" className="mt-4">
                                <InfoIcon className="h-4 w-4" />
                                <AlertTitle className="font-semibold">
                                    {t("clientCredentialsSave")}
                                </AlertTitle>
                                <AlertDescription>
                                    {t("clientCredentialsSaveDescription")}
                                </AlertDescription>
                            </Alert>
                        )}
                    </SettingsSectionBody>
                    {build !== "oss" && (
                        <SettingsSectionFooter>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setShouldDisconnect(false);
                                    setModalOpen(true);
                                }}
                                disabled={isSecurityFeatureDisabled()}
                            >
                                {t("regenerateCredentialsButton")}
                            </Button>
                            <Button
                                onClick={() => {
                                    setShouldDisconnect(true);
                                    setModalOpen(true);
                                }}
                                disabled={isSecurityFeatureDisabled()}
                            >
                                {t("clientRegenerateAndDisconnect")}
                            </Button>
                        </SettingsSectionFooter>
                    )}
                </SettingsSection>
            </SettingsContainer>

            <ConfirmDeleteDialog
                open={modalOpen}
                setOpen={(val) => {
                    setModalOpen(val);
                    // Prevent modal from reopening during refresh
                    if (!val) {
                        setTimeout(() => {
                            router.refresh();
                        }, 150);
                    }
                }}
                dialog={
                    <div className="space-y-2">
                        {shouldDisconnect ? (
                            <>
                                <p>
                                    {t(
                                        "clientRegenerateAndDisconnectConfirmation"
                                    )}
                                </p>
                                <p>
                                    {t("clientRegenerateAndDisconnectWarning")}
                                </p>
                            </>
                        ) : (
                            <>
                                <p>
                                    {t(
                                        "clientRegenerateCredentialsConfirmation"
                                    )}
                                </p>
                                <p>{t("clientRegenerateCredentialsWarning")}</p>
                            </>
                        )}
                    </div>
                }
                buttonText={
                    shouldDisconnect
                        ? t("clientRegenerateAndDisconnect")
                        : t("regenerateCredentialsButton")
                }
                onConfirm={handleConfirmRegenerate}
                string={getConfirmationString()}
                title={t("regenerateCredentials")}
                warningText={t("cannotbeUndone")}
            />
        </>
    );
}
