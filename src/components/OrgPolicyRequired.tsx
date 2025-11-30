"use client";

import { Button } from "@app/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Shield, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type OrgPolicyRequiredProps = {
    orgId: string;
    policies: {
        requiredTwoFactor?: boolean;
    };
};

export default function OrgPolicyRequired({
    orgId,
    policies
}: OrgPolicyRequiredProps) {
    const t = useTranslations();

    const policySteps = [];

    if (policies?.requiredTwoFactor === false) {
        policySteps.push(t("enableTwoFactorAuthentication"));
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
                    <Shield className="h-6 w-6 text-orange-600" />
                </div>
                <CardTitle className="text-xl font-semibold">
                    {t("additionalSecurityRequired")}
                </CardTitle>
                <CardDescription>
                    {t("organizationRequiresAdditionalSteps")}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="pt-4">
                    <Link href={`/${orgId}`}>
                        <Button className="w-full">
                            {t("completeSecuritySteps")}
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </Link>
                </div>
            </CardContent>
        </Card>
    );
}
