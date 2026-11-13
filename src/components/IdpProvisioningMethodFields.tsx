"use client";

import DirectorySyncConfigWidget from "@app/components/DirectorySyncConfigWidget";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { SwitchInput } from "@app/components/SwitchInput";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { useTranslations } from "next-intl";
import { useFormContext } from "react-hook-form";

export type IdpProvisioningMethodFormValues = {
    allowManualProvisioning: boolean;
    autoProvision: boolean;
    apiIntegrationEnabled: boolean;
    directorySyncEnabled: boolean;
    directorySyncDeletions: boolean;
};

type IdpProvisioningMethodFieldsProps = {
    /** Directory sync is only offered for providers with an API integration (google/azure). */
    syncAvailable: boolean;
    /** Org IdPs need a paid tier for JIT, global IdPs don't. */
    jitPaywalled?: boolean;
};

/** Manual, JIT and sync toggles. */
// Must be rendered inside the `<Form>` of a form with `IdpProvisioningMethodFormValues` fields.
export default function IdpProvisioningMethodFields({
    syncAvailable,
    jitPaywalled = true
}: IdpProvisioningMethodFieldsProps) {
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const form = useFormContext<IdpProvisioningMethodFormValues>();

    const apiIntegrationEnabled = form.watch("apiIntegrationEnabled");

    return (
        <div className="space-y-6">
            <SwitchInput
                id="manual-provisioning-toggle"
                label={t("idpProvisioningManual")}
                description={t("idpProvisioningManualDescription")}
                checked={form.watch("allowManualProvisioning")}
                onCheckedChange={(checked) =>
                    form.setValue("allowManualProvisioning", checked)
                }
            />

            <div className="space-y-4">
                {jitPaywalled && (
                    <PaidFeaturesAlert tiers={tierMatrix.autoProvisioning} />
                )}
                <SwitchInput
                    id="auto-provision-toggle"
                    label={t("idpProvisioningJit")}
                    description={t("idpProvisioningJitDescription")}
                    checked={form.watch("autoProvision")}
                    onCheckedChange={(checked) =>
                        form.setValue("autoProvision", checked)
                    }
                    disabled={
                        jitPaywalled && !isPaidUser(tierMatrix.autoProvisioning)
                    }
                />
            </div>

            {syncAvailable && (
                <DirectorySyncConfigWidget
                    directorySyncEnabled={form.watch("directorySyncEnabled")}
                    onDirectorySyncEnabledChange={(checked) =>
                        form.setValue("directorySyncEnabled", checked)
                    }
                    directorySyncDescription={
                        apiIntegrationEnabled
                            ? t("idpDirectorySyncDescription")
                            : t("idpDirectorySyncRequiresApiIntegration")
                    }
                    disabled={!apiIntegrationEnabled}
                    syncDeletions={form.watch("directorySyncDeletions")}
                    onSyncDeletionsChange={(checked) =>
                        form.setValue("directorySyncDeletions", checked)
                    }
                />
            )}
        </div>
    );
}
