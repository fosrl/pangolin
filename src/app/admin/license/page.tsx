"use client";

import { useState, useEffect } from "react";
import { LicenseKeyCache, LicenseKeyTier } from "@server/license/license";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { LicenseKeysDataTable } from "@app/components/LicenseKeysDataTable";
import { AxiosResponse } from "axios";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
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
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import {
    SettingsContainer,
    SettingsSectionTitle as SSTitle,
    SettingsSection,
    SettingsSectionDescription,
    SettingsSectionGrid,
    SettingsSectionHeader,
    SettingsSectionFooter
} from "@app/components/Settings";
import { Progress } from "@app/components/ui/progress";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import {
    ArrowRight,
    Check,
    ExternalLink,
    Heart,
    InfoIcon,
    ShoppingCart,
    TicketCheck
} from "lucide-react";
import Link from "next/link";
import DismissableBanner from "@app/components/DismissableBanner";
import CopyTextBox from "@app/components/CopyTextBox";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { SitePriceCalculator } from "@app/components/SitePriceCalculator";
import { Checkbox } from "@app/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
// import { useSupporterStatusContext } from "@app/hooks/useSupporterStatusContext";
import { useTranslations } from "next-intl";

const ENTERPRISE_DOCS_URL =
    "https://docs.pangolin.net/self-host/enterprise-edition";
const ENTERPRISE_PRICING_URL = "https://pangolin.net/pricing#Self-Hosted";
const LICENSE_PORTAL_URL =
    "https://app.pangolin.net/auth/login?internal_redirect=/settings/license?generate";

function getTierLabel(
    tier: LicenseKeyTier | undefined,
    t: (key: string) => string
): string {
    switch (tier) {
        case "enterprise":
            return t("licenseTierEnterprise");
        case "tier1":
            return t("licenseTierTier1");
        case "tier2":
            return t("licenseTierTier2");
        case "personal":
        default:
            return t("licenseTierPersonal");
    }
}

