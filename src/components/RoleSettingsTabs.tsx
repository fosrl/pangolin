"use client";

import {
    BudgetRowsFields,
    getBudgetRowsErrors,
    rowsFromBudgets,
    saveBudgetRows,
    type BudgetRow
} from "@app/components/BudgetsEditor";
import {
    defaultRoleClientSettings,
    RoleClientSettingsFields,
    saveRoleClientSettings
} from "@app/components/RoleClientSettingsFields";
import {
    RoleApprovalFields,
    roleApprovalsSchema,
    RoleClientSettingsDescription,
    RoleFormSection,
    RoleGeneralFields,
    roleGeneralSchema,
    RoleSshFields,
    roleSshPayload,
    roleSshSchema,
    roleSshValues,
    type RoleSshValues
} from "@app/components/RoleFormFields";
import { SettingsFormCell } from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { Form } from "@app/components/ui/form";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useRoleContext } from "@app/hooks/useRoleContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { aiBudgetQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { UpdateRoleBody, UpdateRoleResponse } from "@server/routers/role";
import type { ListAiBudgetsByScopeResponse } from "@server/routers/aiBudget/types";
import type { RoleClientSettingsValues } from "@server/routers/role/types";
import type { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

function useRoleApi() {
    return createApiClient(useEnvContext());
}

function toastUpdated(t: ReturnType<typeof useTranslations>) {
    toast({
        variant: "default",
        title: t("accessRoleUpdated"),
        description: t("accessRoleUpdatedDescription")
    });
}

function toastUpdateError(t: ReturnType<typeof useTranslations>, e: unknown) {
    toast({
        variant: "destructive",
        title: t("accessRoleErrorUpdate"),
        description: formatAxiosError(e, t("accessRoleErrorUpdateDescription"))
    });
}

// Saves fields on the role itself and refreshes the layout (its title shows
// the role name).
function useUpdateRole() {
    const t = useTranslations();
    const api = useRoleApi();
    const router = useRouter();
    const { role, updateRole } = useRoleContext();
    const [loading, startTransition] = useTransition();

    function save(payload: UpdateRoleBody) {
        startTransition(async () => {
            try {
                const res = await api.post<AxiosResponse<UpdateRoleResponse>>(
                    `/role/${role.roleId}`,
                    payload
                );
                updateRole(res.data.data);
                toastUpdated(t);
                router.refresh();
            } catch (e) {
                toastUpdateError(t, e);
            }
        });
    }

    return { save, loading };
}

function SaveButton({
    formId,
    loading,
    disabled,
    onClick
}: {
    formId?: string;
    loading: boolean;
    disabled?: boolean;
    onClick?: () => void;
}) {
    const t = useTranslations();
    return (
        <Button
            type={formId ? "submit" : "button"}
            form={formId}
            onClick={onClick}
            loading={loading}
            disabled={loading || disabled}
        >
            {t("saveSettings")}
        </Button>
    );
}

export function RoleGeneralSettings() {
    const t = useTranslations();
    const { role } = useRoleContext();
    const { save, loading } = useUpdateRole();

    const schema = roleGeneralSchema(t);
    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: {
            name: role.name,
            description: role.description ?? ""
        }
    });

    const formId = "role-general-form";

    return (
        <Form {...form}>
            <form
                id={formId}
                onSubmit={form.handleSubmit((values) =>
                    save({
                        name: values.name,
                        description: values.description || undefined
                    })
                )}
            >
                <RoleFormSection
                    title={t("general")}
                    description={t("accessRoleGeneralDescription")}
                    footer={
                        <SaveButton
                            formId={formId}
                            loading={loading}
                            disabled={role.isAdmin === true}
                        />
                    }
                >
                    <RoleGeneralFields readOnly={role.isAdmin === true} />
                </RoleFormSection>
            </form>
        </Form>
    );
}

export function RoleApprovalSettings() {
    const t = useTranslations();
    const { role } = useRoleContext();
    const { save, loading } = useUpdateRole();

    const form = useForm<z.infer<typeof roleApprovalsSchema>>({
        resolver: zodResolver(roleApprovalsSchema),
        defaultValues: {
            requireDeviceApproval: role.requireDeviceApproval ?? false
        }
    });

    const formId = "role-approvals-form";

    return (
        <Form {...form}>
            <form
                id={formId}
                onSubmit={form.handleSubmit((values) =>
                    save({
                        requireDeviceApproval: values.requireDeviceApproval
                    })
                )}
            >
                <RoleFormSection
                    title={t("accessRoleApprovals")}
                    description={t("accessRoleApprovalsDescription")}
                    footer={<SaveButton formId={formId} loading={loading} />}
                >
                    <RoleApprovalFields />
                </RoleFormSection>
            </form>
        </Form>
    );
}

export function RoleSshSettings() {
    const t = useTranslations();
    const { role } = useRoleContext();
    const { isPaidUser } = usePaidStatus();
    const { save, loading } = useUpdateRole();

    const schema = roleSshSchema(t);
    const form = useForm<RoleSshValues>({
        resolver: zodResolver(schema),
        defaultValues: roleSshValues(role)
    });

    const formId = "role-ssh-form";

    return (
        <Form {...form}>
            <form
                id={formId}
                onSubmit={form.handleSubmit((values) =>
                    save(
                        roleSshPayload(
                            values,
                            isPaidUser(tierMatrix.roleBasedSSHControls)
                        )
                    )
                )}
            >
                <RoleFormSection
                    title={t("sshAccess")}
                    description={t("accessRoleSshAccessDescription")}
                    footer={<SaveButton formId={formId} loading={loading} />}
                >
                    <RoleSshFields />
                </RoleFormSection>
            </form>
        </Form>
    );
}

