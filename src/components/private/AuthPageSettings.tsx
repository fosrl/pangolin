"use client";

import { Button } from "@app/components/ui/button";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import { useState, useEffect, useActionState } from "react";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { formatAxiosError } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { useRouter } from "next/navigation";
import {
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm
} from "@app/components/Settings";
import { useTranslations } from "next-intl";
import { GetLoginPageResponse } from "@server/routers/loginPage/types";
import { ListDomainsResponse } from "@server/routers/domain";
import { DomainRow } from "@app/components/DomainsTable";
import { toUnicode } from "punycode";
import { Globe, Trash2 } from "lucide-react";
import CertificateStatus from "@app/components/private/CertificateStatus";
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
import DomainPicker from "@app/components/DomainPicker";
import { finalizeSubdomainSanitize } from "@app/lib/subdomain-utils";
import { InfoPopup } from "@app/components/ui/info-popup";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { build } from "@server/build";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { PaidFeaturesAlert } from "../PaidFeaturesAlert";

// Auth page form schema
const AuthPageFormSchema = z.object({
    authPageDomainId: z.string().optional(),
    authPageSubdomain: z.string().optional()
});

interface AuthPageSettingsProps {
    onSaveSuccess?: () => void;
    onSaveError?: (error: any) => void;
    loginPage: GetLoginPageResponse | null;
}

export interface AuthPageSettingsRef {
    saveAuthSettings: () => Promise<void>;
    hasUnsavedChanges: () => boolean;
}

