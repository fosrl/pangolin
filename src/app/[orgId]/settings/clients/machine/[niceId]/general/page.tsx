"use client";

import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
import { useClientContext } from "@app/hooks/useClientContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListSitesResponse } from "@server/routers/site";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import ActionBanner from "@app/components/ActionBanner";
import { Shield, ShieldOff } from "lucide-react";
import OrgRolesTagField from "@app/components/OrgRolesTagField";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const GeneralFormSchema = z.object({
    name: z.string().nonempty("Name is required"),
    niceId: z.string().min(1).max(255).optional()
});

type GeneralFormValues = z.infer<typeof GeneralFormSchema>;

const RolesFormSchema = z.object({
    roles: z.array(
        z.object({
            id: z.string(),
            text: z.string(),
            isAdmin: z.boolean().optional()
        })
    )
});

type RolesFormValues = z.infer<typeof RolesFormSchema>;

export default function GeneralPage() {
    const t = useTranslations();
    const { client, updateClient } = useClientContext();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const [loading, setLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [savingRoles, setSavingRoles] = useState(false);
    const { isPaidUser } = usePaidStatus();
    const canAssignRoles = isPaidUser(tierMatrix.fullRbac);

    const rolesForm = useForm({
        resolver: zodResolver(RolesFormSchema),
        defaultValues: {
            roles: (client?.roles ?? []).map((r) => ({
                id: r.roleId.toString(),
                text: r.name
            }))
        }
    });

    const form = useForm({
        resolver: zodResolver(GeneralFormSchema),
        defaultValues: {
            name: client?.name,
            niceId: client?.niceId || ""
        },
        mode: "onChange"
    });

    // Fetch available sites and client's assigned sites
    useEffect(() => {
        const fetchSites = async () => {
            try {
                // Fetch all available sites
                const res = await api.get<AxiosResponse<ListSitesResponse>>(
                    `/org/${client?.orgId}/sites/`
                );
            } catch (e) {
                toast({
                    variant: "destructive",
                    title: "Failed to fetch sites",
                    description: formatAxiosError(
                        e,
                        "An error occurred while fetching sites."
                    )
                });
            }
        };

        if (client?.clientId) {
            fetchSites();
        }
    }, [client?.clientId, client?.orgId, api, form]);

    async function onSubmit(data: GeneralFormValues) {
        setLoading(true);

        try {
            await api.post(`/client/${client?.clientId}`, {
                name: data.name,
                niceId: data.niceId
            });

            updateClient({ name: data.name, niceId: data.niceId });

            toast({
                title: t("clientUpdated"),
                description: t("clientUpdatedDescription")
            });

            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("clientUpdateFailed"),
                description: formatAxiosError(e, t("clientUpdateError"))
            });
        } finally {
            setLoading(false);
        }
    }

    async function onSubmitRoles(data: RolesFormValues) {
        if (!client?.clientId) return;
        setSavingRoles(true);

        try {
            const roleIds = data.roles.map((r) => parseInt(r.id, 10));
            await api.post(`/client/${client.clientId}/roles`, { roleIds });

            updateClient({
                roles: data.roles.map((r) => ({
                    roleId: parseInt(r.id, 10),
                    name: r.text
                }))
            });

            toast({
                title: t("machineClientRolesUpdated"),
                description: t("machineClientRolesUpdatedDescription")
            });

            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("machineClientRolesUpdateFailed"),
                description: formatAxiosError(
                    e,
                    t("machineClientRolesUpdateError")
                )
            });
        } finally {
            setSavingRoles(false);
        }
    }

    const handleUnblock = async () => {
        if (!client?.clientId) return;
        setIsRefreshing(true);
        try {
            await api.post(`/client/${client.clientId}/unblock`);
            // Optimistically update the client context
            updateClient({ blocked: false, approvalState: null });
            toast({
                title: t("unblockClient"),
                description: t("unblockClientDescription")
            });
            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("error"),
                description: formatAxiosError(e, t("error"))
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    return (
        <SettingsContainer>
            {/* Blocked Device Banner */}
            {client?.blocked && (
                <ActionBanner
                    variant="destructive"
                    title={t("blocked")}
                    titleIcon={<Shield className="w-5 h-5" />}
                    description={t("deviceBlockedDescription")}
                    actions={
                        <Button
                            onClick={handleUnblock}
                            disabled={isRefreshing}
                            loading={isRefreshing}
                            variant="outline"
                            className="gap-2"
                        >
                            <ShieldOff className="size-4" />
                            {t("unblock")}
                        </Button>
                    }
                />
            )}
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("generalSettings")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("generalSettingsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="general-settings-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("name")}</FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="niceId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("identifier")}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    placeholder={t(
                                                        "enterIdentifier"
                                                    )}
                                                    className="flex-1"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="general-settings-form"
                        loading={loading}
                        disabled={loading}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>

            {!env.flags.disableEnterpriseFeatures && (
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("roles")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("machineClientRolesDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>

                    <SettingsSectionBody>
                        <PaidFeaturesAlert tiers={tierMatrix.fullRbac} />

                        <SettingsSectionForm>
                            <Form {...rolesForm}>
                                <form
                                    onSubmit={rolesForm.handleSubmit(
                                        onSubmitRoles
                                    )}
                                    className="space-y-4"
                                    id="roles-settings-form"
                                >
                                    <OrgRolesTagField
                                        form={rolesForm}
                                        name="roles"
                                        orgId={client.orgId}
                                        supportsMultipleRolesPerUser={true}
                                        showMultiRolePaywallMessage={false}
                                        paywallMessage=""
                                        disabled={!canAssignRoles}
                                    />
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>

                    <SettingsSectionFooter>
                        <Button
                            type="submit"
                            form="roles-settings-form"
                            loading={savingRoles}
                            disabled={savingRoles || !canAssignRoles}
                        >
                            {t("saveSettings")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>
            )}
        </SettingsContainer>
    );
}
