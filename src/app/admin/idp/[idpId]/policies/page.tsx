"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
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
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { CheckIcon } from "lucide-react";
import PolicyTable, { PolicyRow } from "@app/components/PolicyTable";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import { CaretSortIcon } from "@radix-ui/react-icons";
import { GetIdpResponse } from "@server/routers/idp";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionFooter
} from "@app/components/Settings";
import { useTranslations } from "next-intl";
import IdpLinkedMappingsFields from "@app/components/IdpLinkedMappingsFields";
import {
    compileRoleMappingExpression,
    defaultRoleMappingConfig,
    defaultSyncRoleMappingConfig,
    detectRoleMappingConfig,
    ensureMappingBuilderRuleIds,
    RoleMappingConfig
} from "@app/lib/idpRoleMapping";
import { globalIdpQueries, orgQueries } from "@app/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supportsApiIntegration } from "@app/lib/idpApiConfig";

function loadRoleMapping(
    stored: string | null | undefined,
    defaults: RoleMappingConfig
): RoleMappingConfig {
    const detected = detectRoleMappingConfig(stored, defaults);
    return {
        ...detected,
        mappingBuilder: {
            ...detected.mappingBuilder,
            rules: ensureMappingBuilderRuleIds(detected.mappingBuilder.rules)
        }
    };
}

/** While linked, sync gets the JIT mappings. */
function compileMappings(m: {
    roleMapping: RoleMappingConfig;
    syncRoleMapping: RoleMappingConfig;
    orgMapping: string | undefined;
    syncOrgMapping: string | undefined;
    createMissingRoles: boolean;
    syncCreateMissingRoles: boolean;
    linked: boolean;
}) {
    const roleMapping = compileRoleMappingExpression(m.roleMapping);
    return {
        roleMapping,
        orgMapping: m.orgMapping,
        createMissingRoles: m.createMissingRoles,
        syncRoleMapping: m.linked
            ? roleMapping
            : compileRoleMappingExpression(m.syncRoleMapping),
        syncOrgMapping: m.linked ? m.orgMapping : m.syncOrgMapping,
        syncCreateMissingRoles: m.linked
            ? m.createMissingRoles
            : m.syncCreateMissingRoles,
        mappingsLinked: m.linked
    };
}

/** Separate sync mappings are only offered once directory sync is on (google/azure). */
function isSyncEnabled(data: GetIdpResponse) {
    const variant = data.idpOidcConfig?.variant;
    return (
        supportsApiIntegration(variant) &&
        data.idp.apiIntegrationEnabled &&
        data.idp.directorySyncEnabled
    );
}

/** The API integration adds `groups` / `groupNames` to the claims (google/azure). */
function hasGroupClaims(data: GetIdpResponse) {
    return (
        supportsApiIntegration(data.idpOidcConfig?.variant) &&
        data.idp.apiIntegrationEnabled
    );
}

