"use client";

import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { Button } from "@app/components/ui/button";
import { Form } from "@app/components/ui/form";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

type IdpStoreLoginClaimsSectionProps = {
    /** `/idp/:idpId` or `/org/:orgId/idp/:idpId`. */
    apiBase: string;
    storeLoginClaims: boolean;
};

const formSchema = z.object({ storeLoginClaims: z.boolean() });

/** Turns the per-user snapshot of the last login's claims on or off. */
export default function IdpStoreLoginClaimsSection({
    apiBase,
    storeLoginClaims
}: IdpStoreLoginClaimsSectionProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const [saving, setSaving] = useState(false);

    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: { storeLoginClaims }
    });
    const checked = useWatch({
        control: form.control,
        name: "storeLoginClaims"
    });

    async function onSubmit(data: z.infer<typeof formSchema>) {
        setSaving(true);
        try {
            await api.post(`${apiBase}/oidc`, {
                storeLoginClaims: data.storeLoginClaims
            });
            form.reset(data);
            toast({
                title: t("success"),
                description: t("idpStoreLoginClaimsSaved")
            });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("idpStoreLoginClaimsTitle")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("idpStoreLoginClaimsDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <Form {...form}>
                    <form
                        id="idp-store-login-claims-form"
                        onSubmit={form.handleSubmit(onSubmit)}
                    >
                        <SwitchInput
                            id="idp-store-login-claims"
                            label={t("idpStoreLoginClaims")}
                            checked={checked}
                            onCheckedChange={(value) =>
                                form.setValue("storeLoginClaims", value, {
                                    shouldDirty: true
                                })
                            }
                        />
                    </form>
                </Form>
                {form.formState.defaultValues?.storeLoginClaims && !checked && (
                    <p className="text-sm text-muted-foreground">
                        {t("idpStoreLoginClaimsOffWarning")}
                    </p>
                )}
            </SettingsSectionBody>
            <SettingsSectionFooter>
                <Button
                    type="submit"
                    form="idp-store-login-claims-form"
                    loading={saving}
                    disabled={saving}
                >
                    {t("saveSettings")}
                </Button>
            </SettingsSectionFooter>
        </SettingsSection>
    );
}