export function RoleAiBudgetSettings({
    initialBudgets
}: {
    initialBudgets?: ListAiBudgetsByScopeResponse["budgets"];
}) {
    const t = useTranslations();
    const api = useRoleApi();
    const queryClient = useQueryClient();
    const { role } = useRoleContext();
    const [loading, startTransition] = useTransition();

    const scope = { type: "role" as const, id: role.roleId };
    const budgetsQuery = useQuery({
        ...aiBudgetQueries.scoped({ scope }),
        initialData: initialBudgets
    });

    const [rows, setRows] = useState<BudgetRow[]>(() =>
        initialBudgets ? rowsFromBudgets(initialBudgets) : []
    );
    const [attemptedSave, setAttemptedSave] = useState(false);

    useEffect(() => {
        if (!budgetsQuery.data) return;
        setRows(rowsFromBudgets(budgetsQuery.data));
        setAttemptedSave(false);
    }, [budgetsQuery.data]);

    function onSave() {
        const { conflictingKeys, invalidAmountKeys } =
            getBudgetRowsErrors(rows);
        if (conflictingKeys.size > 0 || invalidAmountKeys.size > 0) {
            setAttemptedSave(true);
            toast({
                variant: "destructive",
                title: t("aiBudgetErrorSave"),
                description: conflictingKeys.size
                    ? t("aiBudgetConflictError")
                    : t("aiBudgetInvalidAmountError")
            });
            return;
        }

        startTransition(async () => {
            try {
                const existingBudgets = await queryClient.fetchQuery(
                    aiBudgetQueries.scoped({ scope })
                );
                await saveBudgetRows({
                    api,
                    orgId: role.orgId,
                    scope,
                    existingBudgets,
                    rows
                });
                await queryClient.invalidateQueries(
                    aiBudgetQueries.scoped({ scope })
                );
                toastUpdated(t);
            } catch (e) {
                toast({
                    variant: "destructive",
                    title: t("aiBudgetErrorSave"),
                    description: formatAxiosError(e, t("aiBudgetErrorSave"))
                });
            }
        });
    }

    return (
        <RoleFormSection
            title={t("accessRoleInferenceBudget")}
            description={t("accessRoleInferenceBudgetDescription")}
            footer={
                <SaveButton
                    loading={loading}
                    disabled={budgetsQuery.isLoading}
                    onClick={onSave}
                />
            }
        >
            <SettingsFormCell span="full">
                <BudgetRowsFields
                    rows={rows}
                    onChange={setRows}
                    disabled={budgetsQuery.isLoading}
                    attemptedSave={attemptedSave}
                />
            </SettingsFormCell>
        </RoleFormSection>
    );
}

export function RoleClientSettingsSettings({
    initialSettings,
    initialGateways
}: {
    initialSettings?: RoleClientSettingsValues;
    initialGateways?: ListAllSiteResourcesByOrgResponse["siteResources"];
}) {
    const t = useTranslations();
    const api = useRoleApi();
    const queryClient = useQueryClient();
    const { role } = useRoleContext();
    const { isPaidUser } = usePaidStatus();
    const [loading, startTransition] = useTransition();

    const disabled = !isPaidUser(tierMatrix.clientSettings);
    const queryKey = ["ROLE", role.roleId, "CLIENT_SETTINGS"] as const;

    const settingsQuery = useQuery({
        queryKey,
        queryFn: async ({ signal }) => {
            const res = await api.get<AxiosResponse<RoleClientSettingsValues>>(
                `/role/${role.roleId}/client-settings`,
                { signal }
            );
            return res.data.data;
        },
        enabled: !disabled,
        initialData: initialSettings
    });

    const [settings, setSettings] = useState<RoleClientSettingsValues>(
        initialSettings ?? defaultRoleClientSettings
    );

    useEffect(() => {
        if (settingsQuery.data) setSettings(settingsQuery.data);
    }, [settingsQuery.data]);

    function onSave() {
        startTransition(async () => {
            try {
                await saveRoleClientSettings(api, role.roleId, settings);
                await queryClient.invalidateQueries({ queryKey });
                toastUpdated(t);
            } catch (e) {
                toastUpdateError(t, e);
            }
        });
    }

    return (
        <RoleFormSection
            title={t("accessRoleClientSettings")}
            description={<RoleClientSettingsDescription />}
            footer={
                <SaveButton
                    loading={loading}
                    disabled={disabled || settingsQuery.isLoading}
                    onClick={onSave}
                />
            }
        >
            <SettingsFormCell span="full">
                <RoleClientSettingsFields
                    orgId={role.orgId}
                    initialGateways={initialGateways}
                    value={settings}
                    onChange={setSettings}
                    disabled={disabled || settingsQuery.isLoading}
                />
            </SettingsFormCell>
        </RoleFormSection>
    );
}
