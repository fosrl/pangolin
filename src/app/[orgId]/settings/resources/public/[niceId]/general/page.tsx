"use client";

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
import DomainPicker from "@app/components/DomainPicker";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsFormGrid,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle,
    SettingsFormCell
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { finalizeSubdomainSanitize } from "@app/lib/subdomain-utils";
import {
    GetResourceAuthInfoResponse,
    UpdateResourceResponse
} from "@server/routers/resource";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { toASCII, toUnicode } from "punycode";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { SharedPolicySelect } from "@app/components/shared-policy-selector";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { build } from "@server/build";
import { TierFeature } from "@server/lib/billing/tierMatrix";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import UptimeAlertSection from "@app/components/UptimeAlertSection";

export default function GeneralForm() {
    const params = useParams();
    const { org } = useOrgContext();
    const { resource, updateResource, updateAuthInfo } = useResourceContext();
    const router = useRouter();
    const t = useTranslations();

    const { env } = useEnvContext();
    const { isPaidUser } = usePaidStatus();

    const orgId = params.orgId;

    const api = createApiClient({ env });

    const hasResourcePolicies =
        build !== "oss" &&
        isPaidUser(tierMatrix[TierFeature.ResourcePolicies]);

    const [selectedSharedPolicyId, setSelectedSharedPolicyId] = useState<
        number | null
    >(resource.resourcePolicyId ?? null);

    useEffect(() => {
        setSelectedSharedPolicyId(resource.resourcePolicyId ?? null);
    }, [resource.resourcePolicyId]);

    const { data: selectedSharedPolicy } = useQuery({
        ...orgQueries.resourcePolicy({
            resourcePolicyId: selectedSharedPolicyId!
        }),
        enabled: hasResourcePolicies && selectedSharedPolicyId !== null
    });

    const [resourceFullDomain, setResourceFullDomain] = useState(
        `${resource.ssl ? "https" : "http"}://${toUnicode(resource.fullDomain || "")}`
    );

    const resourceFullDomainName = useMemo(() => {
        try {
            const url = new URL(resourceFullDomain);
            return url.hostname;
        } catch {
            return "";
        }
    }, [resourceFullDomain]);

    const GeneralFormSchema = z
        .object({
            enabled: z.boolean(),
            subdomain: z.string().optional(),
            name: z.string().min(1).max(255),
            niceId: z.string().min(1).max(255).optional(),
            domainId: z.string().optional(),
            proxyPort: z.number().int().min(1).max(65535).optional()
        })
        .refine(
            (data) => {
                // For non-HTTP resources, proxyPort should be defined
                if (!["http", "ssh", "rdp", "vnc"].includes(resource.mode)) {
                    return data.proxyPort !== undefined;
                }
                // For HTTP resources, proxyPort should be undefined
                return data.proxyPort === undefined;
            },
            {
                message: !["http", "ssh", "rdp", "vnc"].includes(resource.mode)
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
        },
        mode: "onChange"
    });

    const [, formAction, saveLoading] = useActionState(onSubmit, null);

    async function onSubmit() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();

        let resourcePolicyId: number | null | undefined;

        if (!["tcp", "udp"].includes(resource.mode)) {
            if (hasResourcePolicies || selectedSharedPolicyId === null) {
                resourcePolicyId = selectedSharedPolicyId;
            }
        }

        const res = await api
            .post<AxiosResponse<UpdateResourceResponse>>(
                `resource/${resource?.resourceId}`,
                {
                    enabled: data.enabled,
                    name: data.name,
                    niceId: data.niceId,
                    subdomain: data.subdomain
                        ? toASCII(
                              finalizeSubdomainSanitize(data.subdomain, true)
                          )
                        : undefined,
                    domainId: data.domainId,
                    proxyPort: data.proxyPort,
                    ...(resourcePolicyId !== undefined && { resourcePolicyId })
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
                domainId: data.domainId,
                ...(resourcePolicyId !== undefined && {
                    resourcePolicyId
                })
            });

            if (resourcePolicyId !== undefined) {
                const authRes = await api
                    .get<AxiosResponse<GetResourceAuthInfoResponse>>(
                        `/resource/${resource.resourceGuid}/auth`
                    )
                    .catch(() => null);

                if (authRes?.status === 200) {
                    updateAuthInfo(authRes.data.data);
                }
            }

            toast({
                title: t("resourceUpdated"),
                description: t("resourceUpdatedDescription")
            });

            if (data.niceId && data.niceId !== resource?.niceId) {
                router.replace(
                    `/${updated.orgId}/settings/resources/public/${data.niceId}/general`
                );
            }

            router.refresh();
        }
    }

    return (
        <>
            <SettingsContainer>
                {resource?.resourceId &&
                    resource?.orgId &&
                    resource.mode == "http" && (
                        <UptimeAlertSection
                            orgId={resource.orgId}
                            resourceId={resource.resourceId}
                            startingName={resource.name}
                        />
                    )}
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
                        <SettingsSectionForm variant="half">
                            <Form {...form}>
                                <form
                                    action={formAction}
                                    id="general-settings-form"
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
                                                            {t("name")}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                            />
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
                                                            <Input
                                                                {...field}
                                                                placeholder={t(
                                                                    "enterIdentifier"
                                                                )}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>

                                        {!["http", "ssh", "rdp", "vnc"].includes(
                                            resource.mode
                                        ) && (
                                            <SettingsFormCell span="half">
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
                                                                        field.value !==
                                                                        undefined
                                                                            ? String(
                                                                                  field.value
                                                                              )
                                                                            : ""
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
                                            </SettingsFormCell>
                                        )}

                                        {["http", "ssh", "rdp", "vnc"].includes(
                                            resource.mode
                                        ) && (
                                            <SettingsFormCell span="full">
                                                <div id="resource-domain-picker">
                                                    <DomainPicker
                                                        allowWildcard={true}
                                                        key={
                                                            resource.resourceId
                                                        }
                                                        orgId={orgId as string}
                                                        cols={2}
                                                        defaultSubdomain={
                                                            form.watch(
                                                                "subdomain"
                                                            ) ?? undefined
                                                        }
                                                        defaultDomainId={
                                                            form.watch(
                                                                "domainId"
                                                            ) ?? undefined
                                                        }
                                                        defaultFullDomain={
                                                            resourceFullDomainName ||
                                                            undefined
                                                        }
                                                        onDomainChange={(
                                                            res
                                                        ) => {
                                                            if (res === null) {
                                                                form.setValue(
                                                                    "domainId",
                                                                    undefined
                                                                );
                                                                form.setValue(
                                                                    "subdomain",
                                                                    undefined
                                                                );
                                                                setResourceFullDomain(
                                                                    `${resource.ssl ? "https" : "http"}://`
                                                                );
                                                                return;
                                                            }
                                                            form.setValue(
                                                                "domainId",
                                                                res.domainId
                                                            );
                                                            form.setValue(
                                                                "subdomain",
                                                                res.subdomain ??
                                                                    undefined
                                                            );
                                                            setResourceFullDomain(
                                                                `${resource.ssl ? "https" : "http"}://${toUnicode(res.fullDomain)}`
                                                            );
                                                        }}
                                                    />
                                                </div>
                                            </SettingsFormCell>
                                        )}
                                        { !["tcp", "udp"].includes(
                                                resource.mode
                                            ) && !env.flags.disableEnterpriseFeatures && (
                                            <>
                                                <SettingsFormCell span="full">
                                                    <SettingsSubsectionHeader>
                                                        <SettingsSubsectionTitle>
                                                            {t(
                                                                "resourceGeneralAuthenticationAccessSubsection"
                                                            )}
                                                        </SettingsSubsectionTitle>
                                                        <SettingsSubsectionDescription>
                                                            {t(
                                                                "resourceGeneralAuthenticationAccessSubsectionDescription"
                                                            )}
                                                        </SettingsSubsectionDescription>
                                                    </SettingsSubsectionHeader>
                                                </SettingsFormCell>
                                                <SettingsFormCell span="half">
                                                    <div className="space-y-2">
                                                        <FormLabel>
                                                            {t("sharedPolicy")}
                                                        </FormLabel>
                                                        <SharedPolicySelect
                                                        key={
                                                            resource.resourcePolicyId ??
                                                            "none"
                                                        }
                                                        orgId={org.org.orgId}
                                                        value={
                                                            selectedSharedPolicyId
                                                        }
                                                        onChange={
                                                            setSelectedSharedPolicyId
                                                        }
                                                        />
                                                        <FormDescription>
                                                            {selectedSharedPolicyId ===
                                                            null
                                                                ? t(
                                                                      "resourceSharedPolicyOwnDescription"
                                                                  )
                                                                : selectedSharedPolicy
                                                                  ? t.rich(
                                                                        "resourceSharedPolicyInheritedDescription",
                                                                        {
                                                                            policyName:
                                                                                selectedSharedPolicy.name,
                                                                            policyLink:
                                                                                (
                                                                                    chunks
                                                                                ) => (
                                                                                    <Link
                                                                                        href={`/${org.org.orgId}/settings/policies/resources/public/${selectedSharedPolicy.niceId}/general`}
                                                                                        className="text-primary hover:underline"
                                                                                    >
                                                                                        {
                                                                                            chunks
                                                                                        }
                                                                                    </Link>
                                                                                )
                                                                        }
                                                                    )
                                                                  : null}
                                                        </FormDescription>
                                                    </div>
                                                </SettingsFormCell>
                                            </>
                                        )}
                                    </SettingsFormGrid>
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>

                    <SettingsSectionFooter>
                        <Button
                            type="submit"
                            loading={saveLoading}
                            disabled={saveLoading}
                            form="general-settings-form"
                        >
                            {t("saveSettings")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>
            </SettingsContainer>
        </>
    );
}
