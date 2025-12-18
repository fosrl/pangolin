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
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import {
    PickRemoteExitNodeDefaultsResponse,
    QuickStartRemoteExitNodeResponse
} from "@server/routers/remoteExitNode/types";
import { useRemoteExitNodeContext } from "@app/hooks/useRemoteExitNodeContext";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
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
    const { remoteExitNode } = useRemoteExitNodeContext();

    const [modalOpen, setModalOpen] = useState(false);
    const [credentials, setCredentials] =
        useState<PickRemoteExitNodeDefaultsResponse | null>(null);
    const [currentRemoteExitNodeId, setCurrentRemoteExitNodeId] = useState<
        string | null
    >(remoteExitNode.remoteExitNodeId);
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
            const response = await api.get<
                AxiosResponse<PickRemoteExitNodeDefaultsResponse>
            >(`/org/${orgId}/pick-remote-exit-node-defaults`);

            const data = response.data.data;
            setCredentials(data);

            const rekeyRes = await api.put<
                AxiosResponse<QuickStartRemoteExitNodeResponse>
            >(`/re-key/${orgId}/regenerate-remote-exit-node-secret`, {
                remoteExitNodeId: remoteExitNode.remoteExitNodeId,
                secret: data.secret,
                disconnect: shouldDisconnect
            });

            if (rekeyRes && rekeyRes.status === 200) {
                const rekeyData = rekeyRes.data.data;
                if (rekeyData && rekeyData.remoteExitNodeId) {
                    setCurrentRemoteExitNodeId(rekeyData.remoteExitNodeId);
                    setRegeneratedSecret(data.secret);
                    setCredentials({
                        ...data,
                        remoteExitNodeId: rekeyData.remoteExitNodeId
                    });
                    setShowCredentialsAlert(true);
                }
            }

            toast({
                title: t("credentialsSaved"),
                description: t("credentialsSavedDescription")
            });
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
        return (
            remoteExitNode?.name ||
            remoteExitNode?.remoteExitNodeId ||
            "My remote exit node"
        );
    };

    const displayRemoteExitNodeId =
        currentRemoteExitNodeId || remoteExitNode?.remoteExitNodeId || null;
    const displaySecret = regeneratedSecret || null;

    return (
        <>
            <SettingsContainer>
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("credentials")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("remoteNodeCredentialsDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <PaidFeaturesAlert />

                        <InfoSections cols={3}>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("endpoint")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    <CopyToClipboard
                                        text={env.app.dashboardUrl}
                                    />
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("remoteExitNodeId")}
                                </InfoSectionTitle>
                                <InfoSectionContent>
                                    {displayRemoteExitNodeId ? (
                                        <CopyToClipboard
                                            text={displayRemoteExitNodeId}
                                        />
                                    ) : (
                                        <span>{"••••••••••••••••"}</span>
                                    )}
                                </InfoSectionContent>
                            </InfoSection>
                            <InfoSection>
                                <InfoSectionTitle>
                                    {t("remoteExitNodeSecretKey")}
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
                                    {t("credentialsSave") ||
                                        "Save the Credentials"}
                                </AlertTitle>
                                <AlertDescription>
                                    {t("credentialsSaveDescription") ||
                                        "You will only be able to see this once. Make sure to copy it to a secure place."}
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
                                {t("remoteExitNodeRegenerateAndDisconnect")}
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
                                        "remoteExitNodeRegenerateAndDisconnectConfirmation"
                                    )}
                                </p>
                                <p>
                                    {t(
                                        "remoteExitNodeRegenerateAndDisconnectWarning"
                                    )}
                                </p>
                            </>
                        ) : (
                            <>
                                <p>
                                    {t(
                                        "remoteExitNodeRegenerateCredentialsConfirmation"
                                    )}
                                </p>
                                <p>
                                    {t(
                                        "remoteExitNodeRegenerateCredentialsWarning"
                                    )}
                                </p>
                            </>
                        )}
                    </div>
                }
                buttonText={
                    shouldDisconnect
                        ? t("remoteExitNodeRegenerateAndDisconnect")
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