export default function LicensePage() {
    const api = createApiClient(useEnvContext());
    const [rows, setRows] = useState<LicenseKeyCache[]>([]);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedLicenseKey, setSelectedLicenseKey] =
        useState<LicenseKeyCache | null>(null);

    const { licenseStatus, updateLicenseStatus } = useLicenseStatusContext();
    const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
    const [purchaseMode, setPurchaseMode] = useState<"license">("license");

    // Separate loading states for different actions
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isActivatingLicense, setIsActivatingLicense] = useState(false);
    const [isDeletingLicense, setIsDeletingLicense] = useState(false);
    const [isRecheckingLicense, setIsRecheckingLicense] = useState(false);
    // const { supporterStatus } = useSupporterStatusContext();

    const t = useTranslations();

    const formSchema = z.object({
        licenseKey: z
            .string()
            .nonempty({ message: t("licenseKeyRequired") })
            .max(255),
        agreeToTerms: z.boolean().refine((val) => val === true, {
            message: t("licenseTermsAgree")
        })
    });

    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            licenseKey: "",
            agreeToTerms: false
        }
    });

    useEffect(() => {
        async function load() {
            setIsInitialLoading(true);
            await loadLicenseKeys();
            setIsInitialLoading(false);
        }
        load();
    }, []);

    async function loadLicenseKeys() {
        try {
            const response =
                await api.get<AxiosResponse<LicenseKeyCache[]>>(
                    "/license/keys"
                );
            const keys = response.data.data;
            setRows(keys);
        } catch (e) {
            toast({
                title: t("licenseErrorKeyLoad"),
                description: formatAxiosError(
                    e,
                    t("licenseErrorKeyLoadDescription")
                )
            });
        }
    }

    async function deleteLicenseKey(key: string) {
        try {
            setIsDeletingLicense(true);
            const encodedKey = encodeURIComponent(key);
            const res = await api.delete(`/license/${encodedKey}`);
            if (res.data.data) {
                updateLicenseStatus(res.data.data);
            }
            await loadLicenseKeys();
            toast({
                title: t("licenseKeyDeleted"),
                description: t("licenseKeyDeletedDescription")
            });
            setIsDeleteModalOpen(false);
        } catch (e) {
            toast({
                title: t("licenseErrorKeyDelete"),
                description: formatAxiosError(
                    e,
                    t("licenseErrorKeyDeleteDescription")
                )
            });
        } finally {
            setIsDeletingLicense(false);
        }
    }

    async function recheck() {
        try {
            setIsRecheckingLicense(true);
            const res = await api.post(`/license/recheck`);
            if (res.data.data) {
                updateLicenseStatus(res.data.data);
            }
            await loadLicenseKeys();
            toast({
                title: t("licenseErrorKeyRechecked"),
                description: t("licenseErrorKeyRecheckedDescription")
            });
        } catch (e) {
            toast({
                title: t("licenseErrorKeyRecheck"),
                description: formatAxiosError(
                    e,
                    t("licenseErrorKeyRecheckDescription")
                )
            });
        } finally {
            setIsRecheckingLicense(false);
        }
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        try {
            setIsActivatingLicense(true);
            const res = await api.post("/license/activate", {
                licenseKey: values.licenseKey
            });
            if (res.data.data) {
                updateLicenseStatus(res.data.data);
            }

            toast({
                title: t("licenseKeyActivated"),
                description: t("licenseKeyActivatedDescription")
            });

            setIsCreateModalOpen(false);
            form.reset();
            await loadLicenseKeys();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("licenseErrorKeyActivate"),
                description: formatAxiosError(
                    e,
                    t("licenseErrorKeyActivateDescription")
                )
            });
        } finally {
            setIsActivatingLicense(false);
        }
    }

    if (isInitialLoading) {
        return null;
    }

    return (
        <>
            <SitePriceCalculator
                isOpen={isPurchaseModalOpen}
                onOpenChange={(val) => {
                    setIsPurchaseModalOpen(val);
                }}
                mode={purchaseMode}
            />

            <Credenza
                open={isCreateModalOpen}
                onOpenChange={(val) => {
                    setIsCreateModalOpen(val);
                    form.reset();
                }}
            >
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>{t("licenseActivateKey")}</CredenzaTitle>
                        <CredenzaDescription>
                            {t("licenseActivateKeyDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody className="overflow-y-hidden">
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="space-y-4"
                                id="activate-license-form"
                            >
                                <FormField
                                    control={form.control}
                                    name="licenseKey"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("licenseKey")}
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
                                    name="agreeToTerms"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
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
                                                    {t("licenseAgreement")}
                                                </FormLabel>
                                                <FormMessage />
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </form>
                        </Form>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                        <Button
                            type="submit"
                            form="activate-license-form"
                            loading={isActivatingLicense}
                            disabled={isActivatingLicense}
                        >
                            {t("licenseActivate")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            {selectedLicenseKey && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedLicenseKey(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("licenseQuestionRemove")}</p>
                            <p>
                                <b>{t("licenseMessageRemove")}</b>
                            </p>
                        </div>
                    }
                    buttonText={t("licenseKeyDeleteConfirm")}
                    onConfirm={async () =>
                        deleteLicenseKey(selectedLicenseKey.licenseKeyEncrypted)
                    }
                    string={selectedLicenseKey.licenseKey}
                    title={t("licenseKeyDelete")}
                />
            )}

            <SettingsSectionTitle
                title={t("licenseTitle")}
                description={t("licenseTitleDescription")}
            />

            {!licenseStatus?.isLicenseValid && (
                <DismissableBanner
                    storageKey="license-banner-dismissed"
                    version={1}
                    title={t("licenseBannerTitle")}
                    titleIcon={<TicketCheck className="w-5 h-5 text-primary" />}
                    description={t("licenseBannerDescription")}
                >
                    <Link
                        href={ENTERPRISE_DOCS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                        >
                            {t("licenseBannerViewDocs")}
                            <ExternalLink className="w-4 h-4" />
                        </Button>
                    </Link>
                    <Link
                        href={ENTERPRISE_PRICING_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                        >
                            {t("licenseBannerGetLicense")}
                            <ArrowRight className="w-4 h-4" />
                        </Button>
                    </Link>
                </DismissableBanner>
            )}

            {licenseStatus?.isLicenseValid && rows.length > 0 && (
                <DismissableBanner
                    storageKey="license-upgrade-banner-dismissed"
                    version={1}
                    title={t("licenseUpgradeBannerTitle")}
                    titleIcon={
                        <ShoppingCart className="w-5 h-5 text-primary" />
                    }
                    description={t("licenseUpgradeBannerDescription")}
                >
                    <Link
                        href={LICENSE_PORTAL_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 hover:bg-primary/10 hover:border-primary/50 transition-colors"
                        >
                            {t("licenseUpgradeBannerButton")}
                            <ExternalLink className="w-4 h-4" />
                        </Button>
                    </Link>
                </DismissableBanner>
            )}

            {/* <Alert variant="neutral" className="mb-6"> */}
            {/*     <InfoIcon className="h-4 w-4" /> */}
            {/*     <AlertTitle className="font-semibold"> */}
            {/*         {t("licenseAbout")} */}
            {/*     </AlertTitle> */}
            {/*     <AlertDescription> */}
            {/*         {t("licenseAboutDescription")} */}
            {/*     </AlertDescription> */}
            {/* </Alert> */}

            <SettingsContainer>
                <SettingsSectionGrid cols={2}>
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SSTitle>{t("licenseUsage")}</SSTitle>
                            <SettingsSectionDescription>
                                {t("licenseUsageDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <div className="text-sm font-medium">
                                    {t("licenseUsageSites")}
                                </div>
                                <div className="text-2xl">
                                    {t("licenseSitesUsed", {
                                        count: licenseStatus?.usedSites || 0
                                    })}
                                </div>
                                {licenseStatus?.maxSites ? (
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">
                                                {t("licenseSitesUsedMax", {
                                                    usedSites:
                                                        licenseStatus.usedSites ||
                                                        0,
                                                    maxSites:
                                                        licenseStatus.maxSites
                                                })}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {Math.round(
                                                    ((licenseStatus.usedSites ||
                                                        0) /
                                                        licenseStatus.maxSites) *
                                                        100
                                                )}
                                                %
                                            </span>
                                        </div>
                                        <Progress
                                            value={
                                                ((licenseStatus.usedSites ||
                                                    0) /
                                                    licenseStatus.maxSites) *
                                                100
                                            }
                                            className="h-5"
                                        />
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground">
                                        {t("licenseNoSiteLimit")}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <div className="text-sm font-medium">
                                    {t("licenseUsageUsers")}
                                </div>
                                <div className="text-2xl">
                                    {t("licenseUsersUsed", {
                                        count: licenseStatus?.usedUsers || 0
                                    })}
                                </div>
                                {licenseStatus?.maxUsers ? (
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">
                                                {t("licenseUsersUsedMax", {
                                                    usedUsers:
                                                        licenseStatus.usedUsers ||
                                                        0,
                                                    maxUsers:
                                                        licenseStatus.maxUsers
                                                })}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {Math.round(
                                                    ((licenseStatus.usedUsers ||
                                                        0) /
                                                        licenseStatus.maxUsers) *
                                                        100
                                                )}
                                                %
                                            </span>
                                        </div>
                                        <Progress
                                            value={
                                                ((licenseStatus.usedUsers ||
                                                    0) /
                                                    licenseStatus.maxUsers) *
                                                100
                                            }
                                            className="h-5"
                                        />
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground">
                                        {t("licenseNoUserLimit")}
                                    </div>
                                )}
                            </div>
                        </div>
                    </SettingsSection>
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SSTitle>{t("licenseHost")}</SSTitle>
                            <SettingsSectionDescription>
                                {t("licenseHostDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>
                        <div className="space-y-4">
                            <div className="flex items-center space-x-4">
                                {licenseStatus?.isLicenseValid ? (
                                    <div className="space-y-2 text-green-500">
                                        <div className="text-2xl flex items-center gap-2">
                                            <Check />
                                            {t("licensed") +
                                                `${licenseStatus?.tier === "personal" ? ` (${t("personalUseOnly")})` : ""}`}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-2xl">
                                        {t("unlicensed")}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <div className="text-sm font-medium">
                                    {t("licenseTierLabel")}
                                </div>
                                <div className="text-lg">
                                    {getTierLabel(licenseStatus?.tier, t)}
                                </div>
                                {rows.length > 1 && (
                                    <div className="text-sm text-muted-foreground">
                                        {t("licenseMultipleKeysDescription")}
                                    </div>
                                )}
                            </div>
                            {licenseStatus?.hostId && (
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">
                                        {t("hostId")}
                                    </div>
                                    <CopyTextBox text={licenseStatus.hostId} />
                                </div>
                            )}
                        </div>
                        <SettingsSectionFooter>
                            <Button
                                variant="outline"
                                onClick={recheck}
                                disabled={isRecheckingLicense}
                                loading={isRecheckingLicense}
                            >
                                {t("licenseReckeckAll")}
                            </Button>
                        </SettingsSectionFooter>
                    </SettingsSection>
                </SettingsSectionGrid>
                <LicenseKeysDataTable
                    licenseKeys={rows}
                    onDelete={(key) => {
                        setSelectedLicenseKey(key);
                        setIsDeleteModalOpen(true);
                    }}
                    onCreate={() => setIsCreateModalOpen(true)}
                />
            </SettingsContainer>
        </>
    );
}
