"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsFormGrid
} from "@app/components/Settings";
import { SshServerSettingsFields } from "@app/components/SshServerSettingsFields";
import { Button } from "@app/components/ui/button";
import { Form } from "@app/components/ui/form";
import {
    createSshFormSchema,
    inferSshPamMode
} from "@app/lib/privateResourceForm";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PrivateResourceSshFields } from "@app/components/PrivateResourceSshFields";
import type { Selectedsite } from "@app/components/site-selector";
import { useSaveSiteResource } from "@app/hooks/useSaveSiteResource";
import {
    asAnyControl,
    asAnySetValue,
    asAnyWatch
} from "@app/lib/formControlUtils";
import { buildSelectedSitesForResource } from "@app/lib/privateResourceUtils";

export default function PrivateResourceSshPage() {
    const t = useTranslations();
    const { save, siteResource } = useSaveSiteResource();
    const isNative = siteResource.authDaemonMode === "native";
    const [sshServerMode] = useState<"standard" | "native">(
        isNative ? "native" : "standard"
    );
    const [selectedSites, setSelectedSites] = useState(() =>
        buildSelectedSitesForResource(siteResource)
    );

    const formSchema = useMemo(
        () => createSshFormSchema(t, { isNative }),
        [t, isNative]
    );
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            siteIds: siteResource.siteIds,
            mode: "ssh",
            destination: siteResource.destination ?? "",
            alias: siteResource.alias ?? null,
            destinationPort: siteResource.destinationPort ?? null,
            pamMode: inferSshPamMode(
                siteResource.authDaemonMode,
                siteResource.pamMode
            ),
            standardDaemonLocation: isNative
                ? "site"
                : siteResource.authDaemonMode === "remote"
                  ? "remote"
                  : "site",
            authDaemonPort: siteResource.authDaemonPort
                ? String(siteResource.authDaemonPort)
                : "22123"
        }
    });

    const pamMode = form.watch("pamMode");
    const standardDaemonLocation = form.watch("standardDaemonLocation");
    const authDaemonPort = form.watch("authDaemonPort");

    function trimSitesToFirst() {
        if (selectedSites.length <= 1) return;

        const first = selectedSites.slice(0, 1);
        setSelectedSites(first);
        form.setValue(
            "siteIds",
            first.map((s: Selectedsite) => s.siteId),
            { shouldValidate: true }
        );
    }

    function handlePamModeChange(value: "passthrough" | "push") {
        form.setValue("pamMode", value, { shouldValidate: true });

        if (value === "push") {
            if (
                standardDaemonLocation !== "remote" &&
                selectedSites.length > 1
            ) {
                trimSitesToFirst();
            }
            return;
        }

        form.setValue("authDaemonPort", "22123", { shouldValidate: true });
    }

    function handleDaemonLocationChange(value: "site" | "remote") {
        form.setValue("standardDaemonLocation", value, {
            shouldValidate: true
        });

        if (value === "site") {
            form.setValue("authDaemonPort", "22123", { shouldValidate: true });
            trimSitesToFirst();
        }
    }

    const [, formAction, saveLoading] = useActionState(async () => {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();
        const effectiveAuthDaemonMode = isNative
            ? "native"
            : data.standardDaemonLocation;
        const effectiveAuthDaemonPort =
            !isNative &&
            data.pamMode === "push" &&
            data.standardDaemonLocation === "remote"
                ? Number(data.authDaemonPort)
                : null;

        await save({
            siteIds: data.siteIds,
            mode: "ssh",
            destination: isNative ? null : data.destination,
            alias: data.alias,
            destinationPort: isNative ? null : data.destinationPort,
            authDaemonMode: effectiveAuthDaemonMode,
            authDaemonPort: effectiveAuthDaemonPort,
            pamMode: data.pamMode
        });
    }, null);

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("sshSettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("editInternalResourceDialogDestinationDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <Form {...form}>
                    <SettingsSectionBody>
                        <SettingsSectionForm variant="half">
                            <SettingsFormGrid>
                                <SshServerSettingsFields
                                    idPrefix="private-ssh-edit"
                                    pamMode={pamMode}
                                    standardDaemonLocation={
                                        standardDaemonLocation
                                    }
                                    authDaemonPort={authDaemonPort}
                                    onPamModeChange={handlePamModeChange}
                                    onStandardDaemonLocationChange={
                                        handleDaemonLocationChange
                                    }
                                    onAuthDaemonPortChange={(value) =>
                                        form.setValue("authDaemonPort", value, {
                                            shouldValidate: true
                                        })
                                    }
                                    authDaemonPortError={
                                        form.formState.errors.authDaemonPort
                                            ?.message
                                    }
                                    sshServerMode={sshServerMode}
                                    serverModeDisplay="badge"
                                />
                                <PrivateResourceSshFields
                                    control={asAnyControl(form.control)}
                                    setValue={asAnySetValue(form.setValue)}
                                    watch={asAnyWatch(form.watch)}
                                    orgId={siteResource.orgId}
                                    selectedSites={selectedSites}
                                    onSelectedSitesChange={setSelectedSites}
                                    showSshSettings={false}
                                    embedInParentGrid
                                    isNativeSsh={isNative}
                                />
                            </SettingsFormGrid>
                        </SettingsSectionForm>
                    </SettingsSectionBody>

                    <SettingsSectionFooter>
                        <form action={formAction}>
                            <Button type="submit" loading={saveLoading}>
                                {t("saveSettings")}
                            </Button>
                        </form>
                    </SettingsSectionFooter>
                </Form>
            </SettingsSection>
        </SettingsContainer>
    );
}
