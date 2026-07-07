"use client";

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
import { Button } from "@app/components/ui/button";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type { Role } from "@server/db";
import type { UpdateRoleBody, UpdateRoleResponse } from "@server/routers/role";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import {
    parseSudoCommands,
    parseUnixGroups,
    RoleForm,
    type RoleFormValues
} from "./RoleForm";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

type EditRoleFormProps = {
    role: Role;
    open: boolean;
    setOpen: (open: boolean) => void;
    onSuccess?: (res: UpdateRoleResponse) => void;
};

export default function EditRoleForm({
    open,
    role,
    setOpen,
    onSuccess
}: EditRoleFormProps) {
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const api = createApiClient(useEnvContext());
    const [loading, startTransition] = useTransition();

    async function onSubmit(values: RoleFormValues) {
        const payload: UpdateRoleBody = {
            requireDeviceApproval: values.requireDeviceApproval,
            allowSsh: values.allowSsh
        };
        if (!role.isAdmin) {
            payload.name = values.name;
            payload.description = values.description || undefined;
        }
        if (isPaidUser(tierMatrix.advancedPrivateResources)) {
            payload.sshSudoMode = values.sshSudoMode;
            payload.sshCreateHomeDir = values.sshCreateHomeDir;
            payload.sshSudoCommands =
                values.sshSudoMode === "commands" &&
                values.sshSudoCommands?.trim()
                    ? parseSudoCommands(values.sshSudoCommands)
                    : [];
            if (values.sshUnixGroups !== undefined) {
                payload.sshUnixGroups = parseUnixGroups(values.sshUnixGroups);
            }
        }
        const res = await api
            .post<
                AxiosResponse<UpdateRoleResponse>
            >(`/role/${role.roleId}`, payload)
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("accessRoleErrorUpdate"),
                    description: formatAxiosError(
                        e,
                        t("accessRoleErrorUpdateDescription")
                    )
                });
            });

        if (res && res.status === 200) {
            toast({
                variant: "default",
                title: t("accessRoleUpdated"),
                description: t("accessRoleUpdatedDescription")
            });
            if (open) setOpen(false);
            onSuccess?.(res.data.data);
        }
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("accessRoleEdit")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("accessRoleEditDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <RoleForm
                        variant="edit"
                        role={role}
                        onSubmit={(values) =>
                            startTransition(() => onSubmit(values))
                        }
                    />
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="create-role-form"
                        loading={loading}
                        disabled={loading}
                    >
                        {t("accessRoleUpdateSubmit")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
