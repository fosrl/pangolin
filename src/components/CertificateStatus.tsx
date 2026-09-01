"use client";

import { Button } from "@/components/ui/button";
import { FileBadge, RotateCw } from "lucide-react";
import { useCertificate } from "@app/hooks/useCertificate";
import type { GetCertificateResponse } from "@server/routers/certificates/types";
import { useTranslations } from "next-intl";
import { durationToMs } from "@app/lib/durationToMs";

export type CertificateStatusContentProps = {
    cert: GetCertificateResponse | null;
    certLoading: boolean;
    certError: string | null;
    refreshing: boolean;
    refreshCert: () => Promise<void>;
    showLabel?: boolean;
    className?: string;
    onRefresh?: () => void;
};

/** Presentation-only certificate row (shared hook state possible via props). */
export function CertificateStatusContent({
    cert,
    certLoading,
    certError,
    refreshing,
    refreshCert,
    showLabel = true,
    className = "",
    onRefresh
}: CertificateStatusContentProps) {
    const t = useTranslations();

    const labelClass =
        "inline-flex shrink-0 items-center self-center text-sm font-medium leading-normal";
    const valueClass = "inline-flex items-center gap-2 text-sm leading-normal";

    const handleRefresh = async () => {
        await refreshCert();
        onRefresh?.();
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case "valid":
                return "text-green-500";
            case "pending":
            case "requested":
                return "text-yellow-500";
            case "expired":
            case "failed":
                return "text-red-500";
            default:
                return "text-muted-foreground";
        }
    };

    const shouldShowRefreshButton = (status: string, updatedAt: number) => {
        return (
            status === "failed" ||
            status === "expired" ||
            (status === "requested" &&
                updatedAt &&
                new Date(updatedAt * 1000).getTime() <
                    Date.now() - 5 * 60 * 1000)
        );
    };

    if (certLoading) {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                {showLabel && (
                    <span className={labelClass}>
                        {t("certificateStatus")}:
                    </span>
                )}
                <span className={valueClass}>
                    <FileBadge
                        className="h-4 w-4 shrink-0 animate-pulse text-muted-foreground"
                        aria-hidden
                    />
                    {t("loading")}
                </span>
            </div>
        );
    }

    if (certError) {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                {showLabel && (
                    <span className={labelClass}>
                        {t("certificateStatus")}:
                    </span>
                )}
                <span className={valueClass}>
                    <FileBadge
                        className="h-4 w-4 shrink-0 text-red-500"
                        aria-hidden
                    />
                    {certError}
                </span>
            </div>
        );
    }

    if (!cert) {
        return (
            <div className={`flex items-center gap-2 ${className}`}>
                {showLabel && (
                    <span className={labelClass}>
                        {t("certificateStatus")}:
                    </span>
                )}
                <span className={valueClass}>
                    <FileBadge
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                    />
                    {t("none", { defaultValue: "None" })}
                </span>
            </div>
        );
    }

    const isPending = cert.status === "pending";
    const disableRestartButton = cert.domainType === "wildcard";

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            {showLabel && (
                <span className={labelClass}>{t("certificateStatus")}:</span>
            )}
            {isPending && !disableRestartButton ? (
                <Button
                    variant="ghost"
                    className="h-auto min-h-0 shrink-0 p-0 text-sm font-normal leading-normal inline-flex items-center self-center"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    title={t("restartCertificate", {
                        defaultValue: "Restart Certificate"
                    })}
                >
                    <span className="inline-flex items-center gap-2 leading-normal">
                        <FileBadge
                            className={`h-4 w-4 shrink-0 ${getStatusColor(cert.status)}`}
                            aria-hidden
                        />
                        {cert.status.charAt(0).toUpperCase() +
                            cert.status.slice(1)}
                        <RotateCw
                            className={`h-4 w-4 shrink-0 ${refreshing ? "animate-spin" : ""}`}
                        />
                    </span>
                </Button>
            ) : (
                <span className={valueClass}>
                    <FileBadge
                        className={`h-4 w-4 shrink-0 ${getStatusColor(cert.status)}`}
                        aria-hidden
                    />
                    {cert.status.charAt(0).toUpperCase() + cert.status.slice(1)}
                    {shouldShowRefreshButton(cert.status, cert.updatedAt) &&
                    !disableRestartButton ? (
                        <Button
                            size="icon"
                            variant="ghost"
                            className="inline-flex h-4 w-4 min-h-0 shrink-0 items-center justify-center self-center p-0"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            title={t("restartCertificate", {
                                defaultValue: "Restart Certificate"
                            })}
                        >
                            <RotateCw
                                className={`h-4 w-4 shrink-0 ${refreshing ? "animate-spin" : ""}`}
                            />
                        </Button>
                    ) : null}
                </span>
            )}
        </div>
    );
}

type CertificateStatusProps = {
    orgId: string;
    domainId: string;
    fullDomain: string;
    showLabel?: boolean;
    className?: string;
    onRefresh?: () => void;
    polling?: boolean;
    pollingInterval?: number;
};

export default function CertificateStatus({
    orgId,
    domainId,
    fullDomain,
    showLabel = true,
    className = "",
    onRefresh,
    polling = false,
    pollingInterval = durationToMs(5, "seconds")
}: CertificateStatusProps) {
    const hook = useCertificate({
        orgId,
        domainId,
        fullDomain,
        polling,
        pollingInterval
    });

    return (
        <CertificateStatusContent
            cert={hook.cert}
            certLoading={hook.certLoading}
            certError={hook.certError}
            refreshing={hook.refreshing}
            refreshCert={hook.refreshCert}
            showLabel={showLabel}
            className={className}
            onRefresh={onRefresh}
        />
    );
}
