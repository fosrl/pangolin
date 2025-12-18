"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatAxiosError } from "@app/lib/api";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { ListSitesResponse } from "@server/routers/site";
import { useEffect, useMemo, useState } from "react";
import { AxiosResponse } from "axios";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "@app/hooks/useToast";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm,
    SettingsSectionFooter
} from "@app/components/Settings";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { Label } from "@app/components/ui/label";
import { ListDomainsResponse } from "@server/routers/domain";
import { UpdateResourceResponse } from "@server/routers/resource";
import { SwitchInput } from "@app/components/SwitchInput";
import { useTranslations } from "next-intl";
import { Checkbox } from "@app/components/ui/checkbox";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import DomainPicker from "@app/components/DomainPicker";
import { Globe } from "lucide-react";
import { build } from "@server/build";
import { finalizeSubdomainSanitize } from "@app/lib/subdomain-utils";
import { DomainRow } from "@app/components/DomainsTable";
import { toASCII, toUnicode } from "punycode";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";
import { useUserContext } from "@app/hooks/useUserContext";

export default function GeneralForm() {
    const [formKey, setFormKey] = useState(0);
    const params = useParams();
    const { resource, updateResource } = useResourceContext();
    const { org } = useOrgContext();
    const router = useRouter();
    const t = useTranslations();
    const [editDomainOpen, setEditDomainOpen] = useState(false);
    const { licenseStatus } = useLicenseStatusContext();
    const subscriptionStatus = useSubscriptionStatusContext();
    const { user } = useUserContext();

    const { env } = useEnvContext();

    const orgId = params.orgId;

    const api = createApiClient({ env });

    const [sites, setSites] = useState<ListSitesResponse["sites"]>([]);
    const [saveLoading, setSaveLoading] = useState(false);
    const [transferLoading, setTransferLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [baseDomains, setBaseDomains] = useState<
        ListDomainsResponse["domains"]
    >([]);

    const [loadingPage, setLoadingPage] = useState(true);
    const [resourceFullDomain, setResourceFullDomain] = useState(
        `${resource.ssl ? "https" : "http"}://${toUnicode(resource.fullDomain || "")}`
    );

    const resourceFullDomainName = useMemo(() => {
        const url = new URL(resourceFullDomain);
        return url.hostname;
    }, [resourceFullDomain]);

    const [selectedDomain, setSelectedDomain] = useState<{
        domainId: string;
        domainNamespaceId?: string;
        subdomain?: string;
        fullDomain: string;
        baseDomain: string;
    } | null>(null);

    const GeneralFormSchema = z
        .object({
            enabled: z.boolean(),
            subdomain: z.string().optional(),
            name: z.string().min(1).max(255),
            niceId: z.string().min(1).max(255).optional(),
            domainId: z.string().optional(),
            proxyPort: z.int().min(1).max(65535).optional()
            // enableProxy: z.boolean().optional()
        })
        .refine(
            (data) => {
                // For non-HTTP resources, proxyPort should be defined
                if (!resource.http) {
                    return data.proxyPort !== undefined;
                }
                // For HTTP resources, proxyPort should be undefined
                return data.proxyPort === undefined;
            },
            {
                message: !resource.http
                    ? "Port number is required for non-HTTP resources"
                    : "Port number should not be set for HTTP resources",
                path: ["proxyPort"]
            }
        );

    type GeneralFormValues = z.infer<typeof GeneralFormSchema>;

    const form = useForm({
        resolver: zodResolver(GeneralFormSchema),
        defaultValues: {
            enabled: resource.enabled,
            name: resource.name,
            niceId: resource.niceId,
            subdomain: resource.subdomain ? resource.subdomain : undefined,
            domainId: resource.domainId || undefined,
            proxyPort: resource.proxyPort || undefined
            // enableProxy: resource.enableProxy || false
        },
        mode: "onChange"
    });

    useEffect(() => {
        const fetchSites = async () => {
            const res = await api.get<AxiosResponse<ListSitesResponse>>(
                `/org/${orgId}/sites/`
            );
            setSites(res.data.data.sites);
        };

        const fetchDomains = async () => {
            const res = await api
                .get<
                    AxiosResponse<ListDomainsResponse>
                >(`/org/${orgId}/domains/`)
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("domainErrorFetch"),
                        description: formatAxiosError(
                            e,
                            t("domainErrorFetchDescription")
                        )
                    });
                });

            if (res?.status === 200) {
                const rawDomains = res.data.data.domains as DomainRow[];
                const domains = rawDomains.map((domain) => ({
                    ...domain,
                    baseDomain: toUnicode(domain.baseDomain)
                }));
                setBaseDomains(domains);
                setFormKey((key) => key + 1);
            }
        };

        const load = async () => {
            await fetchDomains();
            await fetchSites();

            setLoadingPage(false);
        };

        load();
    }, []);

    async function onSubmit(data: GeneralFormValues) {
        setSaveLoading(true);

        const res = await api
            .post<AxiosResponse<UpdateResourceResponse>>(
                `resource/${resource?.resourceId}`,
                {
                    enabled: data.enabled,
                    name: data.name,
                    niceId: data.niceId,
                    subdomain: data.subdomain
                        ? toASCII(data.subdomain)
                        : undefined,
                    domainId: data.domainId,
                    proxyPort: data.proxyPort
                    // ...(!resource.http && {
                    //     enableProxy: data.enableProxy
                    // })
                }
            )
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("resourceErrorUpdate"),
                    description: formatAxiosError(
                        e,
                        t("resourceErrorUpdateDescription")
                    )
                });
            });

        if (res && res.status === 200) {
            const updated = res.data.data;

            updateResource({
                enabled: data.enabled,
                name: data.name,
                niceId: data.niceId,
                subdomain: data.subdomain,
                fullDomain: updated.fullDomain,
                proxyPort: data.proxyPort,
                domainId: data.domainId
                // ...(!resource.http && {
                //     enableProxy: data.enableProxy
                // })
            });

            toast({
                title: t("resourceUpdated"),
                description: t("resourceUpdatedDescription")
            });

            if (data.niceId && data.niceId !== resource?.niceId) {
                router.replace(
                    `/${updated.orgId}/settings/resources/proxy/${data.niceId}/general`
                );
            } else {
                router.refresh();
            }

            setSaveLoading(false);
        }

        setSaveLoading(false);
    }

    return (
        !loadingPage && (
            <>
                <SettingsContainer>
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("resourceGeneral")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("resourceGeneralDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>

                        <SettingsSectionBody>
                            <SettingsSectionForm>
                                <Form {...form} key={formKey}>
                                    <form
                                        onSubmit={form.handleSubmit(onSubmit)}
                                        className="space-y-4"
                                        id="general-settings-form"
                                    >
                                        <FormField
                                            control={form.control}
                                            name="enabled"
                                            render={({ field }) => (
                                                <FormItem className="col-span-2">
                                                    <div className="flex items-center space-x-2">
                                                        <FormControl>
                                                            <SwitchInput
                                                                id="enable-resource"
                                                                defaultChecked={
                                                                    resource.enabled
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
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("name")}
                                                    </FormLabel>
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

                                        {!resource.http && (
                                            <>
                                                <FormField
                                                    control={form.control}
                                                    name="proxyPort"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "resourcePortNumber"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    type="number"
                                                                    value={
                                                                        field.value ??
                                                                        ""
                                                                    }
                                                                    onChange={(
                                                                        e
                                                                    ) =>
                                                                        field.onChange(
                                                                            e
                                                                                .target
                                                                                .value
                                                                                ? parseInt(
                                                                                      e
                                                                                          .target
                                                                                          .value
                                                                                  )
                                                                                : undefined
                                                                        )
                                                                    }
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                            <FormDescription>
                                                                {t(
                                                                    "resourcePortNumberDescription"
                                                                )}
                                                            </FormDescription>
                                                        </FormItem>
                                                    )}
                                                />

                                                {/* {build == "oss" && (
                                                    <FormField
                                                        control={form.control}
                                                        name="enableProxy"
                                                        render={({ field }) => (
                                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                                <FormControl>
                                                                    <Checkbox
                                                                        variant={
                                                                            "outlinePrimarySquare"
                                                                        }
                                                                        checked={
                                                                            field.value
                                                                        }
                                                                        onCheckedChange={
                                                                            field.onChange
                                                                        }
                                                                    />
                                                                </FormControl>
                                                                <div className="space-y-1 leading-none">
                                                                    <FormLabel>
                                                                        {t(
                                                                            "resourceEnableProxy"
                                                                        )}
                                                                    </FormLabel>
                                                                    <FormDescription>
                                                                        {t(
                                                                            "resourceEnableProxyDescription"
                                                                        )}
                                                                    </FormDescription>
                                                                </div>
                                                            </FormItem>
                                                        )}
                                                    />
                                                )} */}
                                            </>
                                        )}

                                        {resource.http && (
                                            <div className="space-y-2">
                                                <Label>
                                                    {t("resourceDomain")}
                                                </Label>
                                                <div className="border p-2 rounded-md flex items-center justify-between">
                                                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                                                        <Globe size="14" />
                                                        {resourceFullDomain}
                                                    </span>
                                                    <Button
                                                        variant="secondary"
                                                        type="button"
                                                        size="sm"
                                                        onClick={() =>
                                                            setEditDomainOpen(
                                                                true
                                                            )
                                                        }
                                                    >
                                                        {t(
                                                            "resourceEditDomain"
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </form>
                                </Form>
                            </SettingsSectionForm>
                        </SettingsSectionBody>

                        <SettingsSectionFooter>
                            <Button
                                type="submit"
                                onClick={() => {
                                    console.log(form.getValues());
                                }}
                                loading={saveLoading}
                                disabled={saveLoading}
                                form="general-settings-form"
                            >
                                {t("saveSettings")}
                            </Button>
                        </SettingsSectionFooter>
                    </SettingsSection>
                </SettingsContainer>

                <Credenza
                    open={editDomainOpen}
                    onOpenChange={(setOpen) => setEditDomainOpen(setOpen)}
                >
                    <CredenzaContent>
                        <CredenzaHeader>
                            <CredenzaTitle>Edit Domain</CredenzaTitle>
                            <CredenzaDescription>
                                Select a domain for your resource
                            </CredenzaDescription>
                        </CredenzaHeader>
                        <CredenzaBody>
                            <DomainPicker
                                orgId={orgId as string}
                                cols={1}
                                defaultSubdomain={
                                    form.getValues("subdomain") ??
                                    resource.subdomain
                                }
                                defaultDomainId={
                                    form.getValues("domainId") ??
                                    resource.domainId
                                }
                                defaultFullDomain={resourceFullDomainName}
                                onDomainChange={(res) => {
                                    const selected =
                                        res === null
                                            ? null
                                            : {
                                                  domainId: res.domainId,
                                                  subdomain: res.subdomain,
                                                  fullDomain: res.fullDomain,
                                                  baseDomain: res.baseDomain,
                                                  domainNamespaceId:
                                                      res.domainNamespaceId
                                              };
                                    setSelectedDomain(selected);
                                }}
                            />
                        </CredenzaBody>
                        <CredenzaFooter>
                            <CredenzaClose asChild>
                                <Button variant="outline">{t("cancel")}</Button>
                            </CredenzaClose>
                            <Button
                                onClick={() => {
                                    if (selectedDomain) {
                                        const sanitizedSubdomain =
                                            selectedDomain.subdomain
                                                ? finalizeSubdomainSanitize(
                                                      selectedDomain.subdomain
                                                  )
                                                : "";

                                        const sanitizedFullDomain =
                                            sanitizedSubdomain
                                                ? `${sanitizedSubdomain}.${selectedDomain.baseDomain}`
                                                : selectedDomain.baseDomain;

                                        setResourceFullDomain(
                                            `${resource.ssl ? "https" : "http"}://${sanitizedFullDomain}`
                                        );
                                        form.setValue(
                                            "domainId",
                                            selectedDomain.domainId
                                        );
                                        form.setValue(
                                            "subdomain",
                                            sanitizedSubdomain
                                        );

                                        setEditDomainOpen(false);
                                    }
                                }}
                            >
                                Select Domain
                            </Button>
                        </CredenzaFooter>
                    </CredenzaContent>
                </Credenza>
            </>
        )
    );
}
