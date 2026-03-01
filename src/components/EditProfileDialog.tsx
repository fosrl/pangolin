"use client";

import { useState, useEffect } from "react";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
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
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useUserContext } from "@app/hooks/useUserContext";
import { toast } from "@app/hooks/useToast";
import { useTranslations } from "next-intl";

type EditProfileDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
};

export default function EditProfileDialog({
    open,
    setOpen
}: EditProfileDialogProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { user, updateUser } = useUserContext();

    const [name, setName] = useState(user.name || "");
    const [username, setUsername] = useState(user.username || "");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setName(user.name || "");
            setUsername(user.username || "");
        }
    }, [open]);

    async function handleSave() {
        setLoading(true);
        try {
            const body: Record<string, string> = {};
            if (name.trim()) body.name = name.trim();
            if (username.trim()) body.username = username.trim();

            await api.patch("/user", body);
            updateUser({
                ...user,
                ...(body.name !== undefined && { name: body.name }),
                ...(body.username !== undefined && { username: body.username })
            });
            toast({
                title: t("profileUpdated"),
                description: t("profileUpdatedDescription")
            });
            setOpen(false);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: t("profileUpdateError"),
                description: formatAxiosError(
                    error,
                    t("profileUpdateError")
                )
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Credenza
            open={open}
            onOpenChange={setOpen}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("editProfile")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("editProfileDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="profile-name">
                                {t("profileName")}
                            </Label>
                            <Input
                                id="profile-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t("profileNamePlaceholder")}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="profile-username">
                                {t("profileUsername")}
                            </Label>
                            <Input
                                id="profile-username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder={t("profileUsernamePlaceholder")}
                            />
                        </div>
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("cancel")}</Button>
                    </CredenzaClose>
                    <Button
                        onClick={handleSave}
                        loading={loading}
                        disabled={loading || (!name.trim() && !username.trim())}
                    >
                        {t("save")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
