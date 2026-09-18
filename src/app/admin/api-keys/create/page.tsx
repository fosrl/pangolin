"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { z } from "zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@app/components/ui/input";
import { InfoIcon } from "lucide-react";
import { Button } from "@app/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { AxiosResponse } from "axios";
import { useRouter } from "next/navigation";
import {
    CreateOrgApiKeyBody,
    CreateOrgApiKeyResponse
} from "@server/routers/apiKeys";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import CopyToClipboard from "@app/components/CopyToClipboard";
import moment from "moment";
import CopyTextBox from "@app/components/CopyTextBox";
import PermissionsSelectBox from "@app/components/PermissionsSelectBox";
import { useTranslations } from "next-intl";
import {
    Credenza,
    CredenzaBody,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
    const t = useTranslations();

    const [loadingPage, setLoadingPage] = useState(true);
    const [createLoading, setCreateLoading] = useState(false);
    const [apiKey, setApiKey] = useState<CreateOrgApiKeyResponse | null>(null);
    const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
    const [selectedPermissions, setSelectedPermissions] = useState<
        Record<string, boolean>
    >({});

    const createFormSchema = z.object({
        name: z
            .string()
            .min(2, {
                message: t("nameMin", { len: 2 })
            })
            .max(255, {
                message: t("nameMax", { len: 255 })
            })
    });

    type CreateFormValues = z.infer<typeof createFormSchema>;

    const form = useForm({
        resolver: zodResolver(createFormSchema),
        defaultValues: {
            name: ""
        }
    });

    function goToApiKeysList() {
        router.push(`/admin/api-keys`);
    }

    async function onSubmit(data: CreateFormValues) {
        setCreateLoading(true);

        const payload: CreateOrgApiKeyBody = {
            name: data.name
        };

        const res = await api
            .put<AxiosResponse<CreateOrgApiKeyResponse>>(`/api-key`, payload)
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("apiKeysErrorCreate"),
                    description: formatAxiosError(e)
                });
            });

        if (res && res.status === 201) {
            const created = res.data.data;

            const actionsRes = await api
                .post(`/api-key/${created.apiKeyId}/actions`, {
                    actionIds: Object.keys(selectedPermissions).filter(
                        (key) => selectedPermissions[key]
                    )
                })
                .catch((e) => {
                    console.error(t("apiKeysErrorSetPermission"), e);
                    toast({
                        variant: "destructive",
                        title: t("apiKeysErrorSetPermission"),
                        description: formatAxiosError(e)
                    });
                });

            if (actionsRes) {
                setApiKey(created);
                setIsApiKeyDialogOpen(true);
            }
        }

        setCreateLoading(false);
    }

    useEffect(() => {
        const load = async () => {
            setLoadingPage(false);
        };

        load();
    }, []);

    return (
        <>
            <div className="flex justify-between">
                <HeaderTitle
                    title={t("apiKeysCreate")}
                    description={t("apiKeysCreateDescription")}
                />
                <Button variant="outline" onClick={goToApiKeysList}>
                    {t("apiKeysSeeAll")}
                </Button>
            </div>

            {!loadingPage && (
                <div>
                    <SettingsContainer>
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("apiKeysTitle")}
                                </SettingsSectionTitle>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm>
                                    <Form {...form}>
                                        <form
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                }
                                            }}
                                            className="space-y-4"
                                            id="create-site-form"
                                        >
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("name")}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                autoComplete="off"
                                                                {...field}
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
                        </SettingsSection>

                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("apiKeysGeneralSettings")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("apiKeysGeneralSettingsDescription")}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <PermissionsSelectBox
                                    root={true}
                                    selectedPermissions={selectedPermissions}
                                    onChange={setSelectedPermissions}
                                />
                            </SettingsSectionBody>
                        </SettingsSection>
                    </SettingsContainer>

                    <div className="flex justify-end space-x-2 mt-8">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={createLoading || apiKey !== null}
                            onClick={goToApiKeysList}
                        >
                            {t("cancel")}
                        </Button>
                        <Button
                            type="button"
                            loading={createLoading}
                            disabled={createLoading || apiKey !== null}
                            onClick={() => {
                                form.handleSubmit(onSubmit)();
                            }}
                        >
                            {t("generate")}
                        </Button>
                    </div>
                </div>
            )}

            <Credenza
                open={isApiKeyDialogOpen}
                onOpenChange={(open) => {
                    setIsApiKeyDialogOpen(open);
                    if (!open && apiKey) {
                        goToApiKeysList();
                    }
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>{t("apiKeysList")}</CredenzaTitle>
                        <CredenzaDescription>
                            {t("apiKeysSaveDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {apiKey && (
                            <div className="space-y-4">
                                <InfoSections cols={2}>
                                    <InfoSection>
                                        <InfoSectionTitle>
                                            {t("name")}
                                        </InfoSectionTitle>
                                        <InfoSectionContent>
                                            <CopyToClipboard
                                                text={apiKey.name}
                                            />
                                        </InfoSectionContent>
                                    </InfoSection>
                                    <InfoSection>
                                        <InfoSectionTitle>
                                            {t("created")}
                                        </InfoSectionTitle>
                                        <InfoSectionContent>
                                            {moment(apiKey.createdAt).format(
                                                "lll"
                                            )}
                                        </InfoSectionContent>
                                    </InfoSection>
                                </InfoSections>

                                <Alert variant="neutral">
                                    <InfoIcon className="h-4 w-4" />
                                    <AlertTitle className="font-semibold">
                                        {t("apiKeysSave")}
                                    </AlertTitle>
                                    <AlertDescription>
                                        {t("apiKeysSaveDescription")}
                                    </AlertDescription>
                                </Alert>

                                <CopyTextBox
                                    text={`${apiKey.apiKeyId}.${apiKey.apiKey}`}
                                />
                            </div>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <Button onClick={goToApiKeysList}>{t("done")}</Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
