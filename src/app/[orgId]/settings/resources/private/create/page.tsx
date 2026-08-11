"use client";

import {
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import {
    OptionSelect,
    type OptionSelectOption
} from "@app/components/OptionSelect";
import DomainPicker from "@app/components/DomainPicker";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
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
import type { Selectedsite } from "@app/components/site-selector";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import {
    buildCreateSiteResourcePayload,
    createCreateFormSchema,
    type PrivateResourceMode
} from "@app/lib/privateResourceForm";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { SiteResource } from "@server/db";
import { GetSiteResponse } from "@server/routers/site/getSite";
import type ResponseT from "@server/types/Response";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PrivateResourceSitesField } from "@app/components/PrivateResourceSitesField";
import { PrivateResourceHttpFields } from "@app/components/PrivateResourceHttpFields";
import { PrivateResourceSshFields } from "@app/components/PrivateResourceSshFields";
import { PrivateResourcePortRanges } from "@app/components/PrivateResourcePortRanges";
import {
    PrivateResourceAdvertiseDestinationField,
    PrivateResourceAliasField,
    PrivateResourceCidrDestinationField,
    PrivateResourceHostDestinationFields
} from "@app/components/PrivateResourceDestinationFields";
import {
    asAnyControl,
    asAnySetValue,
    asAnyWatch
} from "@app/lib/formControlUtils";

