"use client";

import { useState, useEffect } from "react";
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
import { PickSiteDefaultsResponse } from "@server/routers/site";
import { useSiteContext } from "@app/hooks/useSiteContext";
import { generateKeypair } from "../wireguardConfig";
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
import CopyTextBox from "@app/components/CopyTextBox";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon } from "lucide-react";
import {
    generateWireGuardConfig,
    generateObfuscatedWireGuardConfig
} from "@app/lib/wireguard";
import { QRCodeCanvas } from "qrcode.react";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";

export default function CredentialsPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams();
    const router = useRouter();
    const t = useTranslations();
    const { site } = useSiteContext();

    const [modalOpen, setModalOpen] = useState(false);
    const [siteDefaults, setSiteDefaults] =
        useState<PickSiteDefaultsResponse | null>(null);
    const [wgConfig, setWgConfig] = useState("");
    const [publicKey, setPublicKey] = useState("");
    const [currentNewtId, setCurrentNewtId] = useState<string | null>(
        site.newtId
    );
    const [regeneratedSecret, setRegeneratedSecret] = useState<string | null>(
        null
    );
    const [showCredentialsAlert, setShowCredentialsAlert] = useState(false);
    const [showWireGuardAlert, setShowWireGuardAlert] = useState(false);
    const [loadingDefaults, setLoadingDefaults] = useState(false);
    const [shouldDisconnect, setShouldDisconnect] = useState(true);

    const { licenseStatus, isUnlocked } = useLicenseStatusContext();
    const subscription = useSubscriptionStatusContext();

    const isSecurityFeatureDisabled = () => {
        const isEnterpriseNotLicensed = build === "enterprise" && !isUnlocked();
        const isSaasNotSubscribed =
            build === "saas" && !subscription?.isSubscribed();
        return isEnterpriseNotLicensed || isSaasNotSubscribed;
    };

    // Fetch site defaults for wireguard sites to show in obfuscated config
    useEffect(() => {
        const fetchSiteDefaults = async () => {
            if (site?.type === "wireguard" && !siteDefaults && orgId) {
                setLoadingDefaults(true);
                try {
                    const res = await api.get(
                        `/org/${orgId}/pick-site-defaults`
                    );
                    if (res && res.status === 200) {
                        setSiteDefaults(res.data.data);
                    }
                } catch (error) {
                    // Silently fail - we'll use site data or obfuscated values
                } finally {
                    setLoadingDefaults(false);
                }
            } else {
                setLoadingDefaults(false);
            }
        };
        fetchSiteDefaults();
    }, []);

    const handleConfirmRegenerate = async () => {
        try {
            let generatedPublicKey = "";
            let generatedWgConfig = "";

            if (site?.type === "wireguard") {
                const generatedKeypair = generateKeypair();
                generatedPublicKey = generatedKeypair.publicKey;
                setPublicKey(generatedPublicKey);

                const res = await api.get(`/org/${orgId}/pick-site-defaults`);
                if (res && res.status === 200) {
                    const data = res.data.data;
                    setSiteDefaults(data);

                    // generate config with the fetched data
                    generatedWgConfig = generateWireGuardConfig(
                        generatedKeypair.privateKey,
                        data.publicKey,
                        data.subnet,
                        data.address,
                        data.endpoint,
                        data.listenPort
                    );
                    setWgConfig(generatedWgConfig);
                    setShowWireGuardAlert(true);
                }

                await api.post(
                    `/re-key/${site?.siteId}/regenerate-site-secret`,
                    {
                        type: "wireguard",
                        pubKey: generatedPublicKey
                    }
                );
            }

            if (site?.type === "newt") {
                const res = await api.get(`/org/${orgId}/pick-site-defaults`);
                if (res && res.status === 200) {
                    const data = res.data.data;

                    const rekeyRes = await api.post(
                        `/re-key/${site?.siteId}/regenerate-site-secret`,
                        {
                            type: "newt",
                            secret: data.newtSecret,
                            disconnect: shouldDisconnect
                        }
                    );

                    if (rekeyRes && rekeyRes.status === 200) {
                        const rekeyData = rekeyRes.data.data;
                        if (rekeyData && rekeyData.newtId) {
                            setCurrentNewtId(rekeyData.newtId);
                            setRegeneratedSecret(data.newtSecret);
                            setSiteDefaults({
                                ...data,
                                newtId: rekeyData.newtId
                            });
                            setShowCredentialsAlert(true);
                        }
                    }
                }
            }

            toast({
                title: t("credentialsSaved"),
                description: t("credentialsSavedDescription")
            });

            // ConfirmDeleteDialog handles closing the modal and triggering refresh via setOpen callback
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
        return site?.name || site?.niceId || "My site";
    };

    const displayNewtId = currentNewtId || siteDefaults?.newtId || null;
    const displaySecret = regeneratedSecret || null;

    return (
        <>
            <SettingsContainer>
                {site?.type === "newt" && (
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("siteNewtCredentials")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("siteNewtCredentialsDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>

                        <PaidFeaturesAlert />

                        <SettingsSectionBody>
                            <InfoSections cols={3}>
                                <InfoSection>
                                    <InfoSectionTitle>
                                        {t("newtEndpoint")}
                                    </InfoSectionTitle>
                                    <InfoSectionContent>
                                        <CopyToClipboard
                                            text={env.app.dashboardUrl}
                                        />
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle>
                                        {t("newtId")}
                                    </InfoSectionTitle>
                                    <InfoSectionContent>
                                        {displayNewtId ? (
                                            <CopyToClipboard
                                                text={displayNewtId}
                                            />
                                        ) : (
                                            <span>{"••••••••••••••••"}</span>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                                <InfoSection>
                                    <InfoSectionTitle>
                                        {t("newtSecretKey")}
                                    </InfoSectionTitle>
                                    <InfoSectionContent>
                                        {displaySecret ? (
                                            <CopyToClipboard
                                                text={displaySecret}
                                            />
                                        ) : (
                                            <span>
                                                {
                                                    "••••••••••••••••••••••••••••••••"
                                                }
                                            </span>
                                        )}
                                    </InfoSectionContent>
                                </InfoSection>
                            </InfoSections>

                            {showCredentialsAlert && displaySecret && (
                                <Alert variant="neutral" className="mt-4">
                                    <InfoIcon className="h-4 w-4" />
                                    <AlertTitle className="font-semibold">
                                        {t("siteCredentialsSave")}
                                    </AlertTitle>
                                    <AlertDescription>
                                        {t("siteCredentialsSaveDescription")}
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
                                    {t("siteRegenerateAndDisconnect")}
                                </Button>
                            </SettingsSectionFooter>
                        )}
                    </SettingsSection>
                )}

                {site?.type === "wireguard" && (
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("generatedcredentials")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("regenerateCredentials")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>

                        <PaidFeaturesAlert />

                        <SettingsSectionBody>
                            {!loadingDefaults && (
                                <>
                                    {wgConfig ? (
                                        <div className="flex items-center gap-4">
                                            <CopyTextBox
                                                text={wgConfig}
                                                outline={true}
                                            />
                                            <div className="relative w-fit border rounded-md">
                                                <div className="bg-white p-6 rounded-md">
                                                    <QRCodeCanvas
                                                        value={wgConfig}
                                                        size={168}
                                                        className="mx-auto"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <CopyTextBox
                                            text={generateObfuscatedWireGuardConfig(
                                                {
                                                    subnet:
                                                        siteDefaults?.subnet ||
                                                        site?.subnet ||
                                                        null,
                                                    address:
                                                        siteDefaults?.address ||
                                                        site?.address ||
                                                        null,
                                                    endpoint:
                                                        siteDefaults?.endpoint ||
                                                        site?.endpoint ||
                                                        null,
                                                    listenPort:
                                                        siteDefaults?.listenPort ||
                                                        site?.listenPort ||
                                                        null,
                                                    publicKey:
                                                        siteDefaults?.publicKey ||
                                                        site?.publicKey ||
                                                        site?.pubKey ||
                                                        null
                                                }
                                            )}
                                            outline={true}
                                        />
                                    )}
                                    {showWireGuardAlert && wgConfig && (
                                        <Alert
                                            variant="neutral"
                                            className="mt-4"
                                        >
                                            <InfoIcon className="h-4 w-4" />
                                            <AlertTitle className="font-semibold">
                                                {t("siteCredentialsSave")}
                                            </AlertTitle>
                                            <AlertDescription>
                                                {t(
                                                    "siteCredentialsSaveDescription"
                                                )}
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </>
                            )}
                        </SettingsSectionBody>
                        {build === "enterprise" && (
                            <SettingsSectionFooter>
                                <Button
                                    onClick={() => setModalOpen(true)}
                                    disabled={isSecurityFeatureDisabled()}
                                >
                                    {t("siteRegenerateAndDisconnect")}
                                </Button>
                            </SettingsSectionFooter>
                        )}
                    </SettingsSection>
                )}
            </SettingsContainer>

            {site?.type === "newt" && (
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
                                            "siteRegenerateAndDisconnectConfirmation"
                                        )}
                                    </p>
                                    <p>
                                        {t(
                                            "siteRegenerateAndDisconnectWarning"
                                        )}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p>
                                        {t(
                                            "siteRegenerateCredentialsConfirmation"
                                        )}
                                    </p>
                                    <p>
                                        {t("siteRegenerateCredentialsWarning")}
                                    </p>
                                </>
                            )}
                        </div>
                    }
                    buttonText={
                        shouldDisconnect
                            ? t("siteRegenerateAndDisconnect")
                            : t("regenerateCredentialsButton")
                    }
                    onConfirm={handleConfirmRegenerate}
                    string={getConfirmationString()}
                    title={t("regenerateCredentials")}
                    warningText={t("cannotbeUndone")}
                />
            )}

            {site?.type === "wireguard" && (
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
                            <p>{t("regenerateCredentialsConfirmation")}</p>
                            <p>{t("regenerateCredentialsWarning")}</p>
                        </div>
                    }
                    buttonText={t("regenerateCredentialsButton")}
                    onConfirm={handleConfirmRegenerate}
                    string={getConfirmationString()}
                    title={t("regenerateCredentials")}
                    warningText={t("cannotbeUndone")}
                />
            )}
        </>
    );
}