export default function PoliciesPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const idpId = useParams().idpId as string;
    const t = useTranslations();
    const queryClient = useQueryClient();

    const idpQuery = useQuery(globalIdpQueries.idp({ idpId }));
    const policiesQuery = useQuery(globalIdpQueries.policies({ idpId }));
    const policies: PolicyRow[] = policiesQuery.data ?? [];

    const [savingPolicy, setSavingPolicy] = useState(false);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<PolicyRow | null>(null);

    const [policyRoleMapping, setPolicyRoleMapping] =
        useState<RoleMappingConfig>(defaultRoleMappingConfig);
    const [policySyncRoleMapping, setPolicySyncRoleMapping] =
        useState<RoleMappingConfig>(defaultSyncRoleMappingConfig);
    const [policyCreateMissingRoles, setPolicyCreateMissingRoles] =
        useState(false);
    const [policySyncCreateMissingRoles, setPolicySyncCreateMissingRoles] =
        useState(false);
    const [policyMappingsLinked, setPolicyMappingsLinked] = useState(true);

    const policyFormSchema = z.object({
        orgId: z.string().min(1, { message: t("orgRequired") }),
        orgMapping: z.string().optional(),
        syncOrgMapping: z.string().optional()
    });

    type PolicyFormValues = z.infer<typeof policyFormSchema>;

    const form = useForm({
        resolver: zodResolver(policyFormSchema),
        defaultValues: {
            orgId: "",
            orgMapping: "",
            syncOrgMapping: ""
        }
    });

    const policyFormOrgId = form.watch("orgId");
    const dialogOrgId = editingPolicy?.orgId || policyFormOrgId;

    // orgs without a policy yet, only needed to add one
    const { data: allOrgs } = useQuery({
        ...globalIdpQueries.orgs(),
        enabled: showAddDialog && !editingPolicy
    });
    const availableOrgs = (allOrgs ?? []).filter(
        (org) => !policies.some((p) => p.orgId === org.orgId)
    );

    const { data: policyOrgRoles, error: policyOrgRolesError } = useQuery({
        ...orgQueries.roles({ orgId: dialogOrgId }),
        enabled: showAddDialog && !!dialogOrgId
    });

    // useQuery has no onError in v5, the toast is a side effect of the error
    useEffect(() => {
        if (!policyOrgRolesError) return;
        toast({
            variant: "destructive",
            title: t("accessRoleErrorFetch"),
            description: formatAxiosError(
                policyOrgRolesError,
                t("accessRoleErrorFetchDescription")
            )
        });
    }, [policyOrgRolesError, t]);

    /** Fills the dialog from a policy, or resets it when `policy` is null. */
    function loadPolicyDialogMappings(policy: PolicyRow | null) {
        setPolicyRoleMapping(
            loadRoleMapping(policy?.roleMapping, defaultRoleMappingConfig())
        );
        setPolicySyncRoleMapping(
            loadRoleMapping(
                policy?.syncRoleMapping,
                defaultSyncRoleMappingConfig()
            )
        );
        setPolicyCreateMissingRoles(policy?.createMissingRoles ?? false);
        setPolicySyncCreateMissingRoles(
            policy?.syncCreateMissingRoles ?? false
        );
        setPolicyMappingsLinked(policy?.mappingsLinked ?? true);
    }

    function closePolicyDialog() {
        setShowAddDialog(false);
        setEditingPolicy(null);
        form.reset();
        loadPolicyDialogMappings(null);
    }

    const onSavePolicy = async (data: PolicyFormValues) => {
        const mappings = compileMappings({
            roleMapping: policyRoleMapping,
            syncRoleMapping: policySyncRoleMapping,
            orgMapping: data.orgMapping,
            syncOrgMapping: data.syncOrgMapping,
            createMissingRoles: policyCreateMissingRoles,
            syncCreateMissingRoles: policySyncCreateMissingRoles,
            linked: policyMappingsLinked
        });

        setSavingPolicy(true);
        try {
            if (editingPolicy) {
                await api.post(
                    `/idp/${idpId}/org/${editingPolicy.orgId}`,
                    mappings
                );
            } else {
                await api.put(`/idp/${idpId}/org/${data.orgId}`, mappings);
            }
            await queryClient.invalidateQueries({
                queryKey: globalIdpQueries.policies({ idpId }).queryKey
            });
            toast({
                title: t("success"),
                description: editingPolicy
                    ? t("orgPolicyUpdatedDescription")
                    : t("orgPolicyAddedDescription")
            });
            closePolicyDialog();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setSavingPolicy(false);
        }
    };

    const onDeletePolicy = async (orgId: string) => {
        try {
            await api.delete(`/idp/${idpId}/org/${orgId}`);
            await queryClient.invalidateQueries({
                queryKey: globalIdpQueries.policies({ idpId }).queryKey
            });
            toast({
                title: t("success"),
                description: t("orgPolicyDeletedDescription")
            });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const loadError = idpQuery.error ?? policiesQuery.error;
    if (loadError) {
        return (
            <Alert variant="destructive">
                <AlertDescription>
                    {formatAxiosError(loadError)}
                </AlertDescription>
            </Alert>
        );
    }

    if (!idpQuery.data || !policiesQuery.data) {
        return null;
    }

    const syncEnabled = isSyncEnabled(idpQuery.data);
    const groupClaimsAvailable = hasGroupClaims(idpQuery.data);

    return (
        <>
            <SettingsContainer>
                <PolicyTable
                    policies={policies}
                    onDelete={onDeletePolicy}
                    onAdd={() => {
                        form.reset({
                            orgId: "",
                            orgMapping: "",
                            syncOrgMapping: ""
                        });
                        setEditingPolicy(null);
                        loadPolicyDialogMappings(null);
                        setShowAddDialog(true);
                    }}
                    onEdit={(policy) => {
                        setEditingPolicy(policy);
                        form.reset({
                            orgId: policy.orgId,
                            orgMapping: policy.orgMapping || "",
                            syncOrgMapping: policy.syncOrgMapping || ""
                        });
                        loadPolicyDialogMappings(policy);
                        setShowAddDialog(true);
                    }}
                />

                <DefaultMappingsSection
                    idpId={idpId}
                    idp={idpQuery.data.idp}
                    syncEnabled={syncEnabled}
                    groupClaimsAvailable={groupClaimsAvailable}
                />
            </SettingsContainer>

            <Credenza
                open={showAddDialog}
                onOpenChange={(val) => {
                    if (val) {
                        setShowAddDialog(true);
                    } else {
                        closePolicyDialog();
                    }
                }}
            >
                <CredenzaContent className="max-w-4xl sm:w-full">
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {editingPolicy
                                ? t("orgPoliciesEdit")
                                : t("orgPoliciesAdd")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("orgPolicyConfig")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody className="min-w-0 overflow-x-auto">
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSavePolicy)}
                                className="space-y-4"
                                id="policy-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="orgId"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col">
                                            <FormLabel>{t("org")}</FormLabel>
                                            {editingPolicy ? (
                                                <Input {...field} disabled />
                                            ) : (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant="outline"
                                                                role="combobox"
                                                                className={cn(
                                                                    "justify-between",
                                                                    !field.value &&
                                                                        "text-muted-foreground"
                                                                )}
                                                            >
                                                                {field.value
                                                                    ? availableOrgs.find(
                                                                          (
                                                                              org
                                                                          ) =>
                                                                              org.orgId ===
                                                                              field.value
                                                                      )?.name
                                                                    : t(
                                                                          "orgSelect"
                                                                      )}
                                                                <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="p-0">
                                                        <Command>
                                                            <CommandInput
                                                                placeholder={t(
                                                                    "orgSearch"
                                                                )}
                                                            />
                                                            <CommandList>
                                                                <CommandEmpty>
                                                                    {t(
                                                                        "orgNotFound"
                                                                    )}
                                                                </CommandEmpty>
                                                                <CommandGroup>
                                                                    {availableOrgs.map(
                                                                        (
                                                                            org
                                                                        ) => (
                                                                            <CommandItem
                                                                                value={`${org.orgId}`}
                                                                                key={
                                                                                    org.orgId
                                                                                }
                                                                                onSelect={() => {
                                                                                    form.setValue(
                                                                                        "orgId",
                                                                                        org.orgId
                                                                                    );
                                                                                }}
                                                                            >
                                                                                <CheckIcon
                                                                                    className={cn(
                                                                                        "mr-2 h-4 w-4",
                                                                                        org.orgId ===
                                                                                            field.value
                                                                                            ? "opacity-100"
                                                                                            : "opacity-0"
                                                                                    )}
                                                                                />
                                                                                {
                                                                                    org.name
                                                                                }
                                                                            </CommandItem>
                                                                        )
                                                                    )}
                                                                </CommandGroup>
                                                            </CommandList>
                                                        </Command>
                                                    </PopoverContent>
                                                </Popover>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <IdpLinkedMappingsFields
                                    testResultsApiBase={`/idp/${idpId}`}
                                    syncAvailable={syncEnabled}
                                    groupClaimsAvailable={groupClaimsAvailable}
                                    linked={policyMappingsLinked}
                                    onLinkedChange={(linked) => {
                                        if (!linked) {
                                            // start the sync mappings from the shared ones
                                            setPolicySyncRoleMapping(
                                                policyRoleMapping
                                            );
                                            setPolicySyncCreateMissingRoles(
                                                policyCreateMissingRoles
                                            );
                                            form.setValue(
                                                "syncOrgMapping",
                                                form.getValues("orgMapping") ??
                                                    ""
                                            );
                                        }
                                        setPolicyMappingsLinked(linked);
                                    }}
                                    jit={{
                                        roleMapping: policyRoleMapping,
                                        onRoleMappingChange:
                                            setPolicyRoleMapping,
                                        orgMappingField: {
                                            control: form.control,
                                            name: "orgMapping"
                                        },
                                        createMissingRoles:
                                            policyCreateMissingRoles,
                                        onCreateMissingRolesChange:
                                            setPolicyCreateMissingRoles
                                    }}
                                    sync={{
                                        roleMapping: policySyncRoleMapping,
                                        onRoleMappingChange:
                                            setPolicySyncRoleMapping,
                                        orgMappingField: {
                                            control: form.control,
                                            name: "syncOrgMapping"
                                        },
                                        createMissingRoles:
                                            policySyncCreateMissingRoles,
                                        onCreateMissingRolesChange:
                                            setPolicySyncCreateMissingRoles
                                    }}
                                    roles={policyOrgRoles ?? []}
                                    orgId={
                                        editingPolicy?.orgId || policyFormOrgId
                                    }
                                    fieldIdPrefix="admin-idp-policy-role"
                                />
                            </form>
                        </Form>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("cancel")}</Button>
                        </CredenzaClose>
                        <Button
                            type="submit"
                            form="policy-form"
                            loading={savingPolicy}
                            disabled={savingPolicy}
                        >
                            {editingPolicy
                                ? t("orgPolicyUpdate")
                                : t("orgPolicyAdd")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}

/** The IdP's default mappings, used for orgs without a policy. State starts from the loaded IdP. */
function DefaultMappingsSection({
    idpId,
    idp,
    syncEnabled,
    groupClaimsAvailable
}: {
    idpId: string;
    idp: GetIdpResponse["idp"];
    syncEnabled: boolean;
    groupClaimsAvailable: boolean;
}) {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const t = useTranslations();
    const queryClient = useQueryClient();

    const [saving, setSaving] = useState(false);
    const [defaultRoleMapping, setDefaultRoleMapping] = useState(() =>
        loadRoleMapping(idp.defaultRoleMapping, defaultRoleMappingConfig())
    );
    const [defaultSyncRoleMapping, setDefaultSyncRoleMapping] = useState(() =>
        loadRoleMapping(
            idp.defaultSyncRoleMapping,
            defaultSyncRoleMappingConfig()
        )
    );
    const [defaultCreateMissingRoles, setDefaultCreateMissingRoles] = useState(
        idp.defaultCreateMissingRoles
    );
    const [defaultSyncCreateMissingRoles, setDefaultSyncCreateMissingRoles] =
        useState(idp.defaultSyncCreateMissingRoles);
    const [defaultMappingsLinked, setDefaultMappingsLinked] = useState(
        idp.defaultMappingsLinked
    );

    const defaultMappingsSchema = z.object({
        defaultOrgMapping: z.string().optional(),
        defaultSyncOrgMapping: z.string().optional()
    });
    type DefaultMappingsValues = z.infer<typeof defaultMappingsSchema>;

    const defaultMappingsForm = useForm({
        resolver: zodResolver(defaultMappingsSchema),
        defaultValues: {
            defaultOrgMapping: idp.defaultOrgMapping || "",
            defaultSyncOrgMapping: idp.defaultSyncOrgMapping || ""
        }
    });

    const onSubmit = async (data: DefaultMappingsValues) => {
        const mappings = compileMappings({
            roleMapping: defaultRoleMapping,
            syncRoleMapping: defaultSyncRoleMapping,
            orgMapping: data.defaultOrgMapping,
            syncOrgMapping: data.defaultSyncOrgMapping,
            createMissingRoles: defaultCreateMissingRoles,
            syncCreateMissingRoles: defaultSyncCreateMissingRoles,
            linked: defaultMappingsLinked
        });

        setSaving(true);
        try {
            await api.post(`/idp/${idpId}/oidc`, {
                defaultRoleMapping: mappings.roleMapping,
                defaultOrgMapping: mappings.orgMapping,
                defaultCreateMissingRoles: mappings.createMissingRoles,
                defaultSyncRoleMapping: mappings.syncRoleMapping,
                defaultSyncOrgMapping: mappings.syncOrgMapping,
                defaultSyncCreateMissingRoles: mappings.syncCreateMissingRoles,
                defaultMappingsLinked: mappings.mappingsLinked
            });
            await queryClient.invalidateQueries({
                queryKey: globalIdpQueries.idp({ idpId }).queryKey
            });
            toast({
                title: t("success"),
                description: t("defaultMappingsUpdatedDescription")
            });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("defaultMappingsOptional")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("defaultMappingsOptionalDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <Form {...defaultMappingsForm}>
                    <form
                        onSubmit={defaultMappingsForm.handleSubmit(onSubmit)}
                        id="policy-default-mappings-form"
                        className="space-y-6"
                    >
                        <IdpLinkedMappingsFields
                            testResultsApiBase={`/idp/${idpId}`}
                            syncAvailable={syncEnabled}
                            groupClaimsAvailable={groupClaimsAvailable}
                            linked={defaultMappingsLinked}
                            onLinkedChange={(linked) => {
                                if (!linked) {
                                    // start the sync mappings from the shared ones
                                    setDefaultSyncRoleMapping(
                                        defaultRoleMapping
                                    );
                                    setDefaultSyncCreateMissingRoles(
                                        defaultCreateMissingRoles
                                    );
                                    defaultMappingsForm.setValue(
                                        "defaultSyncOrgMapping",
                                        defaultMappingsForm.getValues(
                                            "defaultOrgMapping"
                                        ) ?? ""
                                    );
                                }
                                setDefaultMappingsLinked(linked);
                            }}
                            jit={{
                                roleMapping: defaultRoleMapping,
                                onRoleMappingChange: setDefaultRoleMapping,
                                orgMappingField: {
                                    control: defaultMappingsForm.control,
                                    name: "defaultOrgMapping",
                                    labelKey: "defaultMappingsOrg"
                                },
                                createMissingRoles: defaultCreateMissingRoles,
                                onCreateMissingRolesChange:
                                    setDefaultCreateMissingRoles
                            }}
                            sync={{
                                roleMapping: defaultSyncRoleMapping,
                                onRoleMappingChange: setDefaultSyncRoleMapping,
                                orgMappingField: {
                                    control: defaultMappingsForm.control,
                                    name: "defaultSyncOrgMapping",
                                    labelKey: "defaultMappingsOrg"
                                },
                                createMissingRoles:
                                    defaultSyncCreateMissingRoles,
                                onCreateMissingRolesChange:
                                    setDefaultSyncCreateMissingRoles
                            }}
                            roles={[]}
                            fieldIdPrefix="admin-idp-default-role"
                            showFreeformRoleNamesHint
                        />
                    </form>
                </Form>
                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        form="policy-default-mappings-form"
                        loading={saving}
                    >
                        {t("defaultMappingsSubmit")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSectionBody>
        </SettingsSection>
    );
}
