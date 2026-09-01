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
import { createHostFormSchema } from "@app/lib/privateResourceForm";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PrivateResourceSitesField } from "@app/components/PrivateResourceSitesField";
import { PrivateResourceHostDestinationFields } from "@app/components/PrivateResourceDestinationFields";
import { PrivateResourcePortRanges } from "@app/components/PrivateResourcePortRanges";
import { useSaveSiteResource } from "@app/hooks/useSaveSiteResource";
import {
    asAnyControl,
    asAnySetValue,
    asAnyWatch
} from "@app/lib/formControlUtils";
import { buildSelectedSitesForResource } from "@app/lib/privateResourceUtils";

export default function PrivateResourceHostPage() {
    const t = useTranslations();
    const { save, siteResource } = useSaveSiteResource();
    const [selectedSites, setSelectedSites] = useState(() =>
        buildSelectedSitesForResource(siteResource)
    );

    const formSchema = useMemo(() => createHostFormSchema(t), [t]);
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            siteIds: siteResource.siteIds,
            mode: "host",
            destination: siteResource.destination ?? "",
            alias: siteResource.alias ?? null,
            tcpPortRangeString: siteResource.tcpPortRangeString ?? "*",
            udpPortRangeString: siteResource.udpPortRangeString ?? "*",
            disableIcmp: siteResource.disableIcmp ?? false,
            authDaemonMode: siteResource.authDaemonMode ?? "site",
            authDaemonPort: siteResource.authDaemonPort ?? null
        }
    });

    const [, formAction, saveLoading] = useActionState(async () => {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();
        await save({
            siteIds: data.siteIds,
            mode: "host",
            destination: data.destination,
            alias: data.alias,
            tcpPortRangeString: data.tcpPortRangeString,
            udpPortRangeString: data.udpPortRangeString,
            disableIcmp: data.disableIcmp,
            authDaemonMode: data.authDaemonMode,
            authDaemonPort: data.authDaemonPort
        });
    }, null);

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("hostSettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("editInternalResourceDialogDestinationDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                action={formAction}
                                id="private-resource-host-form"
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

                                    <SettingsFormCell span="full">
                                        <PrivateResourceHostDestinationFields
                                            control={asAnyControl(form.control)}
                                            watch={asAnyWatch(form.watch)}
                                        />
                                    </SettingsFormCell>

                                    <SettingsFormCell span="full">
                                        <PrivateResourcePortRanges
                                            control={asAnyControl(form.control)}
                                            setValue={asAnySetValue(
                                                form.setValue
                                            )}
                                            initialTcp={
                                                siteResource.tcpPortRangeString
                                            }
                                            initialUdp={
                                                siteResource.udpPortRangeString
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
                        form="private-resource-host-form"
                        loading={saveLoading}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
