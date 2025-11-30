"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
    FormDescription,
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
import PolicyTable, { PolicyRow } from "../../../../../components/PolicyTable";
import { AxiosResponse } from "axios";
import { ListOrgsResponse } from "@server/routers/org";
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
import { Textarea } from "@app/components/ui/textarea";
import { InfoPopup } from "@app/components/ui/info-popup";
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

type Organization = {
    orgId: string;
    name: string;
};

export default function PoliciesPage() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const router = useRouter();
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

    const policyFormSchema = z.object({
        orgId: z.string().min(1, { message: t('orgRequired') }),
        roleMapping: z.string().optional(),
        orgMapping: z.string().optional()
    });

    const defaultMappingsSchema = z.object({
        defaultRoleMapping: z.string().optional(),
        defaultOrgMapping: z.string().optional()
    });

    type PolicyFormValues = z.infer<typeof policyFormSchema>;
    type DefaultMappingsValues = z.infer<typeof defaultMappingsSchema>;

    const form = useForm({
        resolver: zodResolver(policyFormSchema),
        defaultValues: {
            orgId: "",
            roleMapping: "",
            orgMapping: ""
        }
    });

    const defaultMappingsForm = useForm({
        resolver: zodResolver(defaultMappingsSchema),
        defaultValues: {
            defaultRoleMapping: "",
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
                    defaultRoleMapping: data.idp.defaultRoleMapping || "",
                    defaultOrgMapping: data.idp.defaultOrgMapping || ""
                });
            }
        } catch (e) {
            toast({
                title: t('error'),
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
                title: t('error'),
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
                title: t('error'),
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

    const onAddPolicy = async (data: PolicyFormValues) => {
        setAddPolicyLoading(true);
        try {
            const res = await api.put(`/idp/${idpId}/org/${data.orgId}`, {
                roleMapping: data.roleMapping,
                orgMapping: data.orgMapping
            });
            if (res.status === 201) {
                const newPolicy = {
                    orgId: data.orgId,
                    name:
                        organizations.find((org) => org.orgId === data.orgId)
                            ?.name || "",
                    roleMapping: data.roleMapping,
                    orgMapping: data.orgMapping
                };
                setPolicies([...policies, newPolicy]);
                toast({
                    title: t('success'),
                    description: t('orgPolicyAddedDescription')
                });
                setShowAddDialog(false);
                form.reset();
            }
        } catch (e) {
            toast({
                title: t('error'),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setAddPolicyLoading(false);
        }
    };

    const onEditPolicy = async (data: PolicyFormValues) => {
        if (!editingPolicy) return;

        setEditPolicyLoading(true);
        try {
            const res = await api.post(
                `/idp/${idpId}/org/${editingPolicy.orgId}`,
                {
                    roleMapping: data.roleMapping,
                    orgMapping: data.orgMapping
                }
            );
            if (res.status === 200) {
                setPolicies(
                    policies.map((policy) =>
                        policy.orgId === editingPolicy.orgId
                            ? {
                                  ...policy,
                                  roleMapping: data.roleMapping,
                                  orgMapping: data.orgMapping
                              }
                            : policy
                    )
                );
                toast({
                    title: t('success'),
                    description: t('orgPolicyUpdatedDescription')
                });
                setShowAddDialog(false);
                setEditingPolicy(null);
                form.reset();
            }
        } catch (e) {
            toast({
                title: t('error'),
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
                    title: t('success'),
                    description: t('orgPolicyDeletedDescription')
                });
            }
        } catch (e) {
            toast({
                title: t('error'),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setDeletePolicyLoading(false);
        }
    };

    const onUpdateDefaultMappings = async (data: DefaultMappingsValues) => {
        setUpdateDefaultMappingsLoading(true);
        try {
            const res = await api.post(`/idp/${idpId}/oidc`, {
                defaultRoleMapping: data.defaultRoleMapping,
                defaultOrgMapping: data.defaultOrgMapping
            });
            if (res.status === 200) {
                toast({
                    title: t('success'),
                    description: t('defaultMappingsUpdatedDescription')
                });
            }
        } catch (e) {
            toast({
                title: t('error'),
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
                <Alert variant="neutral" className="mb-6">
                    <InfoIcon className="h-4 w-4" />
                    <AlertTitle className="font-semibold">
                        {t('orgPoliciesAbout')}
                    </AlertTitle>
                    <AlertDescription>
                        {/*TODO(vlalx): Validate replacing */}
                        {t('orgPoliciesAboutDescription')}{" "}
                        <Link
                            href="https://docs.pangolin.net/manage/identity-providers/auto-provisioning"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            {t('orgPoliciesAboutDescriptionLink')}
                            <ExternalLink className="ml-1 h-4 w-4 inline" />
                        </Link>
                    </AlertDescription>
                </Alert>

                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t('defaultMappingsOptional')}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t('defaultMappingsOptionalDescription')}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        <Form {...defaultMappingsForm}>
                            <form
                                onSubmit={defaultMappingsForm.handleSubmit(
                                    onUpdateDefaultMappings
                                )}
                                id="policy-default-mappings-form"
                                className="space-y-4"
                            >
                                <div className="grid gap-6 md:grid-cols-2">
                                    <FormField
                                        control={defaultMappingsForm.control}
                                        name="defaultRoleMapping"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t('defaultMappingsRole')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    {t('defaultMappingsRoleDescription')}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={defaultMappingsForm.control}
                                        name="defaultOrgMapping"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t('defaultMappingsOrg')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    {t('defaultMappingsOrgDescription')}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </form>
                        </Form>
                        <SettingsSectionFooter>
                            <Button
                                type="submit"
                                form="policy-default-mappings-form"
                                loading={updateDefaultMappingsLoading}
                            >
                                {t('defaultMappingsSubmit')}
                            </Button>
                        </SettingsSectionFooter>
                    </SettingsSectionBody>
                </SettingsSection>

                <PolicyTable
                    policies={policies}
                    onDelete={onDeletePolicy}
                    onAdd={() => {
                        loadOrganizations();
                        form.reset({
                            orgId: "",
                            roleMapping: "",
                            orgMapping: ""
                        });
                        setEditingPolicy(null);
                        setShowAddDialog(true);
                    }}
                    onEdit={(policy) => {
                        setEditingPolicy(policy);
                        form.reset({
                            orgId: policy.orgId,
                            roleMapping: policy.roleMapping || "",
                            orgMapping: policy.orgMapping || ""
                        });
                        setShowAddDialog(true);
                    }}
                />
            </SettingsContainer>

            <Credenza
                open={showAddDialog}
                onOpenChange={(val) => {
                    setShowAddDialog(val);
                    setEditingPolicy(null);
                    form.reset();
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {editingPolicy
                                ? t('orgPoliciesEdit')
                                : t('orgPoliciesAdd')}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t('orgPolicyConfig')}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
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
                                            <FormLabel>{t('org')}</FormLabel>
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
                                                                    : t('orgSelect')}
                                                                <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="p-0">
                                                        <Command>
                                                            <CommandInput placeholder={t('orgSearch')} />
                                                            <CommandList>
                                                                <CommandEmpty>
                                                                    {t('orgNotFound')}
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

                                <FormField
                                    control={form.control}
                                    name="roleMapping"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t('roleMappingPathOptional')}
                                            </FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormDescription>
                                                {t('defaultMappingsRoleDescription')}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="orgMapping"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t('orgMappingPathOptional')}
                                            </FormLabel>
                                            <FormControl>
                                                <Input {...field} />
                                            </FormControl>
                                            <FormDescription>
                                                {t('defaultMappingsOrgDescription')}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
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
                            {editingPolicy ? t('orgPolicyUpdate') : t('orgPolicyAdd')}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
