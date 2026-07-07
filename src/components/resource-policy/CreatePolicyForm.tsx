"use client";

import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { orgQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { build } from "@server/build";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
    type PolicyFormValues,
    createPolicySchema,
    createPolicySchemaWithI18n
} from ".";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { orgs, type ResourcePolicy } from "@server/db";
import type { AxiosResponse } from "axios";
import { useRouter } from "next/navigation";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { PolicyAuthStackSection } from "./PolicyAuthStackSection";
import { PolicyAccessRulesSection } from "./PolicyAccessRulesSection";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";

// ─── CreatePolicyForm ─────────────────────────────────────────────────────────

export type CreatePolicyFormProps = {};

export function CreatePolicyForm({}: CreatePolicyFormProps) {
    const { org } = useOrgContext();
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const [isSubmitting, startTransition] = useTransition();
    const { isPaidUser } = usePaidStatus();

    const router = useRouter();

    const isMaxmindAvailable = !!(
        env.server.maxmind_db_path && env.server.maxmind_db_path.length > 0
    );
    const isMaxmindAsnAvailable = !!(
        env.server.maxmind_asn_path && env.server.maxmind_asn_path.length > 0
    );

    const { data: orgIdps = [], isLoading: isLoadingOrgIdps } = useQuery(
        orgQueries.identityProviders({
            orgId: org.org.orgId,
            useOrgOnlyIdp: env.app.identityProviderMode === "org"
        })
    );

    const policySchema = useMemo(
        () => createPolicySchemaWithI18n(t, createPolicySchema),
        [t]
    );

    const form = useForm<PolicyFormValues>({
        resolver: zodResolver(policySchema) as any,
        defaultValues: {
            name: "",
            sso: true,
            skipToIdpId: null,
            emailWhitelistEnabled: false,
            roles: [],
            users: [],
            emails: [],
            applyRules: false,
            rules: [],
            password: null,
            headerAuth: null,
            pincode: null
        }
    });

    async function onSubmit() {
        const isValid = await form.trigger();

        if (!isValid) return;

        const payload = form.getValues();

        try {
            const res = await api
                .post<AxiosResponse<ResourcePolicy>>(
                    `/org/${org.org.orgId}/resource-policy/`,
                    {
                        name: payload.name,
                        // access control
                        sso: payload.sso,
                        roleIds: payload.roles.map((r) => r.id),
                        userIds: payload.users.map((u) => u.id),
                        skipToIdpId: payload.skipToIdpId,
                        // auth methods
                        password: payload.password?.password,
                        pincode: payload.pincode?.pincode,
                        headerAuth: payload.headerAuth,
                        // email OTP
                        emailWhitelistEnabled: payload.emailWhitelistEnabled,
                        emails: payload.emails.map((email) => email.text),
                        // rules
                        applyRules: payload.applyRules,
                        rules: payload.rules
                    }
                )
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("policyErrorCreate"),
                        description: formatAxiosError(
                            e,
                            t("policyErrorCreateDescription")
                        )
                    });
                });

            if (res && res.status === 201) {
                const niceId = res.data.data.niceId;
                router.push(
                    `/${org.org.orgId}/settings/policies/resources/public/${niceId}/general`
                );
                toast({
                    title: t("success"),
                    description: t("policyCreatedSuccess")
                });
            }
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("policyErrorCreate"),
                description: t("policyErrorCreateMessageDescription")
            });
        }
    }

    const allIdps = useMemo(() => {
        if (build === "saas") {
            if (isPaidUser(tierMatrix.orgOidc)) {
                return orgIdps.map((idp) => ({
                    id: idp.idpId,
                    text: idp.name
                }));
            }
        } else {
            return orgIdps.map((idp) => ({ id: idp.idpId, text: idp.name }));
        }
        return [];
    }, [orgIdps, isPaidUser]);

    if (isLoadingOrgIdps) {
        return <></>;
    }

    const policyTiers = tierMatrix[TierFeature.ResourcePolicies];
    const isDisabled = !isPaidUser(policyTiers);

    return (
        <>
            <PaidFeaturesAlert tiers={policyTiers} />
            <Form {...form}>
                <div
                    className={
                        isDisabled
                            ? "pointer-events-none opacity-50"
                            : undefined
                    }
                >
                    <SettingsContainer>
                        {/* Name */}
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("resourcePolicyName")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("resourcePolicyNameDescription")}
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
                                                    </FormItem>
                                                )}
                                            />
                                        </SettingsFormCell>
                                    </SettingsFormGrid>
                                </SettingsSectionForm>
                            </SettingsSectionBody>
                        </SettingsSection>

                        <PolicyAuthStackSection
                            mode="create"
                            form={form}
                            orgId={org.org.orgId}
                            allIdps={allIdps}
                            emailEnabled={env.email.emailEnabled}
                        />
                        <PolicyAccessRulesSection
                            mode="create"
                            form={form}
                            isMaxmindAvailable={isMaxmindAvailable}
                            isMaxmindAsnAvailable={isMaxmindAsnAvailable}
                        />
                    </SettingsContainer>
                </div>

                <div className="flex py-6 justify-end">
                    <Button
                        type="button"
                        onClick={() => startTransition(onSubmit)}
                        loading={isSubmitting}
                        disabled={isSubmitting || isDisabled}
                    >
                        {t("resourcePoliciesCreate")}
                    </Button>
                </div>
            </Form>
        </>
    );
}
