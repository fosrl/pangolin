"use client";

import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { Form } from "@app/components/ui/form";
import { createGatewayFormSchema } from "@app/lib/privateResourceForm";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PrivateResourceSitesField } from "@app/components/PrivateResourceSitesField";
import { useSaveSiteResource } from "@app/hooks/useSaveSiteResource";
import { buildSelectedSitesForResource } from "@app/lib/privateResourceUtils";

export default function PrivateResourceGatewayPage() {
    const t = useTranslations();
    const { save, siteResource } = useSaveSiteResource();
    const [selectedSites, setSelectedSites] = useState(() =>
        buildSelectedSitesForResource(siteResource)
    );

    const formSchema = useMemo(() => createGatewayFormSchema(t), [t]);
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            siteIds: siteResource.siteIds,
            mode: "gateway"
        }
    });

    const [, formAction, saveLoading] = useActionState(async () => {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();
        await save({
            siteIds: data.siteIds,
            mode: "gateway"
        });
    }, null);

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("gatewaySettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t(
                            "editInternalResourceDialogDestinationGatewayDescription"
                        )}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                action={formAction}
                                id="private-resource-gateway-form"
                            >
                                <SettingsFormGrid>
                                    <SettingsFormCell span="half">
                                        <PrivateResourceSitesField
                                            control={form.control}
                                            orgId={siteResource.orgId}
                                            selectedSites={selectedSites}
                                            onSelectedSitesChange={
                                                setSelectedSites
                                            }
                                        />
                                    </SettingsFormCell>
                                </SettingsFormGrid>
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="private-resource-gateway-form"
                        loading={saveLoading}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
