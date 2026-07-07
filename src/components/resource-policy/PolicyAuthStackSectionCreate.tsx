"use client";

import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { RolesSelector } from "@app/components/roles-selector";
import { UsersSelector } from "@app/components/users-selector";
import { FormField } from "@app/components/ui/form";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import type { PolicyFormValues } from ".";
import {
    EmailCredenza,
    HeaderAuthCredenza,
    PasscodeCredenza,
    PincodeCredenza
} from "./PolicyAuthMethodCredenzas";
import { PolicyAuthOtherMethodsSection } from "./PolicyAuthOtherMethodsSection";
import { PolicyAuthSsoSection } from "./PolicyAuthSsoSection";
import type { PolicyAuthMethodId } from "./policy-auth-method-id";

export type PolicyAuthStackSectionCreateProps = {
    form: UseFormReturn<PolicyFormValues, any, any>;
    orgId: string;
    allIdps: { id: number; text: string }[];
    emailEnabled: boolean;
};

export function PolicyAuthStackSectionCreate({
    form: parentForm,
    orgId,
    allIdps,
    emailEnabled
}: PolicyAuthStackSectionCreateProps) {
    const t = useTranslations();
    const [editingMethod, setEditingMethod] =
        useState<PolicyAuthMethodId | null>(null);

    const sso = useWatch({ control: parentForm.control, name: "sso" });
    const skipToIdpId = useWatch({
        control: parentForm.control,
        name: "skipToIdpId"
    });
    const password = useWatch({
        control: parentForm.control,
        name: "password"
    });
    const pincode = useWatch({ control: parentForm.control, name: "pincode" });
    const headerAuth = useWatch({
        control: parentForm.control,
        name: "headerAuth"
    });
    const emailWhitelistEnabled = useWatch({
        control: parentForm.control,
        name: "emailWhitelistEnabled"
    });
    const emails =
        useWatch({ control: parentForm.control, name: "emails" }) ?? [];

    const passcodeActive = Boolean(password);
    const pinActive = Boolean(pincode);
    const headerAuthActive = Boolean(headerAuth);

    const closeCredenza = () => setEditingMethod(null);

    const handleToggle = (
        method: PolicyAuthMethodId,
        active: boolean,
        onDisable: () => void,
        onEnable?: () => void
    ) => {
        if (active) {
            onEnable?.();
            setEditingMethod(method);
            return;
        }
        onDisable();
        setEditingMethod((current) => (current === method ? null : current));
    };

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("policyAuthStackTitle")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("policyAuthStackDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <SettingsSectionForm variant="half">
                    <PolicyAuthSsoSection
                        sso={Boolean(sso)}
                        onSsoChange={(active) =>
                            parentForm.setValue("sso", active)
                        }
                        skipToIdpId={skipToIdpId}
                        onSkipToIdpChange={(id) =>
                            parentForm.setValue("skipToIdpId", id)
                        }
                        allIdps={allIdps}
                        rolesEditor={
                            <FormField<PolicyFormValues, "roles">
                                control={parentForm.control}
                                name="roles"
                                render={({ field }) => (
                                    <RolesSelector
                                        orgId={orgId}
                                        selectedRoles={field.value}
                                        onSelectRoles={(selected) =>
                                            parentForm.setValue(
                                                "roles",
                                                selected
                                            )
                                        }
                                        restrictAdminRole
                                    />
                                )}
                            />
                        }
                        usersEditor={
                            <FormField<PolicyFormValues, "users">
                                control={parentForm.control}
                                name="users"
                                render={({ field }) => (
                                    <UsersSelector
                                        orgId={orgId}
                                        selectedUsers={field.value}
                                        onSelectUsers={(selected) =>
                                            parentForm.setValue(
                                                "users",
                                                selected
                                            )
                                        }
                                    />
                                )}
                            />
                        }
                    />

                    <PolicyAuthOtherMethodsSection
                        pinActive={pinActive}
                        passcodeActive={passcodeActive}
                        emailWhitelistEnabled={Boolean(emailWhitelistEnabled)}
                        headerAuthActive={headerAuthActive}
                        headerAuthUser={headerAuth?.user ?? ""}
                        emailCount={emails.length}
                        emailEnabled={emailEnabled}
                        onConfigure={setEditingMethod}
                        onTogglePincode={(active) =>
                            handleToggle("pincode", active, () =>
                                parentForm.setValue("pincode", null)
                            )
                        }
                        onTogglePasscode={(active) =>
                            handleToggle("passcode", active, () =>
                                parentForm.setValue("password", null)
                            )
                        }
                        onToggleEmail={(active) =>
                            handleToggle("email", active, () =>
                                parentForm.setValue(
                                    "emailWhitelistEnabled",
                                    false
                                )
                            )
                        }
                        onToggleHeaderAuth={(active) =>
                            handleToggle("headerAuth", active, () =>
                                parentForm.setValue("headerAuth", null)
                            )
                        }
                    />
                </SettingsSectionForm>

                <PincodeCredenza
                    open={editingMethod === "pincode"}
                    onOpenChange={(open) => !open && closeCredenza()}
                    defaultPincode={pincode?.pincode ?? ""}
                    onSave={(value) => {
                        parentForm.setValue("pincode", { pincode: value });
                    }}
                />

                <PasscodeCredenza
                    open={editingMethod === "passcode"}
                    onOpenChange={(open) => !open && closeCredenza()}
                    defaultPassword={password?.password ?? ""}
                    onSave={(value) => {
                        parentForm.setValue("password", { password: value });
                    }}
                />

                <EmailCredenza
                    open={editingMethod === "email"}
                    onOpenChange={(open) => !open && closeCredenza()}
                    emailEnabled={emailEnabled}
                    emails={emails}
                    onSave={(value) => {
                        parentForm.setValue(
                            "emails",
                            value as PolicyFormValues["emails"]
                        );
                        parentForm.setValue("emailWhitelistEnabled", true);
                    }}
                />

                <HeaderAuthCredenza
                    open={editingMethod === "headerAuth"}
                    onOpenChange={(open) => !open && closeCredenza()}
                    defaultValues={
                        headerAuth
                            ? {
                                  user: headerAuth.user,
                                  password: headerAuth.password,
                                  extendedCompatibility:
                                      headerAuth.extendedCompatibility
                              }
                            : undefined
                    }
                    onSave={(value) => {
                        parentForm.setValue("headerAuth", value);
                    }}
                />
            </SettingsSectionBody>
        </SettingsSection>
    );
}