export default function CreatePrivateResourcePage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const orgId = params.orgId as string;
    const disableEnterpriseFeatures = env.flags.disableEnterpriseFeatures;
    const { isPaidUser } = usePaidStatus();
    const httpSectionDisabled = !isPaidUser(
        tierMatrix.advancedPrivateResources
    );
    const sshSectionDisabled = !isPaidUser(tierMatrix.advancedPrivateResources);
    const [isSubmitting, startTransition] = useTransition();

    const siteIdParam = searchParams.get("siteId");
    const siteIdNumber =
        siteIdParam && Number.isInteger(Number(siteIdParam))
            ? Number(siteIdParam)
            : null;

    const [selectedSites, setSelectedSites] = useState<Selectedsite[]>([]);

    const formSchema = useMemo(() => createCreateFormSchema(t), [t]);
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            siteIds: [],
            mode: "host",
            destination: "",
            alias: null,
            destinationPort: null,
            scheme: "http",
            ssl: true,
            httpConfigSubdomain: null,
            httpConfigDomainId: null,
            httpConfigFullDomain: null,
            authDaemonMode: "native",
            standardDaemonLocation: "site",
            authDaemonPort: null,
            pamMode: "passthrough",
            tcpPortRangeString: "*",
            udpPortRangeString: "*",
            disableIcmp: false,
            advertiseDestination: true
        }
    });

    useEffect(() => {
        if (!siteIdNumber) return;

        void api
            .get<ResponseT<GetSiteResponse>>(`/site/${siteIdNumber}`)
            .then((res) => {
                const site = res.data.data;
                if (!site || site.orgId !== orgId) return;
                const selected: Selectedsite = {
                    siteId: site.siteId,
                    name: site.name,
                    type: site.type as Selectedsite["type"]
                };
                setSelectedSites([selected]);
                form.setValue("siteIds", [site.siteId]);
            })
            .catch(() => {});
    }, [api, form, orgId, siteIdNumber]);

    const mode = form.watch("mode");
    const authDaemonMode = form.watch("authDaemonMode");
    const isNativeSsh = mode === "ssh" && authDaemonMode === "native";

    const modeOptions: OptionSelectOption<PrivateResourceMode>[] = [
        { value: "host", label: t("createInternalResourceDialogModeHost") },
        { value: "cidr", label: t("createInternalResourceDialogModeCidr") },
        ...(!disableEnterpriseFeatures
            ? [
                  {
                      value: "http" as const,
                      label: t("createInternalResourceDialogModeHttp")
                  },
                  {
                      value: "ssh" as const,
                      label: t("createInternalResourceDialogModeSsh")
                  }
              ]
            : [])
    ];

    const submitDisabled =
        isSubmitting ||
        (mode === "http" && httpSectionDisabled) ||
        (mode === "ssh" && sshSectionDisabled);

    function onSubmit(values: FormValues) {
        startTransition(async () => {
            try {
                const res = await api.put<
                    AxiosResponse<ResponseT<SiteResource>>
                >(
                    `/org/${orgId}/site-resource`,
                    buildCreateSiteResourcePayload({
                        ...values,
                        destination:
                            values.destination?.trim() &&
                            values.destination.trim().length > 0
                                ? values.destination.trim()
                                : null
                    })
                );

                toast({
                    title: t("createInternalResourceDialogSuccess"),
                    description: t(
                        "createInternalResourceDialogInternalResourceCreatedSuccessfully"
                    )
                });

                const created = (res.data as unknown as ResponseT<SiteResource>)
                    .data;
                if (!created) {
                    throw new Error("Failed to create private resource");
                }

                router.push(
                    `/${orgId}/settings/resources/private/${created.niceId}/${created.mode}`
                );
            } catch (error) {
                toast({
                    title: t("createInternalResourceDialogError"),
                    description: formatAxiosError(
                        error,
                        t(
                            "createInternalResourceDialogFailedToCreateInternalResource"
                        )
                    ),
                    variant: "destructive"
                });
            }
        });
    }

    return (
        <>
            <div className="flex items-start justify-between gap-4">
                <HeaderTitle
                    title={t(
                        "createInternalResourceDialogCreateClientResource"
                    )}
                    description={t(
                        "createInternalResourceDialogCreateClientResourceDescription"
                    )}
                />
                <Button variant="outline" asChild>
                    <Link href={`/${orgId}/settings/resources/private`}>
                        {t("privateResourceCreatePageSeeAll")}
                    </Link>
                </Button>
            </div>

            <Form {...form}>
                <form
                    id="create-private-resource-form"
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                >
                    {/* General */}
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("resourceCreateGeneral")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("resourceCreateGeneralDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <SettingsSectionBody>
                            <SettingsSectionForm variant="half">
                                <SettingsFormGrid>
                                    <SettingsFormCell span="half">
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
                                                    <FormDescription>
                                                        {t(
                                                            "resourceNameDescription"
                                                        )}
                                                    </FormDescription>
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>

                                    <SettingsFormCell span="full">
                                        <FormField
                                            control={form.control}
                                            name="mode"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("type")}
                                                    </FormLabel>
                                                    <OptionSelect<PrivateResourceMode>
                                                        options={modeOptions}
                                                        value={field.value}
                                                        onChange={(newMode) => {
                                                            field.onChange(
                                                                newMode
                                                            );
                                                            if (
                                                                newMode ===
                                                                "ssh"
                                                            ) {
                                                                form.setValue(
                                                                    "authDaemonMode",
                                                                    "native"
                                                                );
                                                                form.setValue(
                                                                    "standardDaemonLocation",
                                                                    "site"
                                                                );
                                                                form.setValue(
                                                                    "destination",
                                                                    null
                                                                );
                                                                form.setValue(
                                                                    "destinationPort",
                                                                    null
                                                                );
                                                            } else if (
                                                                newMode ===
                                                                "http"
                                                            ) {
                                                                form.setValue(
                                                                    "destinationPort",
                                                                    443
                                                                );
                                                            } else {
                                                                form.setValue(
                                                                    "destinationPort",
                                                                    null
                                                                );
                                                            }
                                                        }}
                                                        cols={4}
                                                    />
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </SettingsFormCell>

                                    {mode === "http" && (
                                        <SettingsFormCell span="full">
                                            <FormItem>
                                                <DomainPicker
                                                    orgId={orgId}
                                                    cols={2}
                                                    hideFreeDomain
                                                    onDomainChange={(res) => {
                                                        if (!res) {
                                                            form.setValue(
                                                                "httpConfigSubdomain",
                                                                null
                                                            );
                                                            form.setValue(
                                                                "httpConfigDomainId",
                                                                null
                                                            );
                                                            form.setValue(
                                                                "httpConfigFullDomain",
                                                                null
                                                            );
                                                            return;
                                                        }
                                                        form.setValue(
                                                            "httpConfigSubdomain",
                                                            res.subdomain ??
                                                                null
                                                        );
                                                        form.setValue(
                                                            "httpConfigDomainId",
                                                            res.domainId
                                                        );
                                                        form.setValue(
                                                            "httpConfigFullDomain",
                                                            res.fullDomain
                                                        );
                                                    }}
                                                />
                                                <FormMessage />
                                                <FormDescription>
                                                    {t(
                                                        "resourceDomainDescription"
                                                    )}
                                                </FormDescription>
                                            </FormItem>
                                        </SettingsFormCell>
                                    )}

                                    {(mode === "host" ||
                                        (mode === "ssh" && !isNativeSsh)) && (
                                        <SettingsFormCell span="half">
                                            <PrivateResourceAliasField
                                                control={asAnyControl(
                                                    form.control
                                                )}
                                                watch={asAnyWatch(form.watch)}
                                                labelPrefix="create"
                                                disabled={
                                                    mode === "ssh" &&
                                                    sshSectionDisabled
                                                }
                                            />
                                        </SettingsFormCell>
                                    )}

                                    {(mode === "host" ||
                                        (mode === "ssh" && !isNativeSsh)) && (
                                        <SettingsFormCell span="full">
                                            <PrivateResourceAdvertiseDestinationField
                                                control={asAnyControl(
                                                    form.control
                                                )}
                                                id="create-private-resource-advertise-destination"
                                                disabled={
                                                    mode === "ssh" &&
                                                    sshSectionDisabled
                                                }
                                            />
                                        </SettingsFormCell>
                                    )}
                                </SettingsFormGrid>
                            </SettingsSectionForm>
                        </SettingsSectionBody>
                    </SettingsSection>

                    {/* Host destination */}
                    {mode === "host" && (
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("hostSettings")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t(
                                        "editInternalResourceDialogDestinationDescription"
                                    )}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm variant="half">
                                    <SettingsFormGrid>
                                        <SettingsFormCell span="half">
                                            <PrivateResourceSitesField
                                                control={form.control}
                                                orgId={orgId}
                                                selectedSites={selectedSites}
                                                onSelectedSitesChange={
                                                    setSelectedSites
                                                }
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="half">
                                            <PrivateResourceHostDestinationFields
                                                control={asAnyControl(
                                                    form.control
                                                )}
                                                watch={asAnyWatch(form.watch)}
                                                labelPrefix="create"
                                                hideAlias
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="full">
                                            <PrivateResourcePortRanges
                                                control={asAnyControl(
                                                    form.control
                                                )}
                                                setValue={asAnySetValue(
                                                    form.setValue
                                                )}
                                            />
                                        </SettingsFormCell>
                                    </SettingsFormGrid>
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>
                    )}

                    {/* CIDR destination */}
                    {mode === "cidr" && (
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("cidrSettings")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t(
                                        "editInternalResourceDialogDestinationCidrDescription"
                                    )}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <SettingsSectionForm variant="half">
                                    <SettingsFormGrid>
                                        <SettingsFormCell span="half">
                                            <PrivateResourceSitesField
                                                control={form.control}
                                                orgId={orgId}
                                                selectedSites={selectedSites}
                                                onSelectedSitesChange={
                                                    setSelectedSites
                                                }
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="half">
                                            <PrivateResourceCidrDestinationField
                                                control={asAnyControl(
                                                    form.control
                                                )}
                                                labelPrefix="create"
                                            />
                                        </SettingsFormCell>
                                        <SettingsFormCell span="full">
                                            <PrivateResourcePortRanges
                                                control={asAnyControl(
                                                    form.control
                                                )}
                                                setValue={asAnySetValue(
                                                    form.setValue
                                                )}
                                            />
                                        </SettingsFormCell>
                                    </SettingsFormGrid>
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>
                    )}

                    {/* HTTP configuration */}
                    {mode === "http" && (
                        <SettingsSection>
                            <PaidFeaturesAlert
                                tiers={tierMatrix.advancedPrivateResources}
                            />
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("httpSettings")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t(
                                        "editInternalResourceDialogHttpConfigurationDescription"
                                    )}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <fieldset
                                disabled={httpSectionDisabled}
                                className={
                                    httpSectionDisabled
                                        ? "opacity-50 pointer-events-none"
                                        : ""
                                }
                            >
                                <SettingsSectionBody>
                                    <SettingsSectionForm variant="half">
                                        <SettingsFormGrid>
                                            <SettingsFormCell span="half">
                                                <PrivateResourceSitesField
                                                    control={form.control}
                                                    orgId={orgId}
                                                    selectedSites={
                                                        selectedSites
                                                    }
                                                    onSelectedSitesChange={
                                                        setSelectedSites
                                                    }
                                                />
                                            </SettingsFormCell>
                                            <SettingsFormCell span="full">
                                                <PrivateResourceHttpFields
                                                    control={asAnyControl(
                                                        form.control
                                                    )}
                                                    setValue={asAnySetValue(
                                                        form.setValue
                                                    )}
                                                    orgId={orgId}
                                                    watch={asAnyWatch(
                                                        form.watch
                                                    )}
                                                    disabled={
                                                        httpSectionDisabled
                                                    }
                                                    labelPrefix="create"
                                                    hideDomainPicker
                                                    hidePaidFeaturesAlert
                                                />
                                            </SettingsFormCell>
                                        </SettingsFormGrid>
                                    </SettingsSectionForm>
                                </SettingsSectionBody>
                            </fieldset>
                        </SettingsSection>
                    )}

                    {/* SSH server */}
                    {mode === "ssh" && (
                        <SettingsSection>
                            <PaidFeaturesAlert
                                tiers={tierMatrix.advancedPrivateResources}
                            />
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("sshServer")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("sshServerDescription")}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <fieldset
                                disabled={sshSectionDisabled}
                                className={
                                    sshSectionDisabled
                                        ? "opacity-50 pointer-events-none"
                                        : ""
                                }
                            >
                                <SettingsSectionBody>
                                    <SettingsSectionForm variant="half">
                                        <PrivateResourceSshFields
                                            control={asAnyControl(form.control)}
                                            setValue={asAnySetValue(
                                                form.setValue
                                            )}
                                            watch={asAnyWatch(form.watch)}
                                            orgId={orgId}
                                            disabled={sshSectionDisabled}
                                            selectedSites={selectedSites}
                                            onSelectedSitesChange={
                                                setSelectedSites
                                            }
                                            labelPrefix="create"
                                            showSshSettings={true}
                                            layout="wizard"
                                            showPaidFeaturesAlert={false}
                                            hideAlias
                                        />
                                    </SettingsSectionForm>
                                </SettingsSectionBody>
                            </fieldset>
                        </SettingsSection>
                    )}

                    <div className="flex justify-end space-x-2 mt-8">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                                router.push(
                                    `/${orgId}/settings/resources/private`
                                )
                            }
                            disabled={isSubmitting}
                        >
                            {t("createInternalResourceDialogCancel")}
                        </Button>
                        <Button
                            type="submit"
                            form="create-private-resource-form"
                            disabled={submitDisabled}
                            loading={isSubmitting}
                        >
                            {t("createInternalResourceDialogCreateResource")}
                        </Button>
                    </div>
                </form>
            </Form>
        </>
    );
}
