"use client";

import {
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { useTranslations } from "next-intl";
import { PolicyAuthMethodRow } from "./PolicyAuthMethodRow";
import type { PolicyAuthMethodId } from "./policy-auth-method-id";
import {
    getEmailWhitelistSummary,
    getHeaderAuthSummary,
    getMtlsSummary,
    getPasscodeSummary,
    getPincodeSummary
} from "./policy-auth-summaries";

export type PolicyAuthOtherMethodsSectionProps = {
    pinActive: boolean;
    passcodeActive: boolean;
    emailWhitelistEnabled: boolean;
    headerAuthActive: boolean;
    headerAuthUser: string;
    emailCount: number;
    emailEnabled: boolean;
    disabled?: boolean;
    // false shows only mTLS, e.g. for inference resources
    credentialMethods?: boolean;
    onConfigure: (method: PolicyAuthMethodId) => void;
    onTogglePincode: (active: boolean) => void;
    onTogglePasscode: (active: boolean) => void;
    onToggleEmail: (active: boolean) => void;
    onToggleHeaderAuth: (active: boolean) => void;
    mtls?: {
        active: boolean;
        certificateCount: number;
        sslEnabled: boolean;
        disabled?: boolean;
        onConfigure: () => void;
        onToggle: (active: boolean) => void;
    };
};

export function PolicyAuthOtherMethodsSection({
    pinActive,
    passcodeActive,
    emailWhitelistEnabled,
    headerAuthActive,
    headerAuthUser,
    emailCount,
    emailEnabled,
    disabled,
    credentialMethods = true,
    onConfigure,
    onTogglePincode,
    onTogglePasscode,
    onToggleEmail,
    onToggleHeaderAuth,
    mtls
}: PolicyAuthOtherMethodsSectionProps) {
    const t = useTranslations();

    return (
        <SettingsFormGrid>
            <SettingsFormCell span="full">
                <SettingsSubsectionHeader>
                    <SettingsSubsectionTitle>
                        {t("policyAuthOtherMethodsTitle")}
                    </SettingsSubsectionTitle>
                    <SettingsSubsectionDescription>
                        {t("policyAuthOtherMethodsDescription")}
                    </SettingsSubsectionDescription>
                </SettingsSubsectionHeader>
            </SettingsFormCell>
            <SettingsFormCell span="full">
                <div className="flex flex-col gap-3">
                    {credentialMethods && (
                        <>
                            <PolicyAuthMethodRow
                                id="pincode"
                                title={t("policyAuthPincodeTitle")}
                                description={t("policyAuthPincodeDescription")}
                                summary={getPincodeSummary({ t })}
                                active={pinActive}
                                onConfigure={() => onConfigure("pincode")}
                                onToggle={onTogglePincode}
                                disabled={disabled}
                            />

                            <PolicyAuthMethodRow
                                id="passcode"
                                title={t("policyAuthPasscodeTitle")}
                                description={t("policyAuthPasscodeDescription")}
                                summary={getPasscodeSummary({ t })}
                                active={passcodeActive}
                                onConfigure={() => onConfigure("passcode")}
                                onToggle={onTogglePasscode}
                                disabled={disabled}
                            />

                            <PolicyAuthMethodRow
                                id="email"
                                title={t("policyAuthEmailTitle")}
                                description={t("policyAuthEmailDescription")}
                                summary={getEmailWhitelistSummary({
                                    t,
                                    count: emailCount
                                })}
                                active={emailWhitelistEnabled}
                                onConfigure={() => onConfigure("email")}
                                onToggle={onToggleEmail}
                                disabled={disabled || !emailEnabled}
                            />

                            <PolicyAuthMethodRow
                                id="header-auth"
                                title={t("policyAuthHeaderAuthTitle")}
                                description={t(
                                    "policyAuthHeaderAuthDescription"
                                )}
                                summary={getHeaderAuthSummary({
                                    t,
                                    headerName: headerAuthUser
                                })}
                                active={headerAuthActive}
                                onConfigure={() => onConfigure("headerAuth")}
                                onToggle={onToggleHeaderAuth}
                                disabled={disabled}
                            />
                        </>
                    )}

                    {mtls && (
                        <PolicyAuthMethodRow
                            id="mtls"
                            title={t("policyAuthMtlsTitle")}
                            description={
                                mtls.sslEnabled
                                    ? t("policyAuthMtlsDescription")
                                    : t("mtlsRequiresSsl")
                            }
                            summary={getMtlsSummary({
                                t,
                                count: mtls.certificateCount
                            })}
                            active={mtls.active}
                            onConfigure={mtls.onConfigure}
                            onToggle={mtls.onToggle}
                            disabled={mtls.disabled || !mtls.sslEnabled}
                        />
                    )}
                </div>
            </SettingsFormCell>
        </SettingsFormGrid>
    );
}
