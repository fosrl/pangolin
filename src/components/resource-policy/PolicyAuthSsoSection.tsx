"use client";

import { SettingsFormCell, SettingsFormGrid } from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { Button } from "@app/components/ui/button";
import {
    FormControl,
    FormDescription,
    FormItem,
    FormLabel
} from "@app/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export type PolicyAuthSsoSectionProps = {
    sso: boolean;
    onSsoChange: (active: boolean) => void;
    skipToIdpId: number | null | undefined;
    onSkipToIdpChange: (id: number | null) => void;
    allIdps: { id: number; text: string }[];
    rolesEditor: React.ReactNode;
    usersEditor: React.ReactNode;
    disabled?: boolean;
    idpDisabled?: boolean;
};

export function PolicyAuthSsoSection({
    sso,
    onSsoChange,
    skipToIdpId,
    onSkipToIdpChange,
    allIdps,
    rolesEditor,
    usersEditor,
    disabled,
    idpDisabled
}: PolicyAuthSsoSectionProps) {
    const t = useTranslations();
    const [showIdpSelect, setShowIdpSelect] = useState(skipToIdpId != null);

    useEffect(() => {
        if (skipToIdpId != null) {
            setShowIdpSelect(true);
        }
    }, [skipToIdpId]);

    const idpSelectDisabled = idpDisabled ?? disabled;

    return (
        <SettingsFormGrid>
            <SettingsFormCell span="full">
                <SwitchInput
                    id="policy-auth-sso"
                    label={t("policyAuthSsoTitle")}
                    description={t("policyAuthSsoDescription")}
                    checked={sso}
                    disabled={disabled}
                    onCheckedChange={onSsoChange}
                />
            </SettingsFormCell>

            {sso && (
                <>
                    <SettingsFormCell span="full">
                        <FormItem>
                            <FormLabel>{t("roles")}</FormLabel>
                            {rolesEditor}
                        </FormItem>
                    </SettingsFormCell>
                    <SettingsFormCell span="full">
                        <FormItem>
                            <FormLabel>{t("users")}</FormLabel>
                            {usersEditor}
                        </FormItem>
                    </SettingsFormCell>
                    {allIdps.length > 0 && (
                        <SettingsFormCell span="half">
                            {skipToIdpId == null && !showIdpSelect ? (
                                <Button
                                    type="button"
                                    variant="text"
                                    size="sm"
                                    className="h-auto px-0"
                                    disabled={idpSelectDisabled}
                                    onClick={() => setShowIdpSelect(true)}
                                >
                                    {t("policyAuthAddDefaultIdentityProvider")}
                                </Button>
                            ) : (
                                <FormItem>
                                    <FormLabel>
                                        {t("defaultIdentityProvider")}
                                    </FormLabel>
                                    <Select
                                        disabled={idpSelectDisabled}
                                        onValueChange={(value) => {
                                            if (value === "none") {
                                                onSkipToIdpChange(null);
                                                setShowIdpSelect(false);
                                                return;
                                            }
                                            onSkipToIdpChange(parseInt(value));
                                        }}
                                        value={
                                            skipToIdpId
                                                ? skipToIdpId.toString()
                                                : "none"
                                        }
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={t(
                                                        "selectIdpPlaceholder"
                                                    )}
                                                />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="none">
                                                {t("none")}
                                            </SelectItem>
                                            {allIdps.map((idp) => (
                                                <SelectItem
                                                    key={idp.id}
                                                    value={idp.id.toString()}
                                                >
                                                    {idp.text}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>
                                        {t(
                                            "defaultIdentityProviderDescription"
                                        )}
                                    </FormDescription>
                                </FormItem>
                            )}
                        </SettingsFormCell>
                    )}
                </>
            )}
        </SettingsFormGrid>
    );
}
