"use client";

import { Button } from "@app/components/ui/button";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type { CreateRoleBody, CreateRoleResponse } from "@server/routers/role";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import {
    parseSudoCommands,
    parseUnixGroups,
    RoleForm,
    type RoleFormValues
} from "./RoleForm";
import { saveRoleClientSettings } from "./RoleClientSettingsFields";
import SettingsSectionTitle from "./SettingsSectionTitle";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionFooter
} from "./Settings";
import { useRouter } from "next/navigation";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

type CreateRoleFormProps = {
    orgId: string;
};

export default function CreateRoleForm({ orgId }: CreateRoleFormProps) {
    const router = useRouter();
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const api = createApiClient(useEnvContext());
    const [loading, startTransition] = useTransition();

    async function onSubmit(values: RoleFormValues) {
        const payload: CreateRoleBody = {
            name: values.name,
            description: values.description || undefined,
            requireDeviceApproval: values.requireDeviceApproval,
            allowSsh: values.allowSsh
        };
        if (isPaidUser(tierMatrix.roleBasedSSHControls)) {
            payload.sshSudoMode = values.sshSudoMode;
            payload.sshCreateHomeDir = values.sshCreateHomeDir;
            payload.sshSudoCommands =
                values.sshSudoMode === "commands" &&
                values.sshSudoCommands?.trim()
                    ? parseSudoCommands(values.sshSudoCommands)
                    : [];
            if (values.sshUnixGroups?.trim()) {
                payload.sshUnixGroups = parseUnixGroups(values.sshUnixGroups);
            }
        }
        const res = await api
            .put<AxiosResponse<CreateRoleResponse>>(
                `/org/${orgId}/role`,
                payload
            )
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("accessRoleErrorCreate"),
                    description: formatAxiosError(
                        e,
                        t("accessRoleErrorCreateDescription")
                    )
                });
            });

        if (res && res.status === 201) {
            const createdRole = res.data.data;

            const pendingBudgets = (values.budgets ?? []).filter(
                (budget) => budget.amount.trim() !== ""
            );
            if (pendingBudgets.length > 0) {
                try {
                    await Promise.all(
                        pendingBudgets.map((budget) =>
                            api.put(`/org/${orgId}/ai-budget`, {
                                roleId: createdRole.roleId,
                                amount: Number(budget.amount),
                                unit: budget.unit,
                                period: budget.period
                            })
                        )
                    );
                } catch (e) {
                    toast({
                        variant: "destructive",
                        title: t("aiBudgetErrorSave"),
                        description: formatAxiosError(e, t("aiBudgetErrorSave"))
                    });
                }
            }

            if (values.clientSettings?.enabled) {
                try {
                    await saveRoleClientSettings(
                        api,
                        createdRole.roleId,
                        values.clientSettings
                    );
                } catch (e) {
                    toast({
                        variant: "destructive",
                        title: t("accessRoleErrorUpdate"),
                        description: formatAxiosError(
                            e,
                            t("accessRoleErrorUpdateDescription")
                        )
                    });
                }
            }

            toast({
                variant: "default",
                title: t("accessRoleCreated"),
                description: t("accessRoleCreatedDescription")
            });
            router.push(
                `/${orgId}/settings/access/roles/${createdRole.roleId}`
            );
        }
    }

    return (
        <>
            <div className="flex justify-between">
                <SettingsSectionTitle
                    title={t("accessRoleCreate")}
                    description={t("accessRoleCreateDescription")}
                />
                <Button
                    variant="outline"
                    onClick={() =>
                        router.push(`/${orgId}/settings/access/roles`)
                    }
                >
                    {t("cancel")}
                </Button>
            </div>
            <SettingsContainer>
                <SettingsSection>
                    <SettingsSectionBody>
                        <RoleForm
                            variant="create"
                            orgId={orgId}
                            onSubmit={(values) =>
                                startTransition(() => onSubmit(values))
                            }
                        />
                    </SettingsSectionBody>
                    <SettingsSectionFooter>
                        <Button
                            type="submit"
                            form="create-role-form"
                            loading={loading}
                            disabled={loading}
                        >
                            {t("accessRoleCreateSubmit")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>
            </SettingsContainer>
        </>
    );
}
