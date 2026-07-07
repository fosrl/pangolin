"use client";

import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionFooter,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    RolesSelector,
    type SelectedRole
} from "@app/components/roles-selector";
import { UsersSelector } from "@app/components/users-selector";
import { Button } from "@app/components/ui/button";
import { Form, FormField } from "@app/components/ui/form";
import { toast } from "@app/hooks/useToast";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { resourceQueries } from "@app/lib/queries";
import ResourceContext from "@app/contexts/resourceContext";
import { useResourcePolicyContext } from "@app/providers/ResourcePolicyProvider";
import { zodResolver } from "@hookform/resolvers/zod";
import type { GetResourcePolicyResponse } from "@server/routers/policy";
import { UserType } from "@server/types/UserTypes";
import { useQuery } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
    useActionState,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { createPolicySchema } from ".";
import {
    EmailCredenza,
    HeaderAuthCredenza,
    PasscodeCredenza,
    PincodeCredenza
} from "./PolicyAuthMethodCredenzas";
import { PolicyAuthOtherMethodsSection } from "./PolicyAuthOtherMethodsSection";
import { PolicyAuthSsoSection } from "./PolicyAuthSsoSection";
import type { PolicyAuthMethodId } from "./policy-auth-method-id";
import { SharedPolicyResourceNotice } from "./SharedPolicyResourceNotice";
import z from "zod";

type OverlaySelectedRole = SelectedRole & { isAdmin: boolean };

// Edit mode keeps placeholder values for configured methods; only validate on save when changed.
const authStackEditSchema = createPolicySchema
    .pick({
        sso: true,
        skipToIdpId: true,
        roles: true,
        users: true,
        emailWhitelistEnabled: true,
        emails: true
    })
    .extend({
        password: z
            .object({
                password: z.string()
            })
            .nullable()
            .optional(),
        pincode: z
            .object({
                pincode: z.string()
            })
            .nullable()
            .optional(),
        headerAuth: z
            .object({
                user: z.string(),
                password: z.string(),
                extendedCompatibility: z.boolean().default(true)
            })
            .nullable()
            .optional()
    });

export type PolicyAuthStackSectionEditProps = {
    orgId: string;
    allIdps: { id: number; text: string }[];
    emailEnabled: boolean;
    readonly?: boolean;
    resourceId?: number;
};

