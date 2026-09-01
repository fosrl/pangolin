"use client";

import { Button } from "@app/components/ui/button";
import { Checkbox } from "@app/components/ui/checkbox";
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
import { Label } from "@app/components/ui/label";
import {
    RolesSelector,
    type SelectedRole
} from "@app/components/roles-selector";
import {
    UsersSelector,
    type SelectedUser
} from "@app/components/users-selector";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type { EmailIdentityKeysResponse } from "@server/routers/virtualApiKey/types";
import { AxiosResponse } from "axios";
import { useState } from "react";
import { useTranslations } from "next-intl";

type EmailIdentityKeysFormProps = {
    orgId: string;
    open: boolean;
    setOpen: (open: boolean) => void;
};

export default function EmailIdentityKeysForm({
    orgId,
    open,
    setOpen
}: EmailIdentityKeysFormProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [sendToAll, setSendToAll] = useState(false);
    const [selectedUsers, setSelectedUsers] = useState<SelectedUser[]>([]);
    const [selectedRoles, setSelectedRoles] = useState<SelectedRole[]>([]);
    const [loading, setLoading] = useState(false);

    function resetState() {
        setSendToAll(false);
        setSelectedUsers([]);
        setSelectedRoles([]);
        setLoading(false);
    }

    async function onSubmit() {
        if (
            !sendToAll &&
            selectedUsers.length === 0 &&
            selectedRoles.length === 0
        ) {
            toast({
                variant: "destructive",
                title: t("virtualApiKeysEmailIdentityRecipientsRequired"),
                description: t("virtualApiKeysEmailIdentityRecipientsRequired")
            });
            return;
        }

        setLoading(true);
        try {
            const res = await api.post<
                AxiosResponse<EmailIdentityKeysResponse>
            >(`/org/${orgId}/virtual-api-keys/email-identity-keys`, {
                sendToAll,
                userIds: sendToAll ? [] : selectedUsers.map((user) => user.id),
                roleIds: sendToAll
                    ? []
                    : selectedRoles.map((role) => Number(role.id))
            });

            const { sent, skipped } = res.data.data;
            toast({
                title: t("virtualApiKeysEmailIdentitySuccess"),
                description:
                    skipped > 0
                        ? `${t("virtualApiKeysEmailIdentitySuccessDescription", { sent })} ${t("virtualApiKeysEmailIdentitySkipped", { skipped })}`
                        : t("virtualApiKeysEmailIdentitySuccessDescription", {
                              sent
                          })
            });
            setOpen(false);
            resetState();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("virtualApiKeysEmailIdentityError"),
                description: formatAxiosError(
                    e,
                    t("virtualApiKeysEmailIdentityErrorDescription")
                )
            });
        }
        setLoading(false);
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(val) => {
                setOpen(val);
                if (!val) {
                    resetState();
                }
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("virtualApiKeysEmailIdentity")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t("virtualApiKeysEmailIdentityDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-4">
                        <div className="flex items-start space-x-2">
                            <Checkbox
                                id="email-identity-send-all"
                                checked={sendToAll}
                                onCheckedChange={(val) =>
                                    setSendToAll(val === true)
                                }
                                className="mt-0.5"
                            />
                            <div className="space-y-1">
                                <label
                                    htmlFor="email-identity-send-all"
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    {t("virtualApiKeysEmailIdentitySendAll")}
                                </label>
                                <p className="text-sm text-muted-foreground">
                                    {t(
                                        "virtualApiKeysEmailIdentitySendAllDescription"
                                    )}
                                </p>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>
                                {t("virtualApiKeysEmailIdentitySelectUsers")}
                            </Label>
                            <UsersSelector
                                orgId={orgId}
                                selectedUsers={selectedUsers}
                                onSelectUsers={setSelectedUsers}
                                disabled={sendToAll}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>
                                {t("virtualApiKeysEmailIdentitySelectRoles")}
                            </Label>
                            <RolesSelector
                                orgId={orgId}
                                selectedRoles={selectedRoles}
                                onSelectRoles={setSelectedRoles}
                                disabled={sendToAll}
                            />
                        </div>
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                    <Button
                        type="button"
                        onClick={onSubmit}
                        loading={loading}
                        disabled={loading}
                    >
                        {t("virtualApiKeysEmailIdentitySubmit")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
