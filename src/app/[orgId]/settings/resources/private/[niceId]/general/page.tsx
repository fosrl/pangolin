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
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { SwitchInput } from "@app/components/SwitchInput";
import { createGeneralFormSchema } from "@app/lib/privateResourceForm";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useSaveSiteResource } from "@app/hooks/useSaveSiteResource";

export default function PrivateResourceGeneralPage() {
    const t = useTranslations();
    const { save, siteResource } = useSaveSiteResource();

    const formSchema = useMemo(() => createGeneralFormSchema(t), [t]);
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: siteResource.name,
            niceId: siteResource.niceId,
            enabled: siteResource.enabled
        }
    });

    const [, formAction, saveLoading] = useActionState(async () => {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();
        await save({
            name: data.name,
            niceId: data.niceId,
            enabled: data.enabled
        });
    }, null);

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("resourceGeneral")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("privateResourceGeneralDescription")}
                    </SettingsSectionDescription>
                    {siteResource.mode === "inference" ? (
                        <p className="text-sm pt-1">
                            <Link
                                href={`/${siteResource.orgId}?openResource=${encodeURIComponent(siteResource.niceId)}&openResourceQuery=${encodeURIComponent(siteResource.name)}`}
                                className="text-primary hover:underline"
                            >
                                {t("resourceGeneralAiClientConfigLink")}
                            </Link>
                        </p>
                    ) : null}
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                action={formAction}
                                id="private-resource-general-form"
                            >
                                <SettingsFormGrid>
                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="enabled"
                                            render={() => (
                                                <FormItem>
                                                    <FormControl>
                                                        <SwitchInput
                                                            id="enable-resource"
                                                            defaultChecked={
                                                                siteResource.enabled
                                                            }
                                                            label={t(
                                                                "resourceEnable"
                                                            )}
                                                            onCheckedChange={(
                                                                val
                                                            ) =>
                                                                form.setValue(
                                                                    "enabled",
                                                                    val
                                                                )
                                                            }
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        {t(
                                                            "disabledResourceDescription"
                                                        )}
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>

                                    <SettingsFormCell span="half">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "editInternalResourceDialogName"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>
                                    <SettingsFormCell span="half">
                                        <FormField
                                            control={form.control}
                                            name="niceId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("identifier")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
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
                        form="private-resource-general-form"
                        loading={saveLoading}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
