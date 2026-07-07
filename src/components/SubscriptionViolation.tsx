"use client";

import { Button } from "@app/components/ui/button";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

interface SubscriptionViolationProps {
    billingHref?: string | null;
    canViewBilling?: boolean;
}

export default function SubscriptionViolation({
    billingHref,
    canViewBilling = false
}: SubscriptionViolationProps) {
    const context = useSubscriptionStatusContext();
    const [isDismissed, setIsDismissed] = useState(false);
    const t = useTranslations();

    if (!context?.limitsExceeded || isDismissed) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 w-full bg-amber-600 text-white p-4 text-center z-50">
            <div className="flex flex-wrap justify-center items-center gap-2 sm:gap-4">
                <p className="text-sm sm:text-base">
                    {t("subscriptionViolationMessage")}
                </p>
                <div className="flex items-center gap-2">
                    {canViewBilling && billingHref && (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="bg-white/20 hover:bg-white/30 text-white border-0"
                            asChild
                        >
                            <Link href={billingHref}>
                                {t("subscriptionViolationViewBilling")}
                            </Link>
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="hover:bg-white/20 text-white"
                        onClick={() => setIsDismissed(true)}
                    >
                        {t("dismiss")}
                    </Button>
                </div>
            </div>
        </div>
    );
}
