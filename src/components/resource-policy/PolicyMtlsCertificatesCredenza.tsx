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
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { Textarea } from "@app/components/ui/textarea";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { orgQueries } from "@app/lib/queries";
import type {
    CreateResourcePolicyMtlsCertificateResponse,
    DeleteResourcePolicyMtlsCertificateResponse,
    ListResourcePolicyMtlsCertificatesResponse
} from "@server/routers/policy";
import { useQueryClient } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { FileKey2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_SOON_MS = 30 * DAY_MS;

export type MtlsCertificateListItem = Pick<
    ListResourcePolicyMtlsCertificatesResponse["certificates"][number],
    "mtlsCertificateId" | "name" | "subject" | "issuer" | "notAfter"
>;

type PolicyMtlsCertificatesCredenzaProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    resourcePolicyId: number;
    certificates: ListResourcePolicyMtlsCertificatesResponse["certificates"];
    isLoading: boolean;
    // called when removing the last CA certificate switched mTLS off
    onMtlsDisabled: () => void;
};

/** Manages the trusted CAs of an existing policy through the API. */
export function PolicyMtlsCertificatesCredenza({
    resourcePolicyId,
    onMtlsDisabled,
    ...props
}: PolicyMtlsCertificatesCredenzaProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();

    async function invalidateCertificates() {
        await queryClient.invalidateQueries(
            orgQueries.resourcePolicyMtlsCertificates({ resourcePolicyId })
        );
    }

    async function onAdd(pem: string, name: string | null) {
        try {
            await api.put<
                AxiosResponse<CreateResourcePolicyMtlsCertificateResponse>
            >(`/resource-policy/${resourcePolicyId}/mtls/certificate`, {
                certificate: pem,
                ...(name ? { name } : {})
            });
            await invalidateCertificates();
            toast({
                title: t("mtlsCertificateAdded"),
                description: t("mtlsCertificateAddedDescription")
            });
            return true;
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("mtlsCertificateErrorAdd"),
                description: formatAxiosError(
                    e,
                    t("mtlsCertificateErrorAddDescription")
                )
            });
            return false;
        }
    }

    async function onRemove(mtlsCertificateId: number) {
        try {
            const res = await api.delete<
                AxiosResponse<DeleteResourcePolicyMtlsCertificateResponse>
            >(
                `/resource-policy/${resourcePolicyId}/mtls/certificate/${mtlsCertificateId}`
            );
            await invalidateCertificates();

            if (res.data.data.mtlsDisabled) {
                onMtlsDisabled();
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
        }
    }

    return (
        <MtlsCertificatesCredenza
            {...props}
            onAdd={onAdd}
            onRemove={onRemove}
        />
    );
}

type MtlsCertificatesCredenzaProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    certificates: MtlsCertificateListItem[];
    isLoading: boolean;
    // resolves true when the certificate was added and the inputs can reset
    onAdd: (pem: string, name: string | null) => Promise<boolean>;
    onRemove: (mtlsCertificateId: number) => Promise<void>;
};

export function MtlsCertificatesCredenza({
    open,
    onOpenChange,
    certificates,
    isLoading,
    onAdd,
    onRemove
}: MtlsCertificatesCredenzaProps) {
    const t = useTranslations();

    const [name, setName] = useState("");
    const [pem, setPem] = useState("");
    const [adding, setAdding] = useState(false);
    const [removingId, setRemovingId] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
            if (await onAdd(pem, name.trim() || null)) {
                setPem("");
                setName("");
            }
        } finally {
            setAdding(false);
        }
    }

    async function onRemoveCertificate(mtlsCertificateId: number) {
        setRemovingId(mtlsCertificateId);
        try {
            await onRemove(mtlsCertificateId);
        } finally {
            setRemovingId(null);
        }
    }

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent className="max-w-2xl">
                <CredenzaHeader>
                    <CredenzaTitle>{t("mtlsCaCertificates")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("mtlsCaCertificatesDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-6">
                        {isLoading ? null : certificates.length > 0 ? (
                            <ul className="divide-y rounded-lg border">
                                {certificates.map((cert) => {
                                    const now = Date.now();
                                    const expired =
                                        cert.notAfter != null &&
                                        cert.notAfter < now;
                                    const expiresSoon =
                                        !expired &&
                                        cert.notAfter != null &&
                                        cert.notAfter - now < EXPIRES_SOON_MS;
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
                                                                {cert.subject}
                                                            </p>
                                                        )}
                                                    {cert.issuer && (
                                                        <p className="truncate text-sm text-muted-foreground">
                                                            {t("mtlsIssuedBy", {
                                                                issuer: cert.issuer
                                                            })}
                                                        </p>
                                                    )}
                                                    {cert.notAfter != null && (
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
                                                disabled={removingId !== null}
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
                                    onChange={(e) => setName(e.target.value)}
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
                                    onChange={(e) => setPem(e.target.value)}
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
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("close")}</Button>
                    </CredenzaClose>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
