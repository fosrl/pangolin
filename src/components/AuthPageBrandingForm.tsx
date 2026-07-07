"use client";

import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useForm } from "react-hook-form";
import z from "zod";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "./Settings";

import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { build } from "@server/build";
import { validateLocalPath } from "@app/lib/validateLocalPath";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { GetLoginPageBrandingResponse } from "@server/routers/loginPage/types";
import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { PaidFeaturesAlert } from "./PaidFeaturesAlert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type AuthPageCustomizationProps = {
    orgId: string;
    branding: GetLoginPageBrandingResponse | null;
};

const AuthPageFormSchema = z.object({
    logoUrl: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    logoWidth: z.coerce.number<number>().min(1),
    logoHeight: z.coerce.number<number>().min(1),
    orgTitle: z.string().optional(),
    orgSubtitle: z.string().optional(),
    resourceTitle: z.string(),
    resourceSubtitle: z.string().optional(),
    primaryColor: z
        .string()
        .regex(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)
        .optional()
});

export default function AuthPageBrandingForm({
    orgId,
    branding
}: AuthPageCustomizationProps) {
    const env = useEnvContext();
    const api = createApiClient(env);
    const { isPaidUser } = usePaidStatus();

    const router = useRouter();

    const [, updateFormAction, isUpdatingBranding] = useActionState(
        updateBranding,
        null
    );
    const [, deleteFormAction, isDeletingBranding] = useActionState(
        deleteBranding,
        null
    );

    const t = useTranslations();

    const form = useForm({
        resolver: zodResolver(AuthPageFormSchema),
        defaultValues: {
            logoUrl: branding?.logoUrl ?? "",
            logoWidth: branding?.logoWidth ?? 100,
            logoHeight: branding?.logoHeight ?? 100,
            orgTitle: branding?.orgTitle ?? `Log in to {{orgName}}`,
            orgSubtitle: branding?.orgSubtitle ?? `Log in to {{orgName}}`,
            resourceTitle:
                branding?.resourceTitle ??
                `Authenticate to Access {{resourceName}}`,
            resourceSubtitle:
                branding?.resourceSubtitle ??
                `Choose your preferred authentication method for {{resourceName}}`,
            primaryColor: branding?.primaryColor ?? `#f36117` // default pangolin primary color
        },
        disabled: !isPaidUser(tierMatrix.loginPageBranding)
    });

    async function updateBranding() {
        const isValid = await form.trigger();
        const brandingData = form.getValues();

        if (!isValid || !isPaidUser(tierMatrix.loginPageBranding)) return;

        try {
            const updateRes = await api.put(
                `/org/${orgId}/login-page-branding`,
                {
                    ...brandingData
                }
            );

            if (updateRes.status === 200 || updateRes.status === 201) {
                router.refresh();
                toast({
                    variant: "default",
                    title: t("success"),
                    description: t("authPageBrandingUpdated")
                });
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("authPageErrorUpdate"),
                description: formatAxiosError(
                    error,
                    t("authPageErrorUpdateMessage")
                )
            });
        }
    }

    async function deleteBranding() {
        try {
            const updateRes = await api.delete(
                `/org/${orgId}/login-page-branding`
            );

            if (updateRes.status === 200) {
                router.refresh();
                form.reset();

                toast({
                    variant: "default",
                    title: t("success"),
                    description: t("authPageBrandingRemoved")
                });
                form.reset();
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("authPageErrorUpdate"),
                description: formatAxiosError(
                    error,
                    t("authPageErrorUpdateMessage")
                )
            });
        }
    }

    return (
        <>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("authPageBranding")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("authPageBrandingDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <PaidFeaturesAlert
                            tiers={tierMatrix.loginPageBranding}
                        />

                        <Form {...form}>
                            <form
                                action={updateFormAction}
                                id="auth-page-branding-form"
                                className="flex flex-col space-y-4 items-stretch"
                            >
                                <FormField
                                    control={form.control}
                                    name="primaryColor"
                                    render={({ field }) => (
                                        <FormItem className="">
                                            <FormLabel>
                                                {t("brandingPrimaryColor")}
                                            </FormLabel>

                                            <div className="flex items-center gap-2">
                                                <label
                                                    className="size-8 rounded-sm"
                                                    aria-hidden="true"
                                                    style={{
                                                        backgroundColor:
                                                            field.value
                                                    }}
                                                >
                                                    <input
                                                        type="color"
                                                        {...field}
                                                        className="sr-only"
                                                    />
                                                </label>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                            </div>

                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid md:grid-cols-5 gap-3 items-start">
                                    <FormField
                                        control={form.control}
                                        name="logoUrl"
                                        render={({ field }) => (
                                            <FormItem className="md:col-span-3">
                                                <FormLabel>
                                                    {build === "enterprise"
                                                        ? t(
                                                              "brandingLogoURLOrPath"
                                                          )
                                                        : t("brandingLogoURL")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                                <FormDescription>
                                                    {build === "enterprise"
                                                        ? t(
                                                              "brandingLogoPathDescription"
                                                          )
                                                        : t(
                                                              "brandingLogoURLDescription"
                                                          )}
                                                </FormDescription>
                                            </FormItem>
                                        )}
                                    />
                                    <div className="md:col-span-2 flex gap-3  items-start">
                                        <FormField
                                            control={form.control}
                                            name="logoWidth"
                                            render={({ field }) => (
                                                <FormItem className="grow">
                                                    <FormLabel>
                                                        {t("brandingLogoWidth")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <span className="relative top-8">
                                            <XIcon className="text-muted-foreground size-4" />
                                        </span>

                                        <FormField
                                            control={form.control}
                                            name="logoHeight"
                                            render={({ field }) => (
                                                <FormItem className="grow">
                                                    <FormLabel>
                                                        {t(
                                                            "brandingLogoHeight"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {build === "saas" ||
                                env.env.app.identityProviderMode === "org" ? (
                                    <>
                                        <div className="mt-3 mb-6">
                                            <SettingsSectionTitle>
                                                {t(
                                                    "organizationLoginPageTitle"
                                                )}
                                            </SettingsSectionTitle>
                                            <SettingsSectionDescription>
                                                {t(
                                                    "organizationLoginPageDescription"
                                                )}
                                            </SettingsSectionDescription>
                                        </div>

                                        <div className="flex flex-col gap-5">
                                            <FormField
                                                control={form.control}
                                                name="orgTitle"
                                                render={({ field }) => (
                                                    <FormItem className="md:col-span-3">
                                                        <FormLabel>
                                                            {t(
                                                                "brandingOrgTitle"
                                                            )}
                                                        </FormLabel>

                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="orgSubtitle"
                                                render={({ field }) => (
                                                    <FormItem className="md:col-span-3">
                                                        <FormLabel>
                                                            {t(
                                                                "brandingOrgSubtitle"
                                                            )}
                                                        </FormLabel>

                                                        <FormControl>
                                                            <Input {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </>
                                ) : null}

                                <div className="mt-3 mb-6">
                                    <SettingsSectionTitle>
                                        {t("resourceLoginPageTitle")}
                                    </SettingsSectionTitle>
                                    <SettingsSectionDescription>
                                        {t("resourceLoginPageDescription")}
                                    </SettingsSectionDescription>
                                </div>

                                <div className="flex flex-col gap-5">
                                    <FormField
                                        control={form.control}
                                        name="resourceTitle"
                                        render={({ field }) => (
                                            <FormItem className="md:col-span-3">
                                                <FormLabel>
                                                    {t("brandingResourceTitle")}
                                                </FormLabel>

                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="resourceSubtitle"
                                        render={({ field }) => (
                                            <FormItem className="md:col-span-3">
                                                <FormLabel>
                                                    {t(
                                                        "brandingResourceSubtitle"
                                                    )}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <div className="flex justify-end gap-2 mt-6 items-center">
                    {branding && (
                        <form action={deleteFormAction}>
                            <Button
                                variant="destructive"
                                type="submit"
                                loading={isDeletingBranding}
                                disabled={
                                    isUpdatingBranding ||
                                    isDeletingBranding ||
                                    !isPaidUser(tierMatrix.loginPageBranding)
                                }
                                className="gap-1"
                            >
                                {t("removeAuthPageBranding")}
                            </Button>
                        </form>
                    )}
                    <Button
                        type="submit"
                        form="auth-page-branding-form"
                        loading={isUpdatingBranding}
                        disabled={
                            isUpdatingBranding ||
                            isDeletingBranding ||
                            !isPaidUser(tierMatrix.loginPageBranding)
                        }
                    >
                        {t("saveAuthPageBranding")}
                    </Button>
                </div>
            </SettingsSection>
        </>
    );
}