function AuthPageSettings({
    onSaveSuccess,
    onSaveError,
    loginPage: defaultLoginPage
}: AuthPageSettingsProps) {
    const { org } = useOrgContext();
    const api = createApiClient(useEnvContext());
    const router = useRouter();
    const t = useTranslations();
    const { env } = useEnvContext();

    const { hasSaasSubscription } = usePaidStatus();

    // Auth page domain state
    const [loginPage, setLoginPage] = useState(defaultLoginPage);
    const [, formAction, isSubmitting] = useActionState(onSubmit, null);
    const [loginPageExists, setLoginPageExists] = useState(
        Boolean(defaultLoginPage)
    );
    const [editDomainOpen, setEditDomainOpen] = useState(false);
    const [baseDomains, setBaseDomains] = useState<DomainRow[]>([]);
    const [selectedDomain, setSelectedDomain] = useState<{
        domainId: string;
        subdomain?: string;
        fullDomain: string;
        baseDomain: string;
    } | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const form = useForm({
        resolver: zodResolver(AuthPageFormSchema),
        defaultValues: {
            authPageDomainId: loginPage?.domainId || "",
            authPageSubdomain: loginPage?.subdomain || ""
        },
        mode: "onChange"
    });

    // Fetch login page and domains data
    useEffect(() => {
        const fetchDomains = async () => {
            try {
                const res = await api.get<AxiosResponse<ListDomainsResponse>>(
                    `/org/${org?.org.orgId}/domains/`
                );
                if (res.status === 200) {
                    const rawDomains = res.data.data.domains as DomainRow[];
                    const domains = rawDomains.map((domain) => ({
                        ...domain,
                        baseDomain: toUnicode(domain.baseDomain)
                    }));
                    setBaseDomains(domains);
                }
            } catch (err) {
                console.error("Failed to fetch domains:", err);
            }
        };

        if (org?.org.orgId) {
            fetchDomains();
        }
    }, []);

    // Handle domain selection from modal
    function handleDomainSelection(domain: {
        domainId: string;
        subdomain?: string;
        fullDomain: string;
        baseDomain: string;
    }) {
        form.setValue("authPageDomainId", domain.domainId);
        form.setValue("authPageSubdomain", domain.subdomain || "");
        setEditDomainOpen(false);

        // Update loginPage state to show the selected domain immediately
        const sanitizedSubdomain = domain.subdomain
            ? finalizeSubdomainSanitize(domain.subdomain)
            : "";

        const sanitizedFullDomain = sanitizedSubdomain
            ? `${sanitizedSubdomain}.${domain.baseDomain}`
            : domain.baseDomain;

        // Only update loginPage state if a login page already exists
        if (loginPageExists && loginPage) {
            setLoginPage({
                ...loginPage,
                domainId: domain.domainId,
                subdomain: sanitizedSubdomain,
                fullDomain: sanitizedFullDomain
            });
        }

        setHasUnsavedChanges(true);
    }

    // Clear auth page domain
    function clearAuthPageDomain() {
        form.setValue("authPageDomainId", "");
        form.setValue("authPageSubdomain", "");
        setLoginPage(null);
        setHasUnsavedChanges(true);
    }

    async function onSubmit() {
        const isValid = await form.trigger();
        if (!isValid) return;

        const data = form.getValues();

        try {
            // Handle auth page domain
            if (data.authPageDomainId) {
                if (build === "enterprise" || hasSaasSubscription) {
                    const sanitizedSubdomain = data.authPageSubdomain
                        ? finalizeSubdomainSanitize(data.authPageSubdomain)
                        : "";

                    if (loginPageExists) {
                        // Login page exists on server - need to update it
                        // First, we need to get the loginPageId from the server since loginPage might be null locally
                        let loginPageId: number;

                        if (loginPage) {
                            // We have the loginPage data locally
                            loginPageId = loginPage.loginPageId;
                        } else {
                            // User cleared selection locally, but login page still exists on server
                            // We need to fetch it to get the loginPageId
                            const fetchRes = await api.get<
                                AxiosResponse<GetLoginPageResponse>
                            >(`/org/${org?.org.orgId}/login-page`);
                            loginPageId = fetchRes.data.data.loginPageId;
                        }

                        // Update existing auth page domain
                        const updateRes = await api.post(
                            `/org/${org?.org.orgId}/login-page/${loginPageId}`,
                            {
                                domainId: data.authPageDomainId,
                                subdomain: sanitizedSubdomain || null
                            }
                        );

                        if (updateRes.status === 201) {
                            setLoginPage(updateRes.data.data);
                            setLoginPageExists(true);
                        }
                    } else {
                        // No login page exists on server - create new one
                        const createRes = await api.put(
                            `/org/${org?.org.orgId}/login-page`,
                            {
                                domainId: data.authPageDomainId,
                                subdomain: sanitizedSubdomain || null
                            }
                        );

                        if (createRes.status === 201) {
                            setLoginPage(createRes.data.data);
                            setLoginPageExists(true);
                        }
                    }
                }
            } else if (loginPageExists) {
                // Delete existing auth page domain if no domain selected
                let loginPageId: number;

                if (loginPage) {
                    // We have the loginPage data locally
                    loginPageId = loginPage.loginPageId;
                } else {
                    // User cleared selection locally, but login page still exists on server
                    // We need to fetch it to get the loginPageId
                    const fetchRes = await api.get<
                        AxiosResponse<GetLoginPageResponse>
                    >(`/org/${org?.org.orgId}/login-page`);
                    loginPageId = fetchRes.data.data.loginPageId;
                }

                await api.delete(
                    `/org/${org?.org.orgId}/login-page/${loginPageId}`
                );
                setLoginPage(null);
                setLoginPageExists(false);
            }

            setHasUnsavedChanges(false);
            router.refresh();
            onSaveSuccess?.();
            toast({
                variant: "default",
                title: t("success"),
                description: t("authPageDomainUpdated")
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("authPageErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("authPageErrorUpdateMessage")
                )
            });
            onSaveError?.(e);
        }
    }

    return (
        <>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>{t("customDomain")}</SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("authPageDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <SettingsSectionForm>

                        <PaidFeaturesAlert />

                        <Form {...form}>
                            <form
                                action={formAction}
                                className="space-y-4"
                                id="auth-page-settings-form"
                            >
                                <div className="space-y-3">
                                    <Label>{t("authPageDomain")}</Label>
                                    <div className="border p-2 rounded-md flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground flex items-center gap-2">
                                            <Globe size="14" />
                                            {loginPage &&
                                            !loginPage.domainId ? (
                                                <InfoPopup
                                                    info={t(
                                                        "domainNotFoundDescription"
                                                    )}
                                                    text={t("domainNotFound")}
                                                />
                                            ) : loginPage?.fullDomain ? (
                                                <a
                                                    href={`${window.location.protocol}//${loginPage.fullDomain}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="hover:underline"
                                                >
                                                    {`${window.location.protocol}//${loginPage.fullDomain}`}
                                                </a>
                                            ) : form.watch(
                                                  "authPageDomainId"
                                              ) ? (
                                                // Show selected domain from form state when no loginPage exists yet
                                                (() => {
                                                    const selectedDomainId =
                                                        form.watch(
                                                            "authPageDomainId"
                                                        );
                                                    const selectedSubdomain =
                                                        form.watch(
                                                            "authPageSubdomain"
                                                        );
                                                    const domain =
                                                        baseDomains.find(
                                                            (d) =>
                                                                d.domainId ===
                                                                selectedDomainId
                                                        );
                                                    if (domain) {
                                                        const sanitizedSubdomain =
                                                            selectedSubdomain
                                                                ? finalizeSubdomainSanitize(
                                                                      selectedSubdomain
                                                                  )
                                                                : "";
                                                        const fullDomain =
                                                            sanitizedSubdomain
                                                                ? `${sanitizedSubdomain}.${domain.baseDomain}`
                                                                : domain.baseDomain;
                                                        return fullDomain;
                                                    }
                                                    return t("noDomainSet");
                                                })()
                                            ) : (
                                                t("noDomainSet")
                                            )}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="secondary"
                                                type="button"
                                                size="sm"
                                                onClick={() =>
                                                    setEditDomainOpen(true)
                                                }
                                                disabled={!hasSaasSubscription}
                                            >
                                                {form.watch("authPageDomainId")
                                                    ? t("changeDomain")
                                                    : t("selectDomain")}
                                            </Button>
                                            {form.watch("authPageDomainId") && (
                                                <Button
                                                    variant="destructive"
                                                    type="button"
                                                    size="sm"
                                                    onClick={
                                                        clearAuthPageDomain
                                                    }
                                                    disabled={
                                                        !hasSaasSubscription
                                                    }
                                                >
                                                    <Trash2 size="14" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {!form.watch("authPageDomainId") && (
                                        <div className="text-sm text-muted-foreground">
                                            {t(
                                                "addDomainToEnableCustomAuthPages"
                                            )}
                                        </div>
                                    )}

                                    {env.flags.usePangolinDns &&
                                        (build === "enterprise" ||
                                            !hasSaasSubscription) &&
                                        loginPage?.domainId &&
                                        loginPage?.fullDomain &&
                                        !hasUnsavedChanges && (
                                            <CertificateStatus
                                                orgId={org?.org.orgId || ""}
                                                domainId={loginPage.domainId}
                                                fullDomain={
                                                    loginPage.fullDomain
                                                }
                                                autoFetch={true}
                                                showLabel={true}
                                                polling={true}
                                            />
                                        )}
                                </div>
                            </form>
                        </Form>
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <div className="flex justify-end mt-6">
                    <Button
                        type="submit"
                        form="auth-page-settings-form"
                        loading={isSubmitting}
                        disabled={
                            isSubmitting ||
                            !hasUnsavedChanges ||
                            !hasSaasSubscription
                        }
                    >
                        {t("saveAuthPageDomain")}
                    </Button>
                </div>
            </SettingsSection>

            {/* Domain Picker Modal */}
            <Credenza
                open={editDomainOpen}
                onOpenChange={(setOpen) => setEditDomainOpen(setOpen)}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {loginPage
                                ? t("editAuthPageDomain")
                                : t("setAuthPageDomain")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("selectDomainForOrgAuthPage")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <DomainPicker
                            hideFreeDomain={true}
                            orgId={org?.org.orgId as string}
                            cols={1}
                            onDomainChange={(res) => {
                                const selected =
                                    res === null
                                        ? null
                                        : {
                                              domainId: res.domainId,
                                              subdomain: res.subdomain,
                                              fullDomain: res.fullDomain,
                                              baseDomain: res.baseDomain
                                          };
                                setSelectedDomain(selected);
                            }}
                        />
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("cancel")}</Button>
                        </CredenzaClose>
                        <Button
                            onClick={() => {
                                if (selectedDomain) {
                                    handleDomainSelection(selectedDomain);
                                }
                            }}
                            disabled={!selectedDomain || !hasSaasSubscription}
                        >
                            {t("selectDomain")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}

AuthPageSettings.displayName = "AuthPageSettings";

export default AuthPageSettings;
