"use client";

import GoogleIDPAPIConfigFields from "@app/components/GoogleIDPAPIConfigFields";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SwitchInput } from "@app/components/SwitchInput";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";

type ApiIntegrationConfigWidgetProps = {
    variant: "google" | "azure";
    apiIntegrationEnabled: boolean;
    onApiIntegrationEnabledChange: (checked: boolean) => void;
    /** Service account of the stored Google key, the key field becomes optional when set. */
    configuredServiceAccountEmail?: string;
    disabled?: boolean;
    switchId?: string;
};

// Must be rendered inside the `<Form>` of a form with `GoogleDirectorySyncFormValues` fields.
export default function ApiIntegrationConfigWidget({
    variant,
    apiIntegrationEnabled,
    onApiIntegrationEnabledChange,
    configuredServiceAccountEmail,
    disabled = false,
    switchId = "api-integration-toggle"
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
        </div>
    );
}
