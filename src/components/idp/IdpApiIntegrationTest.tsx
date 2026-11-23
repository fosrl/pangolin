"use client";

import { Button } from "@app/components/ui/button";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { CheckCircle2, PlugZap, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/** Same shape as `IdpApiTestResult` on the server. */
type ApiIntegrationTestResult = {
    ok: boolean;
    checks: {
        check: "token" | "users" | "groups";
        ok: boolean;
        error?: string;
    }[];
};

const CHECK_LABEL_KEYS = {
    token: "idpApiTestCheckToken",
    users: "idpApiTestCheckUsers",
    groups: "idpApiTestCheckGroups"
} as const;

type IdpApiIntegrationTestProps = {
    /** `/idp/:idpId` or `/org/:orgId/idp/:idpId`. */
    apiBase: string;
    /** The test runs on the saved credentials, so it needs the integration saved as enabled. */
    disabled?: boolean;
};

/** Tests the saved API integration credentials and shows each step's result. */
export default function IdpApiIntegrationTest({
    apiBase,
    disabled = false
}: IdpApiIntegrationTestProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<ApiIntegrationTestResult | null>(null);

    async function runTest() {
        setTesting(true);
        setResult(null);
        try {
            const res = await api.post<AxiosResponse<ApiIntegrationTestResult>>(
                `${apiBase}/api-integration/test`
            );
            setResult(res.data.data);
        } catch (e) {
            toast({
                title: t("idpApiTestError"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setTesting(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-col items-start gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={runTest}
                    loading={testing}
                    disabled={disabled || testing}
                    className="gap-2"
                >
                    <PlugZap className="size-4 flex-none" />
                    {t("idpApiTest")}
                </Button>
                <p className="text-sm text-muted-foreground">
                    {disabled
                        ? t("idpApiTestSaveFirst")
                        : t("idpApiTestDescription")}
                </p>
            </div>

            {result && (
                <div className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">
                        {result.ok
                            ? t("idpApiTestSuccess")
                            : t("idpApiTestFailed")}
                    </p>
                    <ul className="space-y-2">
                        {result.checks.map((check) => (
                            <li key={check.check} className="text-sm">
                                <div className="flex items-center gap-2">
                                    {check.ok ? (
                                        <CheckCircle2 className="size-4 flex-none text-green-600" />
                                    ) : (
                                        <XCircle className="size-4 flex-none text-destructive" />
                                    )}
                                    {t(CHECK_LABEL_KEYS[check.check])}
                                </div>
                                {check.error && (
                                    <p className="ml-6 break-words text-xs text-muted-foreground">
                                        {check.error}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
