"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { StrategyOption, StrategySelect } from "@app/components/StrategySelect";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { Button } from "@app/components/ui/button";
import { useParams, useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { toast } from "@app/hooks/useToast";
import { zodResolver } from "@hookform/resolvers/zod";
import { InviteUserResponse } from "@server/routers/user";
import { AxiosResponse } from "axios";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import CopyTextBox from "@app/components/CopyTextBox";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { ListRolesResponse } from "@server/routers/role";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { Checkbox } from "@app/components/ui/checkbox";
import { ListIdpsResponse } from "@server/routers/idp";
import { useTranslations } from "next-intl";
import { build } from "@server/build";
import IdpTypeIcon from "@app/components/IdpTypeIcon";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import OrgRolesTagField from "@app/components/OrgRolesTagField";
import CopyToClipboard from "@app/components/CopyToClipboard";

type UserType = "internal" | "oidc";

interface IdpOption {
    idpId: number;
    name: string;
    type: string;
    variant: string | null;
}

interface UserOption {
    id: string;
    title: string;
    description: string;
    disabled: boolean;
    icon?: React.ReactNode;
    idpId?: number;
    variant?: string | null;
}

export default function Page() {
    const { orgId } = useParams();
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const t = useTranslations();

    const { hasSaasSubscription, isPaidUser } = usePaidStatus();
    const isPaid = isPaidUser(tierMatrix.fullRbac);
    const supportsMultipleRolesPerUser = isPaid;
    const showMultiRolePaywallMessage =
        !env.flags.disableEnterpriseFeatures &&
        ((build === "saas" && !isPaid) ||
            (build === "enterprise" && !isPaid) ||
            (build === "oss" && !isPaid));

    const [selectedOption, setSelectedOption] = useState<string | null>(
        "internal"
    );
    const [inviteLink, setInviteLink] = useState<string | null>(null);

    const [expiresInDays, setExpiresInDays] = useState(1);
    const [roles, setRoles] = useState<{ roleId: number; name: string }[]>([]);
    const [idps, setIdps] = useState<IdpOption[]>([]);
    const [sendEmail, setSendEmail] = useState(env.email.emailEnabled);
    const [userOptions, setUserOptions] = useState<UserOption[]>([]);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [activeInviteRoleTagIndex, setActiveInviteRoleTagIndex] = useState<
        number | null
    >(null);
    const [activeOidcRoleTagIndex, setActiveOidcRoleTagIndex] = useState<
        number | null
    >(null);

    const roleTagsFieldSchema = z
        .array(
            z.object({
                id: z.string(),
                text: z.string()
            })
        )
        .min(1, { message: t("accessRoleSelectPlease") });

    const internalFormSchema = z.object({
        email: z.email({ message: t("emailInvalid") }),
        validForHours: z
            .string()
            .min(1, { message: t("inviteValidityDuration") }),
        roles: roleTagsFieldSchema
    });

    const googleAzureFormSchema = z.object({
        email: z.email({ message: t("emailInvalid") }),
        name: z.string().optional(),
        roles: roleTagsFieldSchema
    });

    const genericOidcFormSchema = z.object({
        username: z.string().min(1, { message: t("usernameRequired") }),
        email: z
            .email({ message: t("emailInvalid") })
            .optional()
            .or(z.literal("")),
        name: z.string().optional(),
        roles: roleTagsFieldSchema
    });

    const formatIdpType = (type: string) => {
        switch (type.toLowerCase()) {
            case "oidc":
                return t("idpGenericOidc");
            case "google":
                return t("idpGoogleDescription");
            case "azure":
                return t("idpAzureDescription");
            default:
                return type;
        }
    };

    const getIdpIcon = (variant: string | null) => {
        if (!variant) return null;
        const type = variant.toLowerCase();
        return <IdpTypeIcon type={type} size={24} />;
    };

    const validFor = [
        { hours: 24, name: t("day", { count: 1 }) },
        { hours: 48, name: t("day", { count: 2 }) },
        { hours: 72, name: t("day", { count: 3 }) },
        { hours: 96, name: t("day", { count: 4 }) },
        { hours: 120, name: t("day", { count: 5 }) },
        { hours: 144, name: t("day", { count: 6 }) },
        { hours: 168, name: t("day", { count: 7 }) }
    ];

    const allRoleOptions = roles.map((role) => ({
        id: role.roleId.toString(),
        text: role.name
    }));

    const invitePaywallMessage =
        build === "saas"
            ? t("singleRolePerUserPlanNotice")
            : t("singleRolePerUserEditionNotice");

    const internalForm = useForm({
        resolver: zodResolver(internalFormSchema),
        defaultValues: {
            email: "",
            validForHours: "72",
            roles: [] as { id: string; text: string }[]
        }
    });

    const googleAzureForm = useForm({
        resolver: zodResolver(googleAzureFormSchema),
        defaultValues: {
            email: "",
            name: "",
            roles: [] as { id: string; text: string }[]
        }
    });

    const genericOidcForm = useForm({
        resolver: zodResolver(genericOidcFormSchema),
        defaultValues: {
            username: "",
            email: "",
            name: "",
            roles: [] as { id: string; text: string }[]
        }
    });

    const prevSelectedOptionRef = useRef(selectedOption);

    useEffect(() => {
        if (!selectedOption) {
            return;
        }

        async function fetchRoles() {
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
                });

            if (res?.status === 200) {
                setRoles(res.data.data.roles);
            }
        }

        async function fetchIdps() {
            if (build === "saas" && !hasSaasSubscription(tierMatrix.orgOidc)) {
                return;
            }

            const res = await api
                .get<
                    AxiosResponse<ListIdpsResponse>
                >(build === "saas" ? `/org/${orgId}/idp` : "/idp")
                .catch((e) => {
                    console.error(e);
                    toast({
                        variant: "destructive",
                        title: t("idpErrorFetch"),
                        description: formatAxiosError(
                            e,
                            t("idpErrorFetchDescription")
                        )
                    });
                });

            if (res?.status === 200) {
                setIdps(res.data.data.idps);
            }
        }

        async function fetchInitialData() {
            setDataLoaded(false);
            await fetchRoles();
            await fetchIdps();
            setDataLoaded(true);
        }

        fetchInitialData();
    }, []);

    // Build user options when IDPs are loaded
    useEffect(() => {
        const options: UserOption[] = [
            {
                id: "internal",
                title: t("userTypeInternal"),
                description: t("userTypeInternalDescription"),
                disabled: false
            }
        ];

        // Add IDP options
        idps.forEach((idp) => {
            options.push({
                id: `idp-${idp.idpId}`,
                title: idp.name,
                description: formatIdpType(idp.variant || idp.type),
                disabled: false,
                icon: getIdpIcon(idp.variant),
                idpId: idp.idpId,
                variant: idp.variant
            });
        });

        setUserOptions(options);
    }, [idps, t]);

    const [, submitInternalAction, isSubmittingInternal] = useActionState(
        onSubmitInternal,
        null
    );
    const [isSubmittingExternal, setIsSubmittingExternal] = useState(false);

    const loading =
        isSubmittingInternal || isSubmittingExternal;

    async function onSubmitInternal() {
        const isValid = await internalForm.trigger();
        if (!isValid) return;

        const values = internalForm.getValues();

        const roleIds = values.roles.map((r) => parseInt(r.id, 10));

        const res = await api
            .post<AxiosResponse<InviteUserResponse>>(
                `/org/${orgId}/create-invite`,
                {
                    email: values.email,
                    roleIds,
                    validHours: parseInt(values.validForHours),
                    sendEmail
                }
            )
            .catch((e) => {
                if (e.response?.status === 409) {
                    toast({
                        variant: "destructive",
                        title: t("userErrorExists"),
                        description: t("userErrorExistsDescription")
                    });
                } else {
                    toast({
                        variant: "destructive",
                        title: t("inviteError"),
                        description: formatAxiosError(
                            e,
                            t("inviteErrorDescription")
                        )
                    });
                }
            });

        if (res && res.status === 200) {
            setInviteLink(res.data.data.inviteLink);
            toast({
                variant: "default",
                title: t("userInvited"),
                description: t("userInvitedDescription")
            });

            setExpiresInDays(parseInt(values.validForHours) / 24);
        }
    }

    async function onSubmitGoogleAzure(
        values: z.infer<typeof googleAzureFormSchema>
    ) {
        const selectedUserOption = userOptions.find(
            (opt) => opt.id === selectedOption
        );
        if (!selectedUserOption?.idpId) return;

        setIsSubmittingExternal(true);

        const roleIds = values.roles.map((r) => parseInt(r.id, 10));

        const res = await api
            .put(`/org/${orgId}/user`, {
                username: values.email,
                email: values.email || undefined,
                name: values.name,
                type: "oidc",
                idpId: selectedUserOption.idpId,
                roleIds
            })
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("userErrorCreate"),
                    description: formatAxiosError(
                        e,
                        t("userErrorCreateDescription")
                    )
                });
            });

        if (res && res.status === 201) {
            toast({
                variant: "default",
                title: t("userCreated"),
                description: t("userCreatedDescription")
            });
            router.push(`/${orgId}/settings/access/users`);
        }

        setIsSubmittingExternal(false);
    }

    async function onSubmitGenericOidc(
        values: z.infer<typeof genericOidcFormSchema>
    ) {
        const selectedUserOption = userOptions.find(
            (opt) => opt.id === selectedOption
        );
        if (!selectedUserOption?.idpId) return;

        setIsSubmittingExternal(true);

        const roleIds = values.roles.map((r) => parseInt(r.id, 10));

        const res = await api
            .put(`/org/${orgId}/user`, {
                username: values.username,
                email: values.email || undefined,
                name: values.name,
                type: "oidc",
                idpId: selectedUserOption.idpId,
                roleIds
            })
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("userErrorCreate"),
                    description: formatAxiosError(
                        e,
                        t("userErrorCreateDescription")
                    )
                });
            });

        if (res && res.status === 201) {
            toast({
                variant: "default",
                title: t("userCreated"),
                description: t("userCreatedDescription")
            });
            router.push(`/${orgId}/settings/access/users`);
        }

        setIsSubmittingExternal(false);
    }

    function handleUserTypeChange(value: string) {
        if (prevSelectedOptionRef.current === value) {
            return;
        }

        prevSelectedOptionRef.current = value;
        setSelectedOption(value);

        if (value === "internal") {
            setSendEmail(env.email.emailEnabled);
            internalForm.reset();
            setInviteLink(null);
            setExpiresInDays(1);
        } else {
            googleAzureForm.reset();
            genericOidcForm.reset();
        }
    }

    return (
        <>
            <div className="flex justify-between">
                <HeaderTitle
                    title={t("accessUserCreate")}
                    description={t("accessUserCreateDescription")}
                />
                <Button
                    variant="outline"
                    onClick={() => {
                        router.push(`/${orgId}/settings/access/users`);
                    }}
                >
                    {t("userSeeAll")}
                </Button>
            </div>

            <div>
                <SettingsContainer>
                    {!inviteLink && userOptions.length > 1 ? (
                        <SettingsSection>
                            <SettingsSectionHeader>
                                <SettingsSectionTitle>
                                    {t("userTypeTitle")}
                                </SettingsSectionTitle>
                                <SettingsSectionDescription>
                                    {t("userTypeDescription")}
                                </SettingsSectionDescription>
                            </SettingsSectionHeader>
                            <SettingsSectionBody>
                                <StrategySelect
                                    options={userOptions}
                                    value={selectedOption}
                                    onChange={handleUserTypeChange}
                                    cols={3}
                                />
                            </SettingsSectionBody>
                        </SettingsSection>
                    ) : null}

                    {selectedOption === "internal" && dataLoaded && (
                        <>
                            {!inviteLink ? (
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("userSettings")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t("userSettingsDescription")}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        <SettingsSectionForm>
                                            <Form {...internalForm}>
                                                <form
                                                    action={
                                                        submitInternalAction
                                                    }
                                                    className="space-y-4"
                                                    id="create-user-form"
                                                >
                                                    <FormField
                                                        control={
                                                            internalForm.control
                                                        }
                                                        name="email"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t("email")}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <FormField
                                                        control={
                                                            internalForm.control
                                                        }
                                                        name="validForHours"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "inviteValid"
                                                                    )}
                                                                </FormLabel>
                                                                <Select
                                                                    onValueChange={
                                                                        field.onChange
                                                                    }
                                                                    defaultValue={
                                                                        field.value
                                                                    }
                                                                >
                                                                    <FormControl>
                                                                        <SelectTrigger className="w-full">
                                                                            <SelectValue
                                                                                placeholder={t(
                                                                                    "selectDuration"
                                                                                )}
                                                                            />
                                                                        </SelectTrigger>
                                                                    </FormControl>
                                                                    <SelectContent>
                                                                        {validFor.map(
                                                                            (
                                                                                option
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        option.hours
                                                                                    }
                                                                                    value={option.hours.toString()}
                                                                                >
                                                                                    {
                                                                                        option.name
                                                                                    }
                                                                                </SelectItem>
                                                                            )
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <OrgRolesTagField
                                                        form={internalForm}
                                                        name="roles"
                                                        orgId={orgId as string}
                                                        supportsMultipleRolesPerUser={
                                                            supportsMultipleRolesPerUser
                                                        }
                                                        showMultiRolePaywallMessage={
                                                            showMultiRolePaywallMessage
                                                        }
                                                        paywallMessage={
                                                            invitePaywallMessage
                                                        }
                                                    />

                                                    {env.email.emailEnabled && (
                                                        <div className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id="send-email"
                                                                checked={
                                                                    sendEmail
                                                                }
                                                                onCheckedChange={(
                                                                    e
                                                                ) =>
                                                                    setSendEmail(
                                                                        e as boolean
                                                                    )
                                                                }
                                                            />
                                                            <label
                                                                htmlFor="send-email"
                                                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                            >
                                                                {t(
                                                                    "inviteEmailSent"
                                                                )}
                                                            </label>
                                                        </div>
                                                    )}
                                                </form>
                                            </Form>
                                        </SettingsSectionForm>
                                    </SettingsSectionBody>
                                </SettingsSection>
                            ) : (
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("userInvited")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {sendEmail
                                                ? t(
                                                      "inviteEmailSentDescription"
                                                  )
                                                : t("inviteSentDescription")}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        <div className="space-y-4">
                                            <p>
                                                {t("inviteExpiresIn", {
                                                    days: expiresInDays
                                                })}
                                            </p>
                                            <CopyToClipboard
                                                text={inviteLink}
                                            />
                                        </div>
                                    </SettingsSectionBody>
                                </SettingsSection>
                            )}
                        </>
                    )}

                    {selectedOption &&
                        selectedOption !== "internal" &&
                        dataLoaded && (
                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("userSettings")}
                                    </SettingsSectionTitle>
                                    <SettingsSectionDescription>
                                        {t("userSettingsDescription")}
                                    </SettingsSectionDescription>
                                </SettingsSectionHeader>
                                <SettingsSectionBody>
                                    <SettingsSectionForm>
                                        {/* Google/Azure Form */}
                                        {(() => {
                                            const selectedUserOption =
                                                userOptions.find(
                                                    (opt) =>
                                                        opt.id ===
                                                        selectedOption
                                                );
                                            return (
                                                selectedUserOption?.variant ===
                                                    "google" ||
                                                selectedUserOption?.variant ===
                                                    "azure"
                                            );
                                        })() && (
                                            <Form {...googleAzureForm}>
                                                <form
                                                    onSubmit={googleAzureForm.handleSubmit(
                                                        onSubmitGoogleAzure
                                                    )}
                                                    className="space-y-4"
                                                    id="create-user-form"
                                                >
                                                    <FormField
                                                        control={
                                                            googleAzureForm.control
                                                        }
                                                        name="email"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t("email")}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <FormField
                                                        control={
                                                            googleAzureForm.control
                                                        }
                                                        name="name"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "nameOptional"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <OrgRolesTagField
                                                        form={googleAzureForm}
                                                        name="roles"
                                                        orgId={orgId as string}
                                                        supportsMultipleRolesPerUser={
                                                            supportsMultipleRolesPerUser
                                                        }
                                                        showMultiRolePaywallMessage={
                                                            showMultiRolePaywallMessage
                                                        }
                                                        paywallMessage={
                                                            invitePaywallMessage
                                                        }
                                                    />
                                                </form>
                                            </Form>
                                        )}

                                        {/* Generic OIDC Form */}
                                        {(() => {
                                            const selectedUserOption =
                                                userOptions.find(
                                                    (opt) =>
                                                        opt.id ===
                                                        selectedOption
                                                );
                                            return (
                                                selectedUserOption?.variant !==
                                                    "google" &&
                                                selectedUserOption?.variant !==
                                                    "azure"
                                            );
                                        })() && (
                                            <Form {...genericOidcForm}>
                                                <form
                                                    onSubmit={genericOidcForm.handleSubmit(
                                                        onSubmitGenericOidc
                                                    )}
                                                    className="space-y-4"
                                                    id="create-user-form"
                                                >
                                                    <FormField
                                                        control={
                                                            genericOidcForm.control
                                                        }
                                                        name="username"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "username"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <p className="text-sm text-muted-foreground mt-1">
                                                                    {t(
                                                                        "usernameUniq"
                                                                    )}
                                                                </p>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <FormField
                                                        control={
                                                            genericOidcForm.control
                                                        }
                                                        name="email"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "emailOptional"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <FormField
                                                        control={
                                                            genericOidcForm.control
                                                        }
                                                        name="name"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "nameOptional"
                                                                    )}
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        {...field}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <OrgRolesTagField
                                                        form={genericOidcForm}
                                                        name="roles"
                                                        orgId={orgId as string}
                                                        supportsMultipleRolesPerUser={
                                                            supportsMultipleRolesPerUser
                                                        }
                                                        showMultiRolePaywallMessage={
                                                            showMultiRolePaywallMessage
                                                        }
                                                        paywallMessage={
                                                            invitePaywallMessage
                                                        }
                                                    />
                                                </form>
                                            </Form>
                                        )}
                                    </SettingsSectionForm>
                                </SettingsSectionBody>
                            </SettingsSection>
                        )}
                </SettingsContainer>

                <div className="flex justify-end space-x-2 mt-8">
                    {selectedOption && dataLoaded && (
                        <Button
                            type={inviteLink ? "button" : "submit"}
                            form={inviteLink ? undefined : "create-user-form"}
                            loading={loading}
                            disabled={loading}
                            onClick={
                                inviteLink
                                    ? () =>
                                          router.push(
                                              `/${orgId}/settings/access/users`
                                          )
                                    : undefined
                            }
                        >
                            {inviteLink ? t("done") : t("accessUserCreate")}
                        </Button>
                    )}
                </div>
            </div>
        </>
    );
}
