"use client";

import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, FormEvent, useEffect } from "react";
import BrandingLogo from "@app/components/BrandingLogo";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useLocalStorage } from "@app/hooks/useLocalStorage";
import { CheckboxWithLabel } from "@app/components/ui/checkbox";
import { ExternalLink } from "lucide-react";

export function OrgSelectionForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const t = useTranslations();
    const { env } = useEnvContext();
    const { isUnlocked } = useLicenseStatusContext();
    const [storedOrgId, setStoredOrgId] = useLocalStorage<string | null>(
        "org-selection:org-id",
        null
    );
    const [rememberOrgId, setRememberOrgId] = useLocalStorage<boolean>(
        "org-selection:remember",
        false
    );
    const [orgId, setOrgId] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Prefill org ID from storage if remember is enabled
    useEffect(() => {
        if (rememberOrgId && storedOrgId) {
            setOrgId(storedOrgId);
        }
    }, []);

    const logoWidth = isUnlocked()
        ? env.branding.logo?.authPage?.width || 175
        : 175;
    const logoHeight = isUnlocked()
        ? env.branding.logo?.authPage?.height || 44
        : 44;

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!orgId.trim()) return;

        setIsSubmitting(true);
        const trimmedOrgId = orgId.trim();

        // Save org ID to storage if remember is checked
        if (rememberOrgId) {
            setStoredOrgId(trimmedOrgId);
        } else {
            setStoredOrgId(null);
        }

        const queryString = buildQueryString(searchParams);
        const url = `/auth/org/${trimmedOrgId}${queryString}`;
        console.log(url);
        router.push(url);
    };

    return (
        <>
            <Card className="w-full max-w-md">
                <CardHeader className="border-b">
                    <div className="flex flex-row items-center justify-center">
                        <BrandingLogo height={logoHeight} width={logoWidth} />
                    </div>
                    <div className="text-center space-y-1 pt-3">
                        <p className="text-muted-foreground">
                            {t("orgAuthSelectOrgDescription")}
                        </p>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="org-id">{t("orgId")}</Label>
                            <Input
                                id="org-id"
                                type="text"
                                placeholder={t("orgAuthOrgIdPlaceholder")}
                                autoComplete="off"
                                value={orgId}
                                onChange={(e) => setOrgId(e.target.value)}
                                required
                                disabled={isSubmitting}
                            />
                            <p className="text-sm text-muted-foreground">
                                {t("orgAuthWhatsThis")}{" "}
                                <Link
                                    href="https://docs.pangolin.net/manage/organizations/org-id"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline inline-flex items-center gap-1"
                                >
                                    {t("learnMore")}
                                    <ExternalLink className="size-3.5 shrink-0" />
                                </Link>
                            </p>
                        </div>

                        <div className="pt-3">
                            <CheckboxWithLabel
                                id="remember-org-id"
                                label={t("orgAuthRememberOrgId")}
                                checked={rememberOrgId}
                                onCheckedChange={(checked) => {
                                    setRememberOrgId(checked === true);
                                    if (!checked) {
                                        setStoredOrgId(null);
                                    }
                                }}
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={isSubmitting || !orgId.trim()}
                        >
                            {t("continue")}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <p className="text-center text-muted-foreground mt-4">
                <Link
                    href={`/auth/login${buildQueryString(searchParams)}`}
                    className="underline"
                >
                    {t("loginBack")}
                </Link>
            </p>
        </>
    );
}

function buildQueryString(searchParams: URLSearchParams): string {
    const params = new URLSearchParams();
    if (searchParams.get("redirect")) {
        params.set("redirect", searchParams.get("redirect")!);
    }
    if (searchParams.get("forceLogin")) {
        params.set("forceLogin", searchParams.get("forceLogin")!);
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
}
