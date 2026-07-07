"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeadersInput } from "@app/components/HeadersInput";
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
import { SwitchInput } from "@app/components/SwitchInput";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import type { ResourceContextType } from "@app/contexts/resourceContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { resourceQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { UpdateResourceResponse } from "@server/routers/resource";
import { tlsNameSchema } from "@server/lib/schemas";
import { useQuery } from "@tanstack/react-query";
import {
    ProxyResourceTargetsForm
} from "@app/app/[orgId]/settings/resources/public/ProxyResourceTargetsForm";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export default function ReverseProxyTargetsPage() {
    const params = useParams();
    const { resource, updateResource } = useResourceContext();

    const { data: remoteTargets = [], isLoading: isLoadingTargets } = useQuery(
        resourceQueries.resourceTargets({
            resourceId: resource.resourceId
        })
    );

    if (isLoadingTargets) {
        return null;
    }

    return (
        <SettingsContainer>
            <ProxyResourceTargetsForm
                orgId={params.orgId as string}
                isHttp={["http", "ssh", "rdp", "vnc"].includes(resource.mode)}
                initialTargets={remoteTargets}
                resource={resource}
                updateResource={updateResource}
            />

            {["http", "ssh", "rdp", "vnc"].includes(resource.mode) && (
                <ProxyResourceHttpForm
                    resource={resource}
                    updateResource={updateResource}
                />
            )}
        </SettingsContainer>
    );
}

function ProxyResourceHttpForm({
    resource,
    updateResource
}: Pick<ResourceContextType, "resource" | "updateResource">) {
    const t = useTranslations();
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const httpSettingsSchema = z.object({
        stickySession: z.boolean(),
        ssl: z.boolean(),
        tlsServerName: z
            .string()
            .optional()
            .refine(
                (data) => {
                    if (data) {
                        return tlsNameSchema.safeParse(data).success;
                    }
                    return true;
                },
                {
                    message: t("proxyErrorTls")
                }
            ),
        setHostHeader: z
            .string()
            .optional()
            .refine(
                (data) => {
                    if (data) {
                        return tlsNameSchema.safeParse(data).success;
                    }
                    return true;
                },
                {
                    message: t("proxyErrorInvalidHeader")
                }
            ),
        headers: z
            .array(z.object({ name: z.string(), value: z.string() }))
            .nullable()
    });

    const form = useForm({
        resolver: zodResolver(httpSettingsSchema),
        defaultValues: {
            stickySession: resource.stickySession,
            ssl: resource.ssl,
            tlsServerName: resource.tlsServerName || "",
            setHostHeader: resource.setHostHeader || "",
            headers: resource.headers
        },
        mode: "onChange"
    });

    const [, formAction, saveLoading] = useActionState(onSubmit, null);
    const [headersValid, setHeadersValid] = useState(true);

    async function onSubmit() {
        const isValid = await form.trigger();
        if (!isValid) return;

        if (!headersValid) {
            toast({
                variant: "destructive",
                title: t("settingsErrorUpdate"),
                description: t("headersValidationError")
            });
            return;
        }

        const data = form.getValues();

        const res = await api
            .post<AxiosResponse<UpdateResourceResponse>>(
                `/resource/${resource.resourceId}`,
                {
                    stickySession: data.stickySession,
                    ssl: data.ssl,
                    tlsServerName: data.tlsServerName || null,
                    setHostHeader: data.setHostHeader || null,
                    headers: data.headers || null
                }
            )
            .catch((err) => {
                toast({
                    variant: "destructive",
                    title: t("settingsErrorUpdate"),
                    description: formatAxiosError(
                        err,
                        t("settingsErrorUpdateDescription")
                    )
                });
            });

        if (res && res.status === 200) {
            updateResource({
                ...resource,
                stickySession: data.stickySession,
                ssl: data.ssl,
                tlsServerName: data.tlsServerName || null,
                setHostHeader: data.setHostHeader || null,
                headers: data.headers || null
            });

            toast({
                title: t("settingsUpdated"),
                description: t("settingsUpdatedDescription")
            });

            router.refresh();
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("proxyAdditional")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("proxyAdditionalDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>

            <SettingsSectionBody>
                <SettingsSectionForm variant="half">
                    <Form {...form}>
                        <form action={formAction} id="http-settings-form">
                            <SettingsFormGrid>
                                {!env.flags.usePangolinDns && (
                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="ssl"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <SwitchInput
                                                            id="ssl-toggle"
                                                            label={t(
                                                                "proxyEnableSSL"
                                                            )}
                                                            description={t(
                                                                "proxyEnableSSLDescription"
                                                            )}
                                                            checked={
                                                                field.value
                                                            }
                                                            onCheckedChange={
                                                                field.onChange
                                                            }
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>
                                )}

                                <SettingsFormCell span="half">
                                    <FormField
                                        control={form.control}
                                        name="tlsServerName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("targetTlsSni")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "targetTlsSniDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </SettingsFormCell>

                                <SettingsFormCell span="full">
                                    <FormField
                                        control={form.control}
                                        name="stickySession"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <SwitchInput
                                                        id="sticky-toggle"
                                                        label={t(
                                                            "targetStickySessions"
                                                        )}
                                                        description={t(
                                                            "targetStickySessionsDescription"
                                                        )}
                                                        checked={field.value}
                                                        onCheckedChange={
                                                            field.onChange
                                                        }
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </SettingsFormCell>

                                <SettingsFormCell span="half">
                                    <FormField
                                        control={form.control}
                                        name="setHostHeader"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("proxyCustomHeader")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "proxyCustomHeaderDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </SettingsFormCell>

                                <SettingsFormCell span="full">
                                    <FormField
                                        control={form.control}
                                        name="headers"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("customHeaders")}
                                                </FormLabel>
                                                <FormControl>
                                                    <HeadersInput
                                                        value={field.value}
                                                        onChange={
                                                            field.onChange
                                                        }
                                                        onValidityChange={
                                                            setHeadersValid
                                                        }
                                                        rows={4}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "customHeadersDescription"
                                                    )}
                                                </FormDescription>
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
                    loading={saveLoading}
                    disabled={saveLoading || !headersValid}
                    form="http-settings-form"
                >
                    {t("saveSettings")}
                </Button>
            </SettingsSectionFooter>
        </SettingsSection>
    );
}
