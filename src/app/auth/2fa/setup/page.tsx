"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card";
import TwoFactorSetupForm from "@app/components/TwoFactorSetupForm";
import { useTranslations } from "next-intl";
import {
    cleanOAuthRedirectOptions,
    cleanRedirect
} from "@app/lib/cleanRedirect";

export default function Setup2FAPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirect = searchParams?.get("redirect");
    const email = searchParams?.get("email");

    const t = useTranslations();

    // Redirect to login if no email is provided
    useEffect(() => {
        if (!email) {
            router.push("/auth/login");
        }
    }, [email, router]);

    const handleComplete = () => {
        console.log("2FA setup complete", redirect, email);
        if (redirect) {
            const cleanUrl = cleanRedirect(
                redirect,
                cleanOAuthRedirectOptions(redirect)
            );
            router.push(cleanUrl);
        } else {
            router.push("/");
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>{t("otpSetup")}</CardTitle>
                    <CardDescription>
                        {t("adminEnabled2FaOnYourAccount", {
                            email: email || "your account"
                        })}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <TwoFactorSetupForm
                        email={email || undefined}
                        onComplete={handleComplete}
                        submitButtonText="Continue"
                        showCancelButton={false}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
