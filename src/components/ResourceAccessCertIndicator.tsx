"use client";

import { CertificateStatusContent } from "@app/components/CertificateStatus";
import {
    Popover,
    PopoverAnchor,
    PopoverContent
} from "@app/components/ui/popover";
import { useCertificate } from "@app/hooks/useCertificate";
import type { GetCertificateResponse } from "@server/routers/certificates/types";
import { cn } from "@app/lib/cn";
import { FileBadge } from "lucide-react";
import { useTranslations } from "next-intl";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode
} from "react";
import { durationToMs } from "@app/lib/durationToMs";

type ResourceAccessCertIndicatorProps = {
    orgId: string;
    domainId: string;
    fullDomain: string;
    initialCertValue?: GetCertificateResponse | null;
};

function getStatusColor(status: string) {
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
}

/** Compact cert icon + hover popover with full certificate status (shared by proxy and client resource tables). */
export function ResourceAccessCertIndicator({
    orgId,
    domainId,
    fullDomain,
    initialCertValue
}: ResourceAccessCertIndicatorProps) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const certificate = useCertificate({
        orgId,
        domainId,
        fullDomain,
        initialCertValue,
        polling: open,
        pollingInterval: durationToMs(5, "seconds")
    });

    const { cert, certLoading, certError, refreshing, fetchCert } = certificate;

    // `polling` only schedules on predefined intervals (1 second),
    // so the first request would be a full interval away if open = true (which set polling = true).
    // So we fetch immediately so the popover opens with fresh data.
    useEffect(() => {
        if (!open) return;
        void fetchCert();
    }, [open, fetchCert]);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current != null) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    const scheduleClose = useCallback(() => {
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => setOpen(false), 280);
    }, [clearCloseTimer]);

    const handleEnterOpen = useCallback(() => {
        clearCloseTimer();
        setOpen(true);
    }, [clearCloseTimer]);

    useEffect(() => {
        return () => clearCloseTimer();
    }, [clearCloseTimer]);

    let triggerBody: ReactNode;
    if (certLoading) {
        triggerBody = (
            <div
                className={cn(
                    "h-4 w-4 shrink-0 rounded-[2px] animate-pulse",
                    "bg-neutral-200 dark:bg-neutral-700"
                )}
                aria-busy="true"
                aria-label={t("loading")}
            />
        );
    } else if (refreshing) {
        triggerBody = (
            <FileBadge
                className={cn(
                    "h-4 w-4 shrink-0 animate-spin",
                    cert ? getStatusColor(cert.status) : "text-muted-foreground"
                )}
                aria-hidden
            />
        );
    } else if (certError) {
        triggerBody = (
            <FileBadge className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
        );
    } else if (cert) {
        triggerBody = (
            <FileBadge
                className={cn("h-4 w-4", getStatusColor(cert.status))}
                aria-hidden
            />
        );
    } else {
        triggerBody = (
            <FileBadge
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
            />
        );
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <button
                    type="button"
                    className={cn(
                        "inline-flex items-center justify-center shrink-0 rounded-[2px] outline-offset-2",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                        certError && "text-red-500"
                    )}
                    onMouseEnter={handleEnterOpen}
                    onMouseLeave={scheduleClose}
                    onClick={(e) => {
                        e.preventDefault();
                        setOpen((v) => !v);
                    }}
                    aria-expanded={open}
                    aria-haspopup="dialog"
                    aria-label={t("certificateStatus")}
                >
                    {triggerBody}
                </button>
            </PopoverAnchor>
            <PopoverContent
                className="w-72 p-4"
                align="start"
                side="bottom"
                sideOffset={6}
                onMouseEnter={clearCloseTimer}
                onMouseLeave={scheduleClose}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="space-y-3">
                    <CertificateStatusContent
                        cert={certificate.cert}
                        certLoading={certificate.certLoading}
                        certError={certificate.certError}
                        refreshing={certificate.refreshing}
                        refreshCert={certificate.refreshCert}
                        showLabel
                    />
                    <p className="text-sm text-muted-foreground">
                        {t("certificateStatusAutoRefreshHint")}
                    </p>
                </div>
            </PopoverContent>
        </Popover>
    );
}