export function PolicyAuthStackSectionEdit({
    orgId,
    allIdps,
    emailEnabled,
    readonly,
    resourceId
}: PolicyAuthStackSectionEditProps) {
    const t = useTranslations();
    const router = useRouter();
    const { policy, updatePolicy } = useResourcePolicyContext();
    const resourceContext = useContext(ResourceContext);
    const api = createApiClient(useEnvContext());

    const isResourceOverlay = resourceId !== undefined;
    const authReadonly = readonly || isResourceOverlay;

    const policyRoleItems = useMemo<OverlaySelectedRole[]>(
        () =>
            policy.roles.map((r) => ({
                id: r.roleId.toString(),
                text: r.name,
                isAdmin: false
            })),
        [policy.roles]
    );
    const policyUserItems = useMemo(
        () =>
            policy.users.map((u) => ({
                id: u.userId,
                text: `${getUserDisplayName({ email: u.email, username: u.username })}${u.type !== UserType.Internal ? ` (${u.idpName})` : ""}`
            })),
        [policy.users]
    );

    const policyRoleLockedIds = useMemo(
        () => new Set(policy.roles.map((r) => r.roleId.toString())),
        [policy.roles]
    );
    const policyUserLockedIds = useMemo(
        () => new Set(policy.users.map((u) => u.userId)),
        [policy.users]
    );

    const { data: resourceRolesData } = useQuery({
        ...resourceQueries.resourceRoles({ resourceId: resourceId! }),
        enabled: isResourceOverlay
    });
    const { data: resourceUsersData } = useQuery({
        ...resourceQueries.resourceUsers({ resourceId: resourceId! }),
        enabled: isResourceOverlay
    });

    const [combinedRoles, setCombinedRoles] =
        useState<OverlaySelectedRole[]>(policyRoleItems);
    const [combinedUsers, setCombinedUsers] = useState(policyUserItems);
    const [resourceRolesInitialized, setResourceRolesInitialized] =
        useState(false);
    const [resourceUsersInitialized, setResourceUsersInitialized] =
        useState(false);
    const initialResourceRoleIdsRef = useRef<Set<string>>(new Set());
    const initialResourceUserIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!isResourceOverlay || resourceRolesInitialized) return;
        if (!resourceRolesData) return;
        const resourceSpecific = resourceRolesData
            .filter((r) => !policyRoleLockedIds.has(r.roleId.toString()))
            .map((r) => ({
                id: r.roleId.toString(),
                text: r.name,
                isAdmin: Boolean(r.isAdmin)
            }));
        initialResourceRoleIdsRef.current = new Set(
            resourceSpecific.map((r) => r.id)
        );
        setCombinedRoles(
            [...policyRoleItems, ...resourceSpecific].filter(
                (role) => !role.isAdmin
            )
        );
        setResourceRolesInitialized(true);
    }, [
        isResourceOverlay,
        resourceRolesData,
        resourceRolesInitialized,
        policyRoleItems,
        policyRoleLockedIds
    ]);

    useEffect(() => {
        if (!isResourceOverlay || resourceUsersInitialized) return;
        if (!resourceUsersData) return;
        const resourceSpecific = resourceUsersData
            .filter((u) => !policyUserLockedIds.has(u.userId))
            .map((u) => ({
                id: u.userId,
                text: `${getUserDisplayName({ email: u.email ?? undefined, username: u.username ?? undefined })}${u.type !== UserType.Internal ? ` (${u.idpName})` : ""}`
            }));
        initialResourceUserIdsRef.current = new Set(
            resourceSpecific.map((u) => u.id)
        );
        setCombinedUsers([...policyUserItems, ...resourceSpecific]);
        setResourceUsersInitialized(true);
    }, [
        isResourceOverlay,
        resourceUsersData,
        resourceUsersInitialized,
        policyUserItems,
        policyUserLockedIds
    ]);

    const form = useForm({
        resolver: zodResolver(authStackEditSchema),
        defaultValues: {
            sso: policy.sso,
            skipToIdpId: policy.idpId,
            roles: policyRoleItems,
            users: policyUserItems,
            password: null,
            pincode: null,
            headerAuth: policy.headerAuth?.id
                ? {
                      user: "",
                      password: "",
                      extendedCompatibility:
                          policy.headerAuth.extendedCompability ?? true
                  }
                : null,
            emailWhitelistEnabled: policy.emailWhitelistEnabled,
            emails: policy.emailWhiteList.map((email) => ({
                id: email.whiteListId.toString(),
                text: email.email
            }))
        }
    });

    const [passcodeActive, setPasscodeActive] = useState(
        Boolean(policy.passwordId)
    );
    const [pinActive, setPinActive] = useState(Boolean(policy.pincodeId));
    const [headerAuthActive, setHeaderAuthActive] = useState(
        Boolean(policy.headerAuth?.id)
    );

    const passcodeOnServerRef = useRef(Boolean(policy.passwordId));
    const pincodeOnServerRef = useRef(Boolean(policy.pincodeId));
    const headerAuthOnServerRef = useRef(Boolean(policy.headerAuth?.id));
    const [editingMethod, setEditingMethod] =
        useState<PolicyAuthMethodId | null>(null);

    const sso = useWatch({ control: form.control, name: "sso" });
    const skipToIdpId = useWatch({
        control: form.control,
        name: "skipToIdpId"
    });
    const roles = useWatch({ control: form.control, name: "roles" }) ?? [];
    const users = useWatch({ control: form.control, name: "users" }) ?? [];
    const password = useWatch({ control: form.control, name: "password" });
    const pincode = useWatch({ control: form.control, name: "pincode" });
    const headerAuth = useWatch({ control: form.control, name: "headerAuth" });
    const emailWhitelistEnabled = useWatch({
        control: form.control,
        name: "emailWhitelistEnabled"
    });
    const emails = useWatch({ control: form.control, name: "emails" }) ?? [];

    const overlayRoles = combinedRoles.filter((r) => !r.isAdmin);
    const overlayUsers = combinedUsers;

    const [, formAction, isSubmitting] = useActionState(onSubmit, null);
    const [isSavingOverlay, setIsSavingOverlay] = useState(false);

    async function onSubmit() {
        if (readonly && !isResourceOverlay) return;

        if (isResourceOverlay) {
            await saveResourceOverlay();
            return;
        }

        const isValid = await form.trigger();
        if (!isValid) {
            toast({
                variant: "destructive",
                title: t("policyErrorUpdate"),
                description: t("policyErrorUpdateMessageDescription")
            });
            return;
        }

        const payload = form.getValues();
        const requests: Array<Promise<AxiosResponse<{}> | void>> = [];
        const policyUpdates: Parameters<typeof updatePolicy>[0] = {};

        requests.push(
            api
                .put(
                    `/resource-policy/${policy.resourcePolicyId}/access-control`,
                    {
                        sso: payload.sso,
                        userIds: payload.users.map((user) => user.id),
                        roleIds: payload.roles.map((role) => Number(role.id)),
                        skipToIdpId: payload.skipToIdpId
                    }
                )
                .catch(handleError)
        );

        if (passcodeActive && payload.password?.password) {
            requests.push(
                api
                    .put(
                        `/resource-policy/${policy.resourcePolicyId}/password`,
                        { password: payload.password.password }
                    )
                    .catch(handleError)
            );
            policyUpdates.passwordId = policy.passwordId ?? -1;
        } else if (!passcodeActive && passcodeOnServerRef.current) {
            requests.push(
                api
                    .put(
                        `/resource-policy/${policy.resourcePolicyId}/password`,
                        { password: null }
                    )
                    .catch(handleError)
            );
            policyUpdates.passwordId = null;
        }

        if (pinActive && payload.pincode?.pincode?.length === 6) {
            requests.push(
                api
                    .put(
                        `/resource-policy/${policy.resourcePolicyId}/pincode`,
                        { pincode: payload.pincode.pincode }
                    )
                    .catch(handleError)
            );
            policyUpdates.pincodeId = policy.pincodeId ?? -1;
        } else if (!pinActive && pincodeOnServerRef.current) {
            requests.push(
                api
                    .put(
                        `/resource-policy/${policy.resourcePolicyId}/pincode`,
                        { pincode: null }
                    )
                    .catch(handleError)
            );
            policyUpdates.pincodeId = null;
        }

        if (
            headerAuthActive &&
            payload.headerAuth?.user &&
            payload.headerAuth?.password
        ) {
            requests.push(
                api
                    .put(
                        `/resource-policy/${policy.resourcePolicyId}/header-auth`,
                        { headerAuth: payload.headerAuth }
                    )
                    .catch(handleError)
            );
            policyUpdates.headerAuth = {
                id: policy.headerAuth?.id ?? -1,
                extendedCompability:
                    payload.headerAuth.extendedCompatibility ?? true
            };
        } else if (!headerAuthActive && headerAuthOnServerRef.current) {
            requests.push(
                api
                    .put(
                        `/resource-policy/${policy.resourcePolicyId}/header-auth`,
                        { headerAuth: null }
                    )
                    .catch(handleError)
            );
            policyUpdates.headerAuth = {
                id: null,
                extendedCompability: null
            } as unknown as GetResourcePolicyResponse["headerAuth"];
        }

        requests.push(
            api
                .put(`/resource-policy/${policy.resourcePolicyId}/whitelist`, {
                    emailWhitelistEnabled: payload.emailWhitelistEnabled,
                    emails: payload.emails?.map((e) => e.text) ?? []
                })
                .catch(handleError)
        );
        policyUpdates.emailWhitelistEnabled = payload.emailWhitelistEnabled;

        try {
            const results = await Promise.all(requests);
            if (results.every((res) => res && res.status === 200)) {
                if (policyUpdates.passwordId !== undefined) {
                    passcodeOnServerRef.current = Boolean(
                        policyUpdates.passwordId
                    );
                }
                if (policyUpdates.pincodeId !== undefined) {
                    pincodeOnServerRef.current = Boolean(
                        policyUpdates.pincodeId
                    );
                }
                if (policyUpdates.headerAuth !== undefined) {
                    headerAuthOnServerRef.current = Boolean(
                        policyUpdates.headerAuth?.id
                    );
                }

                updatePolicy(policyUpdates);

                resourceContext?.updateAuthInfo({
                    sso: payload.sso,
                    whitelist: payload.emailWhitelistEnabled,
                    password: passcodeOnServerRef.current,
                    pincode: pincodeOnServerRef.current,
                    headerAuth: headerAuthOnServerRef.current
                });

                toast({
                    title: t("success"),
                    description: t("policyUpdatedSuccess")
                });
                router.refresh();
            }
        } catch {
            toast({
                variant: "destructive",
                title: t("policyErrorUpdate"),
                description: t("policyErrorUpdateMessageDescription")
            });
        }
    }

    function handleError(e: unknown) {
        toast({
            variant: "destructive",
            title: t("policyErrorUpdate"),
            description: formatAxiosError(e, t("policyErrorUpdateDescription"))
        });
    }

    async function saveResourceOverlay() {
        setIsSavingOverlay(true);
        try {
            const currentResourceRoleIds = combinedRoles
                .filter((r) => !policyRoleLockedIds.has(r.id))
                .map((r) => Number(r.id));
            const currentResourceUserIds = combinedUsers
                .filter((u) => !policyUserLockedIds.has(u.id))
                .map((u) => u.id);

            await Promise.all([
                api.post(`/resource/${resourceId}/roles`, {
                    roleIds: currentResourceRoleIds
                }),
                api.post(`/resource/${resourceId}/users`, {
                    userIds: currentResourceUserIds
                })
            ]);

            toast({
                title: t("success"),
                description: t("policyUpdatedSuccess")
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("policyErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("policyErrorUpdateDescription")
                )
            });
        } finally {
            setIsSavingOverlay(false);
        }
    }

    const isLoading =
        isResourceOverlay &&
        (!resourceRolesInitialized || !resourceUsersInitialized);

    const closeCredenza = () => setEditingMethod(null);

    const openMethodEditor = (method: PolicyAuthMethodId) => {
        setEditingMethod(method);
    };

    const handleToggle = (
        method: PolicyAuthMethodId,
        active: boolean,
        onDisable: () => void,
        onEnable?: () => void
    ) => {
        if (active) {
            onEnable?.();
            openMethodEditor(method);
            return;
        }
        onDisable();
        setEditingMethod((current) => (current === method ? null : current));
    };

    return (
        <Form {...form}>
            <form action={formAction}>
                <SettingsSection>
                    <SettingsSectionHeader>
                        <SettingsSectionTitle>
                            {t("policyAuthStackTitle")}
                        </SettingsSectionTitle>
                        <SettingsSectionDescription>
                            {t("policyAuthStackDescription")}
                        </SettingsSectionDescription>
                    </SettingsSectionHeader>
                    <SettingsSectionBody>
                        {isResourceOverlay && (
                            <SharedPolicyResourceNotice section="authentication" />
                        )}
                        <SettingsSectionForm variant="half">
                            <PolicyAuthSsoSection
                                sso={Boolean(sso)}
                                onSsoChange={(active) =>
                                    form.setValue("sso", active)
                                }
                                skipToIdpId={skipToIdpId}
                                onSkipToIdpChange={(id) =>
                                    form.setValue("skipToIdpId", id)
                                }
                                allIdps={allIdps}
                                disabled={authReadonly}
                                idpDisabled={authReadonly}
                                rolesEditor={
                                    isResourceOverlay ? (
                                        <RolesSelector
                                            orgId={orgId}
                                            selectedRoles={overlayRoles}
                                            onSelectRoles={(selected) =>
                                                setCombinedRoles(
                                                    selected.map((role) => ({
                                                        ...role,
                                                        isAdmin: Boolean(
                                                            role.isAdmin
                                                        )
                                                    }))
                                                )
                                            }
                                            disabled={isLoading}
                                            restrictAdminRole
                                            lockedIds={policyRoleLockedIds}
                                        />
                                    ) : (
                                        <FormField
                                            control={form.control}
                                            name="roles"
                                            render={({ field }) => (
                                                <RolesSelector
                                                    orgId={orgId}
                                                    selectedRoles={field.value}
                                                    onSelectRoles={(selected) =>
                                                        form.setValue(
                                                            "roles",
                                                            selected
                                                        )
                                                    }
                                                    disabled={readonly}
                                                    restrictAdminRole
                                                />
                                            )}
                                        />
                                    )
                                }
                                usersEditor={
                                    isResourceOverlay ? (
                                        <UsersSelector
                                            orgId={orgId}
                                            selectedUsers={overlayUsers}
                                            onSelectUsers={setCombinedUsers}
                                            disabled={isLoading}
                                            lockedIds={policyUserLockedIds}
                                        />
                                    ) : (
                                        <FormField
                                            control={form.control}
                                            name="users"
                                            render={({ field }) => (
                                                <UsersSelector
                                                    orgId={orgId}
                                                    selectedUsers={field.value}
                                                    onSelectUsers={(selected) =>
                                                        form.setValue(
                                                            "users",
                                                            selected
                                                        )
                                                    }
                                                    disabled={readonly}
                                                />
                                            )}
                                        />
                                    )
                                }
                            />

                            <PolicyAuthOtherMethodsSection
                                pinActive={pinActive}
                                passcodeActive={passcodeActive}
                                emailWhitelistEnabled={Boolean(
                                    emailWhitelistEnabled
                                )}
                                headerAuthActive={headerAuthActive}
                                headerAuthUser={headerAuth?.user ?? ""}
                                emailCount={emails.length}
                                emailEnabled={emailEnabled}
                                disabled={authReadonly}
                                onConfigure={openMethodEditor}
                                onTogglePincode={(active) =>
                                    handleToggle("pincode", active, () => {
                                        setPinActive(false);
                                        form.setValue("pincode", null);
                                    })
                                }
                                onTogglePasscode={(active) =>
                                    handleToggle("passcode", active, () => {
                                        setPasscodeActive(false);
                                        form.setValue("password", null);
                                    })
                                }
                                onToggleEmail={(active) =>
                                    handleToggle("email", active, () =>
                                        form.setValue(
                                            "emailWhitelistEnabled",
                                            false
                                        )
                                    )
                                }
                                onToggleHeaderAuth={(active) =>
                                    handleToggle("headerAuth", active, () => {
                                        setHeaderAuthActive(false);
                                        form.setValue("headerAuth", null);
                                    })
                                }
                            />
                        </SettingsSectionForm>

                        <PincodeCredenza
                            open={editingMethod === "pincode"}
                            onOpenChange={(open) => !open && closeCredenza()}
                            defaultPincode={pincode?.pincode ?? ""}
                            onSave={(value) => {
                                form.setValue("pincode", { pincode: value });
                                setPinActive(true);
                            }}
                        />

                        <PasscodeCredenza
                            open={editingMethod === "passcode"}
                            onOpenChange={(open) => !open && closeCredenza()}
                            defaultPassword={password?.password ?? ""}
                            existingConfigured={Boolean(policy.passwordId)}
                            onSave={(value) => {
                                form.setValue("password", { password: value });
                                setPasscodeActive(true);
                            }}
                        />

                        <EmailCredenza
                            open={editingMethod === "email"}
                            onOpenChange={(open) => !open && closeCredenza()}
                            emailEnabled={emailEnabled}
                            disabled={authReadonly}
                            emails={emails}
                            onSave={(value) => {
                                form.setValue("emails", value);
                                form.setValue("emailWhitelistEnabled", true);
                            }}
                        />

                        <HeaderAuthCredenza
                            open={editingMethod === "headerAuth"}
                            onOpenChange={(open) => !open && closeCredenza()}
                            defaultValues={
                                headerAuth
                                    ? {
                                          user: headerAuth.user,
                                          password: headerAuth.password,
                                          extendedCompatibility:
                                              headerAuth.extendedCompatibility ??
                                              true
                                      }
                                    : undefined
                            }
                            existingConfigured={Boolean(policy.headerAuth?.id)}
                            onSave={(value) => {
                                form.setValue("headerAuth", value);
                                setHeaderAuthActive(true);
                            }}
                        />
                    </SettingsSectionBody>
                    <SettingsSectionFooter>
                        <Button
                            type="submit"
                            loading={isSubmitting || isSavingOverlay}
                            disabled={
                                (readonly && !isResourceOverlay) ||
                                isSubmitting ||
                                isSavingOverlay ||
                                isLoading
                            }
                        >
                            {t("authMethodsSave")}
                        </Button>
                    </SettingsSectionFooter>
                </SettingsSection>
            </form>
        </Form>
    );
}
