"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import IdpTypeBadge from "@app/components/IdpTypeBadge";
import OrgRolesTagField from "@app/components/OrgRolesTagField";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { Checkbox } from "@app/components/ui/checkbox";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel
} from "@app/components/ui/form";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { userOrgUserContext } from "@app/hooks/useOrgUserContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { useUserContext } from "@app/hooks/useUserContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { build } from "@server/build";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { UserType } from "@server/types/UserTypes";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export default function AccessControlsPage() {
    const { orgUser: user, updateOrgUser } = userOrgUserContext();
    const { user: sessionUser } = useUserContext();
    const { env } = useEnvContext();

    const api = createApiClient({ env });

    const { orgId } = useParams();

    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const isPaid = isPaidUser(tierMatrix.fullRbac);
    const supportsMultipleRolesPerUser = isPaid;
    const showMultiRolePaywallMessage =
        !env.flags.disableEnterpriseFeatures &&
        ((build === "saas" && !isPaid) ||
            (build === "enterprise" && !isPaid) ||
            (build === "oss" && !isPaid));

    const accessControlsFormSchema = z.object({
        username: z.string(),
        autoProvisioned: z.boolean(),
        roles: z
            .array(
                z.object({
                    id: z.string(),
                    text: z.string(),
                    isAdmin: z.boolean().optional()
                })
            )
            .min(1, { message: t("accessRoleSelectPlease") })
    });

    const form = useForm({
        resolver: zodResolver(accessControlsFormSchema),
        defaultValues: {
            username: user.username!,
            autoProvisioned: user.autoProvisioned || false,
            roles: (user.roles ?? []).map((r) => ({
                id: r.roleId.toString(),
                text: r.name,
                isAdmin: r.isAdmin === true
            }))
        }
    });

    const currentRoleIds = user.roleIds ?? [];

    useEffect(() => {
        form.setValue(
            "roles",
            (user.roles ?? []).map((r) => ({
                id: r.roleId.toString(),
                text: r.name,
                isAdmin: r.isAdmin === true
            }))
        );
        form.setValue("autoProvisioned", user.autoProvisioned || false);
    }, [user.userId, user.autoProvisioned, currentRoleIds.join(",")]);

    const paywallMessage =
        build === "saas"
            ? t("singleRolePerUserPlanNotice")
            : t("singleRolePerUserEditionNotice");

    const [isSaving, setIsSaving] = useState(false);
    const [confirmRemoveOwnAdminOpen, setConfirmRemoveOwnAdminOpen] =
        useState(false);

    async function executeSave() {
        const values = form.getValues();

        setIsSaving(true);
        try {
            const roleIds = values.roles.map((r) => parseInt(r.id, 10));
            const updateRoleRequest = supportsMultipleRolesPerUser
                ? api.post(`/user/${user.userId}/org/${orgId}/roles`, {
                      roleIds
                  })
                : api.post(`/role/${roleIds[0]}/add/${user.userId}`);

            await Promise.all([
                updateRoleRequest,
                api.post(`/org/${orgId}/user/${user.userId}`, {
                    autoProvisioned: values.autoProvisioned
                })
            ]);

            updateOrgUser({
                roleIds,
                roles: values.roles.map((r) => ({
                    roleId: parseInt(r.id, 10),
                    name: r.text,
                    isAdmin: r.isAdmin === true
                })),
                autoProvisioned: values.autoProvisioned
            });

            toast({
                variant: "default",
                title: t("userSaved"),
                description: t("userSavedDescription")
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("accessRoleErrorAdd"),
                description: formatAxiosError(
                    e,
                    t("accessRoleErrorAddDescription")
                )
            });
        } finally {
            setIsSaving(false);
        }
    }

    async function handleAccessControlsSubmit(e: React.FormEvent) {
        e.preventDefault();

        const isValid = await form.trigger();
        if (!isValid) return;

        const values = form.getValues();

        const willHaveAdminRole = values.roles.some((r) => r.isAdmin === true);

        const isRemovingOwnAdmin =
            sessionUser.userId === user.userId &&
            user.isAdmin &&
            !willHaveAdminRole;

        if (isRemovingOwnAdmin) {
            setConfirmRemoveOwnAdminOpen(true);
            return;
        }

        await executeSave();
    }

    return (
        <SettingsContainer>
            <ConfirmDeleteDialog
                open={confirmRemoveOwnAdminOpen}
                setOpen={setConfirmRemoveOwnAdminOpen}
                title={t("removeOwnAdminRoleConfirmTitle")}
                dialog={
                    <div className="space-y-2">
                        <p>{t("removeOwnAdminRoleConfirmDescription")}</p>
                    </div>
                }
                buttonText={t("removeOwnAdminRoleConfirmButton")}
                string={t("removeOwnAdminRoleConfirmPhrase")}
                onConfirm={executeSave}
            />

            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("accessControls")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("accessControlsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <Form {...form}>
                            <form
                                onSubmit={(e) =>
                                    void handleAccessControlsSubmit(e)
                                }
                                className="space-y-4"
                                id="access-controls-form"
                            >
                                {user.type !== UserType.Internal &&
                                    user.idpType && (
                                        <div className="flex items-center space-x-2 mb-4">
                                            <span className="text-sm font-medium text-muted-foreground">
                                                {t("idp")}:
                                            </span>
                                            <IdpTypeBadge
                                                type={user.idpType}
                                                variant={
                                                    user.idpVariant || undefined
                                                }
                                                name={user.idpName || undefined}
                                            />
                                        </div>
                                    )}

                                <OrgRolesTagField
                                    form={form}
                                    name="roles"
                                    orgId={orgId as string}
                                    supportsMultipleRolesPerUser={
                                        supportsMultipleRolesPerUser
                                    }
                                    showMultiRolePaywallMessage={
                                        showMultiRolePaywallMessage
                                    }
                                    paywallMessage={paywallMessage}
                                />

                                {user.idpAutoProvision && (
                                    <FormField
                                        control={form.control}
                                        name="autoProvisioned"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={
                                                            field.onChange
                                                        }
                                                    />
                                                </FormControl>
                                                <div className="space-y-1 leading-none">
                                                    <FormLabel>
                                                        {t("autoProvisioned")}
                                                    </FormLabel>
                                                    <p className="text-sm text-muted-foreground">
                                                        {t(
                                                            "autoProvisionedDescription"
                                                        )}
                                                    </p>
                                                </div>
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="submit"
                        loading={isSaving}
                        disabled={isSaving}
                        form="access-controls-form"
                    >
                        {t("accessControlsSubmit")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
