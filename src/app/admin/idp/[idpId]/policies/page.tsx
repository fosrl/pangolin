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
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { InfoIcon, ExternalLink, CheckIcon } from "lucide-react";
import PolicyTable, { PolicyRow } from "@app/components/PolicyTable";
import { AxiosResponse } from "axios";
import { ListOrgsResponse } from "@server/routers/org";
import { ListRolesResponse } from "@server/routers/role";
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
import Link from "next/link";
import { GetIdpResponse } from "@server/routers/idp";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionFooter,
    SettingsSectionForm
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

type Organization = {
    orgId: string;
    name: string;
};

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

export default function PoliciesPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { idpId } = useParams();
    const t = useTranslations();

    const [pageLoading, setPageLoading] = useState(true);
    const [addPolicyLoading, setAddPolicyLoading] = useState(false);
    const [editPolicyLoading, setEditPolicyLoading] = useState(false);
    const [deletePolicyLoading, setDeletePolicyLoading] = useState(false);
    const [updateDefaultMappingsLoading, setUpdateDefaultMappingsLoading] =
        useState(false);
    const [policies, setPolicies] = useState<PolicyRow[]>([]);
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<PolicyRow | null>(null);
    // sync mappings only exist for providers with an API integration
    const [syncAvailable, setSyncAvailable] = useState(false);

    const [defaultRoleMapping, setDefaultRoleMapping] =
        useState<RoleMappingConfig>(defaultRoleMappingConfig);
    const [defaultSyncRoleMapping, setDefaultSyncRoleMapping] =
        useState<RoleMappingConfig>(defaultSyncRoleMappingConfig);
    const [defaultCreateMissingRoles, setDefaultCreateMissingRoles] =
        useState(false);
    const [defaultSyncCreateMissingRoles, setDefaultSyncCreateMissingRoles] =
        useState(false);
    const [defaultMappingsLinked, setDefaultMappingsLinked] = useState(true);

    const [policyRoleMapping, setPolicyRoleMapping] =
        useState<RoleMappingConfig>(defaultRoleMappingConfig);
    const [policySyncRoleMapping, setPolicySyncRoleMapping] =
        useState<RoleMappingConfig>(defaultSyncRoleMappingConfig);
    const [policyCreateMissingRoles, setPolicyCreateMissingRoles] =
        useState(false);
    const [policySyncCreateMissingRoles, setPolicySyncCreateMissingRoles] =
        useState(false);
    const [policyMappingsLinked, setPolicyMappingsLinked] = useState(true);
    const [policyOrgRoles, setPolicyOrgRoles] = useState<
        { roleId: number; name: string }[]
    >([]);

    const policyFormSchema = z.object({
        orgId: z.string().min(1, { message: t("orgRequired") }),
        orgMapping: z.string().optional(),
        syncOrgMapping: z.string().optional()
    });

    const defaultMappingsSchema = z.object({
        defaultOrgMapping: z.string().optional(),
        defaultSyncOrgMapping: z.string().optional()
    });

    type PolicyFormValues = z.infer<typeof policyFormSchema>;
    type DefaultMappingsValues = z.infer<typeof defaultMappingsSchema>;

    const form = useForm({
        resolver: zodResolver(policyFormSchema),
        defaultValues: {
            orgId: "",
            orgMapping: "",
            syncOrgMapping: ""
        }
    });

    const policyFormOrgId = form.watch("orgId");

    const defaultMappingsForm = useForm({
        resolver: zodResolver(defaultMappingsSchema),
        defaultValues: {
            defaultOrgMapping: "",
            defaultSyncOrgMapping: ""
        }
    });

    const loadIdp = async () => {
        try {
            const res = await api.get<AxiosResponse<GetIdpResponse>>(
                `/idp/${idpId}`
            );
            if (res.status === 200) {
                const data = res.data.data;
                const variant = data.idpOidcConfig?.variant;
                setSyncAvailable(variant === "google" || variant === "azure");
                defaultMappingsForm.reset({
                    defaultOrgMapping: data.idp.defaultOrgMapping || "",
                    defaultSyncOrgMapping: data.idp.defaultSyncOrgMapping || ""
                });
                setDefaultRoleMapping(
                    loadRoleMapping(
                        data.idp.defaultRoleMapping,
                        defaultRoleMappingConfig()
                    )
                );
                setDefaultSyncRoleMapping(
                    loadRoleMapping(
                        data.idp.defaultSyncRoleMapping,
                        defaultSyncRoleMappingConfig()
                    )
                );
                setDefaultCreateMissingRoles(
                    data.idp.defaultCreateMissingRoles ?? false
                );
                setDefaultSyncCreateMissingRoles(
                    data.idp.defaultSyncCreateMissingRoles ?? false
                );
                setDefaultMappingsLinked(data.idp.defaultMappingsLinked ?? true);
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const loadPolicies = async () => {
        try {
            const res = await api.get(`/idp/${idpId}/org`);
            if (res.status === 200) {
                setPolicies(res.data.data.policies);
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const loadOrganizations = async () => {
        try {
            const res = await api.get<AxiosResponse<ListOrgsResponse>>("/orgs");
            if (res.status === 200) {
                const existingOrgIds = policies.map((p) => p.orgId);
                const availableOrgs = res.data.data.orgs.filter(
                    (org) => !existingOrgIds.includes(org.orgId)
                );
                setOrganizations(availableOrgs);
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    useEffect(() => {
        async function load() {
            setPageLoading(true);
            await loadPolicies();
            await loadIdp();
            setPageLoading(false);
        }
        load();
    }, [idpId]);

    useEffect(() => {
        if (!showAddDialog) {
            return;
        }

        const orgId = editingPolicy?.orgId || policyFormOrgId;
        if (!orgId) {
            setPolicyOrgRoles([]);
            return;
        }

        let cancelled = false;
        (async () => {
            const res = await api
                .get<AxiosResponse<ListRolesResponse>>(`/org/${orgId}/roles`)
                .catch((e) => {
                    console.error(e);
                    toast({
                        variant: "destructive",
                        title: t("accessRoleErrorFetch"),
                        description: formatAxiosError(
                            e,
                            t("accessRoleErrorFetchDescription")
                        )
                    });
                    return null;
                });
            if (!cancelled && res?.status === 200) {
                setPolicyOrgRoles(res.data.data.roles);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [showAddDialog, editingPolicy?.orgId, policyFormOrgId, api, t]);

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
        setPolicySyncCreateMissingRoles(policy?.syncCreateMissingRoles ?? false);
        setPolicyMappingsLinked(policy?.mappingsLinked ?? true);
    }

    function compilePolicyMappings(data: PolicyFormValues) {
        return compileMappings({
            roleMapping: policyRoleMapping,
            syncRoleMapping: policySyncRoleMapping,
            orgMapping: data.orgMapping,
            syncOrgMapping: data.syncOrgMapping,
            createMissingRoles: policyCreateMissingRoles,
            syncCreateMissingRoles: policySyncCreateMissingRoles,
            linked: policyMappingsLinked
        });
    }

    const onAddPolicy = async (data: PolicyFormValues) => {
        const mappings = compilePolicyMappings(data);

        setAddPolicyLoading(true);
        try {
            const res = await api.put(
                `/idp/${idpId}/org/${data.orgId}`,
                mappings
            );
            if (res.status === 201) {
                const newPolicy = {
                    orgId: data.orgId,
                    name:
                        organizations.find((org) => org.orgId === data.orgId)
                            ?.name || "",
                    ...mappings
                };
                setPolicies([...policies, newPolicy]);
                toast({
                    title: t("success"),
                    description: t("orgPolicyAddedDescription")
                });
                setShowAddDialog(false);
                form.reset();
                loadPolicyDialogMappings(null);
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setAddPolicyLoading(false);
        }
    };

    const onEditPolicy = async (data: PolicyFormValues) => {
        if (!editingPolicy) return;

        const mappings = compilePolicyMappings(data);

        setEditPolicyLoading(true);
        try {
            const res = await api.post(
                `/idp/${idpId}/org/${editingPolicy.orgId}`,
                mappings
            );
            if (res.status === 200) {
                setPolicies(
                    policies.map((policy) =>
                        policy.orgId === editingPolicy.orgId
                            ? { ...policy, ...mappings }
                            : policy
                    )
                );
                toast({
                    title: t("success"),
                    description: t("orgPolicyUpdatedDescription")
                });
                setShowAddDialog(false);
                setEditingPolicy(null);
                form.reset();
                loadPolicyDialogMappings(null);
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setEditPolicyLoading(false);
        }
    };

    const onDeletePolicy = async (orgId: string) => {
        setDeletePolicyLoading(true);
        try {
            const res = await api.delete(`/idp/${idpId}/org/${orgId}`);
            if (res.status === 200) {
                setPolicies(
                    policies.filter((policy) => policy.orgId !== orgId)
                );
                toast({
                    title: t("success"),
                    description: t("orgPolicyDeletedDescription")
                });
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setDeletePolicyLoading(false);
        }
    };

    const onUpdateDefaultMappings = async (data: DefaultMappingsValues) => {
        const mappings = compileMappings({
            roleMapping: defaultRoleMapping,
            syncRoleMapping: defaultSyncRoleMapping,
            orgMapping: data.defaultOrgMapping,
            syncOrgMapping: data.defaultSyncOrgMapping,
            createMissingRoles: defaultCreateMissingRoles,
            syncCreateMissingRoles: defaultSyncCreateMissingRoles,
            linked: defaultMappingsLinked
        });

        setUpdateDefaultMappingsLoading(true);
        try {
            const res = await api.post(`/idp/${idpId}/oidc`, {
                defaultRoleMapping: mappings.roleMapping,
                defaultOrgMapping: mappings.orgMapping,
                defaultCreateMissingRoles: mappings.createMissingRoles,
                defaultSyncRoleMapping: mappings.syncRoleMapping,
                defaultSyncOrgMapping: mappings.syncOrgMapping,
                defaultSyncCreateMissingRoles: mappings.syncCreateMissingRoles,
                defaultMappingsLinked: mappings.mappingsLinked
            });
            if (res.status === 200) {
                toast({
                    title: t("success"),
                    description: t("defaultMappingsUpdatedDescription")
                });
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setUpdateDefaultMappingsLoading(false);
        }
    };

    if (pageLoading) {
        return null;
    }

    return (
        <>
            <SettingsContainer>
                <PolicyTable
                    policies={policies}
                    onDelete={onDeletePolicy}
                    onAdd={() => {
                        loadOrganizations();
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
                                onSubmit={defaultMappingsForm.handleSubmit(
                                    onUpdateDefaultMappings
                                )}
                                id="policy-default-mappings-form"
                                className="space-y-6"
                            >
                                <IdpLinkedMappingsFields
                                    syncAvailable={syncAvailable}
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
                                        onRoleMappingChange:
                                            setDefaultRoleMapping,
                                        orgMappingField: {
                                            control:
                                                defaultMappingsForm.control,
                                            name: "defaultOrgMapping",
                                            labelKey: "defaultMappingsOrg"
                                        },
                                        createMissingRoles:
                                            defaultCreateMissingRoles,
                                        onCreateMissingRolesChange:
                                            setDefaultCreateMissingRoles
                                    }}
                                    sync={{
                                        roleMapping: defaultSyncRoleMapping,
                                        onRoleMappingChange:
                                            setDefaultSyncRoleMapping,
                                        orgMappingField: {
                                            control:
                                                defaultMappingsForm.control,
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
                                loading={updateDefaultMappingsLoading}
                            >
                                {t("defaultMappingsSubmit")}
                            </Button>
                        </SettingsSectionFooter>
                    </SettingsSectionBody>
                </SettingsSection>
            </SettingsContainer>

            <Credenza
                open={showAddDialog}
                onOpenChange={(val) => {
                    setShowAddDialog(val);
                    if (!val) {
                        setEditingPolicy(null);
                        form.reset();
                        loadPolicyDialogMappings(null);
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
                                onSubmit={form.handleSubmit(
                                    editingPolicy ? onEditPolicy : onAddPolicy
                                )}
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
                                                                    ? organizations.find(
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
                                                                    {organizations.map(
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
                                    syncAvailable={syncAvailable}
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
                                    roles={policyOrgRoles}
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
                            loading={
                                editingPolicy
                                    ? editPolicyLoading
                                    : addPolicyLoading
                            }
                            disabled={
                                editingPolicy
                                    ? editPolicyLoading
                                    : addPolicyLoading
                            }
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
