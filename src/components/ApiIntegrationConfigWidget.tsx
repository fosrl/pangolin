"use client";

import GoogleIDPAPIConfigFields from "@app/components/GoogleIDPAPIConfigFields";
import IdpApiIntegrationTest from "@app/components/idp/IdpApiIntegrationTest";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SwitchInput } from "@app/components/SwitchInput";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";
import type { APIIntegrationVariant } from "@app/lib/idpApiConfig";

type ApiIntegrationConfigWidgetProps = {
    variant: APIIntegrationVariant;
    apiIntegrationEnabled: boolean;
    onApiIntegrationEnabledChange: (checked: boolean) => void;
    /** Service account of the stored Google key, the key field becomes optional when set. */
    configuredServiceAccountEmail?: string;
    disabled?: boolean;
    switchId?: string;
    /**
     * `/idp/:idpId` or `/org/:orgId/idp/:idpId`: shows the "Test API Integration"
     * button. Omit it when the IdP doesn't exist yet (create pages).
     */
    testApiBase?: string;
    /** The credentials in the form to test, `null` when the form is invalid (see `IdpApiIntegrationTest`). */
    getTestDraft?: () => Record<string, unknown> | null;
};

// Must be rendered inside the `<Form>` of a form with `GoogleDirectorySyncFormValues` fields.
export default function ApiIntegrationConfigWidget({
    variant,
    apiIntegrationEnabled,
    onApiIntegrationEnabledChange,
    configuredServiceAccountEmail,
    disabled = false,
    switchId = "api-integration-toggle",
    testApiBase,
    getTestDraft
}: ApiIntegrationConfigWidgetProps) {
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    // without the plan it can't be turned on, but it can still be turned off after a downgrade
    const paywalled =
        !isPaidUser(tierMatrix.idpAPIIntegration) && !apiIntegrationEnabled;

    return (
        <div className="space-y-4">
            <PaidFeaturesAlert tiers={tierMatrix.idpAPIIntegration} />
            <SwitchInput
                id={switchId}
                label={t("idpApiIntegrationEnable")}
                checked={apiIntegrationEnabled}
                onCheckedChange={onApiIntegrationEnabledChange}
                disabled={disabled || paywalled}
            />

            {apiIntegrationEnabled && variant === "google" && (
                <GoogleIDPAPIConfigFields
                    configuredServiceAccountEmail={
                        configuredServiceAccountEmail
                    }
                />
            )}

            {apiIntegrationEnabled && variant === "azure" && (
                <p className="text-sm text-muted-foreground">
                    {t("idpApiIntegrationAzureCredentials")}
                </p>
            )}

            {apiIntegrationEnabled && testApiBase && getTestDraft && (
                <IdpApiIntegrationTest
                    apiBase={testApiBase}
                    getDraft={getTestDraft}
                />
            )}
        </div>
    );
}
