"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { Badge } from "@app/components/ui/badge";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { resourceQueries } from "@app/lib/queries";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type {
    CreateResourceMtlsCertificateResponse,
    DeleteResourceMtlsCertificateResponse,
    UpdateResourceResponse
} from "@server/routers/resource";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosResponse } from "axios";
import { AlertCircle, FileKey2, Info, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_SOON_MS = 30 * DAY_MS;

export default function ResourceMtlsPage() {
    const params = useParams();
    const router = useRouter();
    const { env } = useEnvContext();
    const { resource, updateResource } = useResourceContext();
    const t = useTranslations();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();
    const { isPaidUser } = usePaidStatus();

    const supportsMtls = resource.mode === "http";
    const isMtlsDisabled = !isPaidUser(tierMatrix.mtls);

    useEffect(() => {
        if (env.flags.disableEnterpriseFeatures || !supportsMtls) {
            router.replace(
                `/${params.orgId}/settings/resources/public/${resource.niceId}/general`
            );
        }
    }, [
        env.flags.disableEnterpriseFeatures,
        params.orgId,
        resource.niceId,
        router,
        supportsMtls
    ]);

    const { data: certificates = [], isLoading: isLoadingCertificates } =
        useQuery(
            resourceQueries.resourceMtlsCertificates({
                resourceId: resource.resourceId
            })
        );

    const [name, setName] = useState("");
    const [pem, setPem] = useState("");
    const [adding, setAdding] = useState(false);
    const [removingId, setRemovingId] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [mtlsEnabled, setMtlsEnabled] = useState(resource.mtlsEnabled);
    const [saving, setSaving] = useState(false);

    // The server switches mTLS off when the last CA is removed.
    useEffect(() => {
        setMtlsEnabled(resource.mtlsEnabled);
    }, [resource.mtlsEnabled]);

    if (env.flags.disableEnterpriseFeatures || !supportsMtls) {
        return null;
    }

    const hasCertificates = certificates.length > 0;
    const canEnable = hasCertificates && resource.ssl;

    async function invalidateCertificates() {
        await queryClient.invalidateQueries(
            resourceQueries.resourceMtlsCertificates({
                resourceId: resource.resourceId
            })
        );
    }

    async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const text = await file.text();
        setPem((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
        if (!name && certificates.length === 0) {
            setName(file.name.replace(/\.(pem|crt|cer|ca-bundle)$/i, ""));
        }
    }

    async function onAddCertificate() {
        if (!pem.trim()) return;
        setAdding(true);
        try {
            await api.put<AxiosResponse<CreateResourceMtlsCertificateResponse>>(
                `/resource/${resource.resourceId}/mtls/certificate`,
                {
                    certificate: pem,
                    ...(name.trim() ? { name: name.trim() } : {})
                }
            );
            setPem("");
            setName("");
            await invalidateCertificates();
            toast({
                title: t("mtlsCertificateAdded"),
                description: t("mtlsCertificateAddedDescription")
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("mtlsCertificateErrorAdd"),
                description: formatAxiosError(
                    e,
                    t("mtlsCertificateErrorAddDescription")
                )
            });
        } finally {
            setAdding(false);
        }
    }

    async function onRemoveCertificate(mtlsCertificateId: number) {
        setRemovingId(mtlsCertificateId);
        try {
            const res = await api.delete<
                AxiosResponse<DeleteResourceMtlsCertificateResponse>
            >(
                `/resource/${resource.resourceId}/mtls/certificate/${mtlsCertificateId}`
            );
            await invalidateCertificates();

            if (res.data.data.mtlsDisabled) {
                updateResource({ mtlsEnabled: false });
                toast({
                    title: t("mtlsCertificateRemoved"),
                    description: t("mtlsLastCertificateRemoved")
                });
            } else {
                toast({ title: t("mtlsCertificateRemoved") });
            }
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("mtlsCertificateErrorRemove"),
                description: formatAxiosError(
                    e,
                    t("mtlsCertificateErrorRemoveDescription")
                )
            });
        } finally {
            setRemovingId(null);
        }
    }

    async function onSaveEnforcement() {
        setSaving(true);
        try {
            await api.post<AxiosResponse<UpdateResourceResponse>>(
                `/resource/${resource.resourceId}`,
                { mtlsEnabled }
            );
            updateResource({ mtlsEnabled });
            toast({
                title: t("resourceUpdated"),
                description: t("resourceUpdatedDescription")
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("resourceErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("resourceErrorUpdateDescription")
                )
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <PaidFeaturesAlert tiers={tierMatrix.mtls} />
            <div
                className={
                    isMtlsDisabled
                        ? "pointer-events-none opacity-50"
                        : undefined
                }
            >
                <SettingsContainer>
                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("mtlsCaCertificates")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("mtlsCaCertificatesDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>

                        <SettingsSectionBody>
                            <div className="space-y-6">
                                {isLoadingCertificates ? null : hasCertificates ? (
                                    <ul className="divide-y rounded-lg border">
                                        {certificates.map((cert) => {
                                            const now = Date.now();
                                            const expired =
                                                cert.notAfter != null &&
                                                cert.notAfter < now;
                                            const expiresSoon =
                                                !expired &&
                                                cert.notAfter != null &&
                                                cert.notAfter - now <
                                                    EXPIRES_SOON_MS;
                                            return (
                                                <li
                                                    key={cert.mtlsCertificateId}
                                                    className="flex items-start justify-between gap-4 p-4"
                                                >
                                                    <div className="flex min-w-0 items-start gap-3">
                                                        <FileKey2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                                                        <div className="min-w-0 space-y-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="truncate font-medium">
                                                                    {cert.name ||
                                                                        cert.subject ||
                                                                        t(
                                                                            "mtlsCaCertificates"
                                                                        )}
                                                                </span>
                                                                {expired && (
                                                                    <Badge variant="red">
                                                                        {t(
                                                                            "mtlsExpired"
                                                                        )}
                                                                    </Badge>
                                                                )}
                                                                {expiresSoon && (
                                                                    <Badge variant="yellow">
                                                                        {t(
                                                                            "mtlsExpiresSoon"
                                                                        )}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            {cert.name &&
                                                                cert.subject && (
                                                                    <p className="truncate text-sm text-muted-foreground">
                                                                        {
                                                                            cert.subject
                                                                        }
                                                                    </p>
                                                                )}
                                                            {cert.issuer && (
                                                                <p className="truncate text-sm text-muted-foreground">
                                                                    {t(
                                                                        "mtlsIssuedBy",
                                                                        {
                                                                            issuer: cert.issuer
                                                                        }
                                                                    )}
                                                                </p>
                                                            )}
                                                            {cert.notAfter !=
                                                                null && (
                                                                <p className="text-sm text-muted-foreground">
                                                                    {t(
                                                                        "mtlsExpiresOn",
                                                                        {
                                                                            date: new Date(
                                                                                cert.notAfter
                                                                            ).toLocaleDateString()
                                                                        }
                                                                    )}
                                                                </p>
                                                            )}
                                                            {cert.fingerprint && (
                                                                <p
                                                                    className="truncate font-mono text-xs text-muted-foreground"
                                                                    title={`${t("mtlsFingerprint")}: ${cert.fingerprint}`}
                                                                >
                                                                    {
                                                                        cert.fingerprint
                                                                    }
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        aria-label={t(
                                                            "mtlsRemoveCertificate"
                                                        )}
                                                        title={t(
                                                            "mtlsRemoveCertificate"
                                                        )}
                                                        loading={
                                                            removingId ===
                                                            cert.mtlsCertificateId
                                                        }
                                                        disabled={
                                                            removingId !== null
                                                        }
                                                        onClick={() =>
                                                            onRemoveCertificate(
                                                                cert.mtlsCertificateId
                                                            )
                                                        }
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        {t("mtlsNoCertificates")}
                                    </p>
                                )}

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="mtls-cert-name">
                                            {t("mtlsCertificateName")}
                                        </Label>
                                        <Input
                                            id="mtls-cert-name"
                                            value={name}
                                            maxLength={255}
                                            placeholder={t(
                                                "mtlsCertificateNamePlaceholder"
                                            )}
                                            onChange={(e) =>
                                                setName(e.target.value)
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="mtls-cert-pem">
                                            {t("mtlsCertificatePem")}
                                        </Label>
                                        <Textarea
                                            id="mtls-cert-pem"
                                            value={pem}
                                            rows={8}
                                            spellCheck={false}
                                            className="font-mono text-xs"
                                            placeholder={
                                                "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
                                            }
                                            onChange={(e) =>
                                                setPem(e.target.value)
                                            }
                                        />
                                        <p className="text-sm text-muted-foreground">
                                            {t("mtlsCertificatePemDescription")}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".pem,.crt,.cer,.ca-bundle"
                                            className="hidden"
                                            onChange={onFileSelected}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                fileInputRef.current?.click()
                                            }
                                        >
                                            {t("mtlsUploadFile")}
                                        </Button>
                                        <Button
                                            type="button"
                                            loading={adding}
                                            disabled={adding || !pem.trim()}
                                            onClick={onAddCertificate}
                                        >
                                            {t("mtlsAddCertificate")}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </SettingsSectionBody>
                    </SettingsSection>

                    <SettingsSection>
                        <SettingsSectionHeader>
                            <SettingsSectionTitle>
                                {t("mtlsEnforcement")}
                            </SettingsSectionTitle>
                            <SettingsSectionDescription>
                                {t("mtlsEnforcementDescription")}
                            </SettingsSectionDescription>
                        </SettingsSectionHeader>

                        <SettingsSectionBody>
                            <div className="space-y-4">
                                {!resource.ssl && (
                                    <Alert variant="warning">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>
                                            {t("mtlsRequiresSsl")}
                                        </AlertDescription>
                                    </Alert>
                                )}
                                {resource.ssl && !hasCertificates && (
                                    <Alert variant="neutral">
                                        <Info className="h-4 w-4" />
                                        <AlertDescription>
                                            {t("mtlsRequiresCertificate")}
                                        </AlertDescription>
                                    </Alert>
                                )}

                                <SwitchInput
                                    id="enable-mtls"
                                    checked={mtlsEnabled && canEnable}
                                    disabled={!canEnable}
                                    label={t("enableMtls")}
                                    description={t("enableMtlsDescription")}
                                    onCheckedChange={setMtlsEnabled}
                                />

                                <Alert variant="info">
                                    <ShieldCheck className="h-4 w-4" />
                                    <AlertTitle>
                                        {t("mtlsForwardedHeadersTitle")}
                                    </AlertTitle>
                                    <AlertDescription>
                                        {t("mtlsForwardedHeadersDescription")}{" "}
                                        {t("mtlsHandshakeNote")}
                                    </AlertDescription>
                                </Alert>
                            </div>
                        </SettingsSectionBody>

                        <SettingsSectionFooter>
                            <Button
                                type="button"
                                loading={saving}
                                disabled={
                                    saving ||
                                    (mtlsEnabled && canEnable) ===
                                        resource.mtlsEnabled
                                }
                                onClick={onSaveEnforcement}
                            >
                                {t("saveSettings")}
                            </Button>
                        </SettingsSectionFooter>
                    </SettingsSection>
                </SettingsContainer>
            </div>
        </>
    );
}
