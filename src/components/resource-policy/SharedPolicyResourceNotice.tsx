"use client";

import { Alert, AlertDescription } from "@app/components/ui/alert";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { useResourcePolicyContext } from "@app/providers/ResourcePolicyProvider";
import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type SharedPolicyResourceNoticeProps = {
    section: "authentication" | "rules";
};

export function SharedPolicyResourceNotice({
    section
}: SharedPolicyResourceNoticeProps) {
    const t = useTranslations();
    const { org } = useOrgContext();
    const { policy } = useResourcePolicyContext();

    const messageKey =
        section === "authentication"
            ? "resourceSharedPolicyAuthenticationNotice"
            : "resourceSharedPolicyRulesNotice";

    return (
        <Alert variant="neutral">
            <InfoIcon className="h-4 w-4" />
            <AlertDescription>
                {t.rich(messageKey, {
                    policyName: policy.name,
                    policyLink: (chunks) => (
                        <Link
                            href={`/${org.org.orgId}/settings/policies/resources/public/${policy.niceId}/${section}`}
                            className="text-primary hover:underline"
                        >
                            {chunks}
                        </Link>
                    )
                })}
            </AlertDescription>
        </Alert>
    );
}
