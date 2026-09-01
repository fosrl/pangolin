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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { logoutProxy } from "@app/actions/server";

type OrgPolicyRequiredProps = {
    orgId: string;
    policies: {
        requiredTwoFactor?: boolean;
        maxSessionLength?: {
            compliant: boolean;
            maxSessionLengthHours: number;
            sessionAgeHours: number;
        };
        passwordAge?: {
            compliant: boolean;
            maxPasswordAgeDays: number;
            passwordAgeDays: number;
        };
    };
    redirectAfterAuth?: string;
};

export default function OrgPolicyRequired({
    orgId,
    policies,
    redirectAfterAuth
}: OrgPolicyRequiredProps) {
    const t = useTranslations();
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const sessionExpired =
        policies?.maxSessionLength &&
        policies.maxSessionLength.compliant === false;

    async function reauthenticate() {
        setLoading(true);
        try {
            await logoutProxy();
        } catch (error) {
            console.error("Error during logout:", error);
        } finally {
            const destination = redirectAfterAuth ?? `/${orgId}`;
            router.push(destination);
            router.refresh();
        }
    }

    if (sessionExpired) {
        return (
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
                        <Shield className="h-6 w-6 text-orange-600" />
                    </div>
                    <CardTitle className="text-xl font-semibold">
                        {t("sessionExpired")}
                    </CardTitle>
                    <CardDescription>
                        {t("sessionExpiredReauthRequired")}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="pt-4">
                        <Button
                            className="w-full"
                            onClick={reauthenticate}
                            loading={loading}
                        >
                            {t("reauthenticate")}
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
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
