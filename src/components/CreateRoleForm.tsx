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
import { useOrgContext } from "@app/hooks/useOrgContext";
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
import { tierMatrix } from "@server/lib/billing/tierMatrix";

type CreateRoleFormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    afterCreate?: (res: CreateRoleResponse) => void;
};

export default function CreateRoleForm({
    open,
    setOpen,
    afterCreate
}: CreateRoleFormProps) {
    const { org } = useOrgContext();
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
        if (isPaidUser(tierMatrix.advancedPrivateResources)) {
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
            .put<
                AxiosResponse<CreateRoleResponse>
            >(`/org/${org?.org.orgId}/role`, payload)
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
            toast({
                variant: "default",
                title: t("accessRoleCreated"),
                description: t("accessRoleCreatedDescription")
            });
            if (open) setOpen(false);
            afterCreate?.(res.data.data);
        }
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("accessRoleCreate")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("accessRoleCreateDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <RoleForm
                        variant="create"
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
                        {t("accessRoleCreateSubmit")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
