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
    onConfigure: (method: PolicyAuthMethodId) => void;
    onTogglePincode: (active: boolean) => void;
    onTogglePasscode: (active: boolean) => void;
    onToggleEmail: (active: boolean) => void;
    onToggleHeaderAuth: (active: boolean) => void;
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
    onConfigure,
    onTogglePincode,
    onTogglePasscode,
    onToggleEmail,
    onToggleHeaderAuth
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
                        description={t("policyAuthHeaderAuthDescription")}
                        summary={getHeaderAuthSummary({
                            t,
                            headerName: headerAuthUser
                        })}
                        active={headerAuthActive}
                        onConfigure={() => onConfigure("headerAuth")}
                        onToggle={onToggleHeaderAuth}
                        disabled={disabled}
                    />
                </div>
            </SettingsFormCell>
        </SettingsFormGrid>
    );
}
