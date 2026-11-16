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
import AutoProvisionConfigWidget from "@app/components/AutoProvisionConfigWidget";
import {
    compileRoleMappingExpression,
    createMappingBuilderRule,
    defaultRoleMappingConfig,
    detectRoleMappingConfig,
    MappingBuilderRule,
    RoleMappingMode
} from "@app/lib/idpRoleMapping";

type Organization = {
    orgId: string;
    name: string;
};

function resetRoleMappingStateFromDetected(
    setMode: (m: RoleMappingMode) => void,
    setFixed: (v: string[]) => void,
    setClaim: (v: string) => void,
    setRules: (v: MappingBuilderRule[]) => void,
    setRaw: (v: string) => void,
    stored: string | null | undefined
) {
    const d = detectRoleMappingConfig(stored);
    setMode(d.mode);
    setFixed(d.fixedRoleNames);
    setClaim(d.mappingBuilder.claimPath);
    setRules(d.mappingBuilder.rules);
    setRaw(d.rawExpression);
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

    const [defaultRoleMappingMode, setDefaultRoleMappingMode] =
        useState<RoleMappingMode>("fixedRoles");
    const [defaultFixedRoleNames, setDefaultFixedRoleNames] = useState<
        string[]
    >([]);
    const [defaultMappingBuilderClaimPath, setDefaultMappingBuilderClaimPath] =
        useState("groups");
    const [defaultMappingBuilderRules, setDefaultMappingBuilderRules] =
        useState<MappingBuilderRule[]>([createMappingBuilderRule()]);
    const [defaultRawRoleExpression, setDefaultRawRoleExpression] =
        useState("");
    const [defaultCreateMissingRoles, setDefaultCreateMissingRoles] =
        useState(false);

    const [policyRoleMappingMode, setPolicyRoleMappingMode] =
        useState<RoleMappingMode>("fixedRoles");
    const [policyFixedRoleNames, setPolicyFixedRoleNames] = useState<string[]>(
        []
    );
    const [policyMappingBuilderClaimPath, setPolicyMappingBuilderClaimPath] =
        useState("groups");
    const [policyMappingBuilderRules, setPolicyMappingBuilderRules] = useState<
        MappingBuilderRule[]
    >([createMappingBuilderRule()]);
    const [policyRawRoleExpression, setPolicyRawRoleExpression] = useState("");
    const [policyCreateMissingRoles, setPolicyCreateMissingRoles] =
        useState(false);
    const [policyOrgRoles, setPolicyOrgRoles] = useState<
        { roleId: number; name: string }[]
    >([]);

    const policyFormSchema = z.object({
        orgId: z.string().min(1, { message: t("orgRequired") }),
        orgMapping: z.string().optional()
    });

    const defaultMappingsSchema = z.object({
        defaultOrgMapping: z.string().optional()
    });

    type PolicyFormValues = z.infer<typeof policyFormSchema>;
    type DefaultMappingsValues = z.infer<typeof defaultMappingsSchema>;

    const form = useForm({
        resolver: zodResolver(policyFormSchema),
        defaultValues: {
            orgId: "",
            orgMapping: ""
        }
    });

    const policyFormOrgId = form.watch("orgId");

    const defaultMappingsForm = useForm({
        resolver: zodResolver(defaultMappingsSchema),
        defaultValues: {
            defaultOrgMapping: ""
        }
    });

    const loadIdp = async () => {
        try {
            const res = await api.get<AxiosResponse<GetIdpResponse>>(
                `/idp/${idpId}`
            );
            if (res.status === 200) {
                const data = res.data.data;
                defaultMappingsForm.reset({
                    defaultOrgMapping: data.idp.defaultOrgMapping || ""
                });
                resetRoleMappingStateFromDetected(
                    setDefaultRoleMappingMode,
                    setDefaultFixedRoleNames,
                    setDefaultMappingBuilderClaimPath,
                    setDefaultMappingBuilderRules,
                    setDefaultRawRoleExpression,
                    data.idp.defaultRoleMapping
                );
                setDefaultCreateMissingRoles(
                    data.idp.defaultCreateMissingRoles ?? false
                );
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

    function resetPolicyDialogRoleMappingState() {
        const d = defaultRoleMappingConfig();
        setPolicyRoleMappingMode(d.mode);
        setPolicyFixedRoleNames(d.fixedRoleNames);
        setPolicyMappingBuilderClaimPath(d.mappingBuilder.claimPath);
        setPolicyMappingBuilderRules(d.mappingBuilder.rules);
        setPolicyRawRoleExpression(d.rawExpression);
        setPolicyCreateMissingRoles(false);
    }

    function policyRoleMappingConfig() {
        return {
            mode: policyRoleMappingMode,
            fixedRoleNames: policyFixedRoleNames,
            mappingBuilder: {
                claimPath: policyMappingBuilderClaimPath,
                rules: policyMappingBuilderRules
            },
            rawExpression: policyRawRoleExpression
        };
    }

    const onAddPolicy = async (data: PolicyFormValues) => {
        const roleMappingExpression = compileRoleMappingExpression(
            policyRoleMappingConfig()
        );

        setAddPolicyLoading(true);
        try {
            const res = await api.put(`/idp/${idpId}/org/${data.orgId}`, {
                roleMapping: roleMappingExpression,
                orgMapping: data.orgMapping,
                createMissingRoles: policyCreateMissingRoles
            });
            if (res.status === 201) {
                const newPolicy = {
                    orgId: data.orgId,
                    name:
                        organizations.find((org) => org.orgId === data.orgId)
                            ?.name || "",
                    roleMapping: roleMappingExpression,
                    orgMapping: data.orgMapping,
                    createMissingRoles: policyCreateMissingRoles
                };
                setPolicies([...policies, newPolicy]);
                toast({
                    title: t("success"),
                    description: t("orgPolicyAddedDescription")
                });
                setShowAddDialog(false);
                form.reset();
                resetPolicyDialogRoleMappingState();
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

        const roleMappingExpression = compileRoleMappingExpression(
            policyRoleMappingConfig()
        );

        setEditPolicyLoading(true);
        try {
            const res = await api.post(
                `/idp/${idpId}/org/${editingPolicy.orgId}`,
                {
                    roleMapping: roleMappingExpression,
                    orgMapping: data.orgMapping,
                    createMissingRoles: policyCreateMissingRoles
                }
            );
            if (res.status === 200) {
                setPolicies(
                    policies.map((policy) =>
                        policy.orgId === editingPolicy.orgId
                            ? {
                                  ...policy,
                                  roleMapping: roleMappingExpression,
                                  orgMapping: data.orgMapping,
                                  createMissingRoles: policyCreateMissingRoles
                              }
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
                resetPolicyDialogRoleMappingState();
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
        const defaultRoleMappingExpression = compileRoleMappingExpression({
            mode: defaultRoleMappingMode,
            fixedRoleNames: defaultFixedRoleNames,
            mappingBuilder: {
                claimPath: defaultMappingBuilderClaimPath,
                rules: defaultMappingBuilderRules
            },
            rawExpression: defaultRawRoleExpression
        });

        setUpdateDefaultMappingsLoading(true);
        try {
            const res = await api.post(`/idp/${idpId}/oidc`, {
                defaultRoleMapping: defaultRoleMappingExpression,
                defaultOrgMapping: data.defaultOrgMapping,
                defaultCreateMissingRoles
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
                            orgMapping: ""
                        });
                        setEditingPolicy(null);
                        resetPolicyDialogRoleMappingState();
                        setShowAddDialog(true);
                    }}
                    onEdit={(policy) => {
                        setEditingPolicy(policy);
                        form.reset({
                            orgId: policy.orgId,
                            orgMapping: policy.orgMapping || ""
                        });
                        resetRoleMappingStateFromDetected(
                            setPolicyRoleMappingMode,
                            setPolicyFixedRoleNames,
                            setPolicyMappingBuilderClaimPath,
                            setPolicyMappingBuilderRules,
                            setPolicyRawRoleExpression,
                            policy.roleMapping
                        );
                        setPolicyCreateMissingRoles(
                            policy.createMissingRoles ?? false
                        );
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
                                <AutoProvisionConfigWidget
                                    showAutoProvisionSwitch={false}
                                    autoProvision={true}
                                    onAutoProvisionChange={() => {}}
                                    orgMappingField={{
                                        control: defaultMappingsForm.control,
                                        name: "defaultOrgMapping",
                                        labelKey: "defaultMappingsOrg"
                                    }}
                                    roleMappingFieldIdPrefix="admin-idp-default-role"
                                    showFreeformRoleNamesHint
                                    roleMappingMode={defaultRoleMappingMode}
                                    onRoleMappingModeChange={
                                        setDefaultRoleMappingMode
                                    }
                                    roles={[]}
                                    fixedRoleNames={defaultFixedRoleNames}
                                    onFixedRoleNamesChange={
                                        setDefaultFixedRoleNames
                                    }
                                    mappingBuilderClaimPath={
                                        defaultMappingBuilderClaimPath
                                    }
                                    onMappingBuilderClaimPathChange={
                                        setDefaultMappingBuilderClaimPath
                                    }
                                    mappingBuilderRules={
                                        defaultMappingBuilderRules
                                    }
                                    onMappingBuilderRulesChange={
                                        setDefaultMappingBuilderRules
                                    }
                                    rawExpression={defaultRawRoleExpression}
                                    onRawExpressionChange={
                                        setDefaultRawRoleExpression
                                    }
                                    createMissingRoles={
                                        defaultCreateMissingRoles
                                    }
                                    onCreateMissingRolesChange={
                                        setDefaultCreateMissingRoles
                                    }
                                    createMissingRolesInAnyMode
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
                        resetPolicyDialogRoleMappingState();
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

                                <AutoProvisionConfigWidget
                                    showAutoProvisionSwitch={false}
                                    autoProvision={true}
                                    onAutoProvisionChange={() => {}}
                                    orgMappingField={{
                                        control: form.control,
                                        name: "orgMapping"
                                    }}
                                    orgId={
                                        editingPolicy?.orgId || policyFormOrgId
                                    }
                                    roleMappingFieldIdPrefix="admin-idp-policy-role"
                                    roleMappingMode={policyRoleMappingMode}
                                    onRoleMappingModeChange={
                                        setPolicyRoleMappingMode
                                    }
                                    roles={policyOrgRoles}
                                    fixedRoleNames={policyFixedRoleNames}
                                    onFixedRoleNamesChange={
                                        setPolicyFixedRoleNames
                                    }
                                    mappingBuilderClaimPath={
                                        policyMappingBuilderClaimPath
                                    }
                                    onMappingBuilderClaimPathChange={
                                        setPolicyMappingBuilderClaimPath
                                    }
                                    mappingBuilderRules={
                                        policyMappingBuilderRules
                                    }
                                    onMappingBuilderRulesChange={
                                        setPolicyMappingBuilderRules
                                    }
                                    rawExpression={policyRawRoleExpression}
                                    onRawExpressionChange={
                                        setPolicyRawRoleExpression
                                    }
                                    createMissingRoles={
                                        policyCreateMissingRoles
                                    }
                                    onCreateMissingRolesChange={
                                        setPolicyCreateMissingRoles
                                    }
                                    createMissingRolesInAnyMode
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
