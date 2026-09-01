"use client";

import {
    SettingsContainer,
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
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useSiteResourceContext } from "@app/hooks/useSiteResourceContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import {
    accessTagsToIds,
    buildUpdateSiteResourcePayload,
    createAccessFormSchema,
    mergeFormValuesWithResource
} from "@app/lib/privateResourceForm";
import { resourceQueries, orgQueries } from "@app/lib/queries";
import { useAccessFormDefaults } from "@app/providers/SiteResourceProvider";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { PrivateResourceAccessFields } from "@app/components/PrivateResourceAccessFields";

export default function PrivateResourceAccessPage() {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();
    const { siteResource, setAccess } = useSiteResourceContext();
    const { loading, roles, users, clients, hasMachineClients } =
        useAccessFormDefaults(siteResource.orgId, siteResource.id);

    const machineClientsQuery = useQuery(
        orgQueries.machineClients({
            orgId: siteResource.orgId,
            perPage: 1
        })
    );
    const hasMachineClientsResolved =
        (machineClientsQuery.data ?? []).filter((c) => !c.userId).length > 0;

    const form = useForm({
        resolver: zodResolver(createAccessFormSchema()),
        defaultValues: {
            roles: [] as typeof roles,
            users: [] as typeof users,
            clients: [] as typeof clients
        }
    });

    useEffect(() => {
        if (!loading) {
            form.reset({ roles, users, clients });
        }
    }, [loading, roles, users, clients, form]);

    const [, formAction, saveLoading] = useActionState(async () => {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();
        const access = accessTagsToIds({
            roles: data.roles,
            users: data.users,
            clients: data.clients
        });

        const merged = mergeFormValuesWithResource(siteResource, {});
        const payload = buildUpdateSiteResourcePayload(merged, access);

        try {
            await api.post(`/site-resource/${siteResource.id}`, payload);
            setAccess(access);

            await Promise.all([
                queryClient.invalidateQueries(
                    resourceQueries.siteResourceRoles({
                        siteResourceId: siteResource.id
                    })
                ),
                queryClient.invalidateQueries(
                    resourceQueries.siteResourceUsers({
                        siteResourceId: siteResource.id
                    })
                ),
                queryClient.invalidateQueries(
                    resourceQueries.siteResourceClients({
                        siteResourceId: siteResource.id
                    })
                )
            ]);

            toast({
                title: t("editInternalResourceDialogSuccess"),
                description: t(
                    "editInternalResourceDialogInternalResourceUpdatedSuccessfully"
                )
            });
        } catch (error) {
            toast({
                title: t("editInternalResourceDialogError"),
                description: formatAxiosError(
                    error,
                    t(
                        "editInternalResourceDialogFailedToUpdateInternalResource"
                    )
                ),
                variant: "destructive"
            });
        }
    }, null);

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("authentication")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t(
                            "editInternalResourceDialogAccessControlDescription"
                        )}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm variant="half">
                        <Form {...form}>
                            <form
                                action={formAction}
                                id="private-resource-access-form"
                            >
                                <PrivateResourceAccessFields
                                    control={form.control}
                                    orgId={siteResource.orgId}
                                    loading={loading}
                                    hasMachineClients={
                                        hasMachineClients ||
                                        hasMachineClientsResolved
                                    }
                                />
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="private-resource-access-form"
                        loading={saveLoading}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
