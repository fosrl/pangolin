"use client";

import { useEnvContext } from "@app/hooks/useEnvContext";
import { useSiteResourceContext } from "@app/hooks/useSiteResourceContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { getPrivateResourceSettingsHref } from "@app/lib/launcherResourceAdminHref";
import {
    buildUpdateSiteResourcePayload,
    mergeFormValuesWithResource,
    type PrivateResourceFormValues
} from "@app/lib/privateResourceForm";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export function useSaveSiteResource() {
    const t = useTranslations();
    const router = useRouter();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { siteResource, updateSiteResource, access } =
        useSiteResourceContext();

    async function save(
        partial: Partial<PrivateResourceFormValues>,
        options?: { successMessage?: string }
    ) {
        const merged = mergeFormValuesWithResource(siteResource, partial);
        const isNativeSsh =
            merged.mode === "ssh" && merged.authDaemonMode === "native";
        const trimmedDestination = merged.destination?.trim();

        const payload = buildUpdateSiteResourcePayload(
            {
                ...merged,
                destination: isNativeSsh
                    ? null
                    : trimmedDestination && trimmedDestination.length > 0
                      ? trimmedDestination
                      : null
            },
            access
        );

        try {
            await api.post(`/site-resource/${siteResource.id}`, payload);

            updateSiteResource({
                name: merged.name,
                niceId: merged.niceId ?? siteResource.niceId,
                enabled: merged.enabled ?? siteResource.enabled,
                siteIds: merged.siteIds,
                mode: merged.mode,
                destination: merged.destination ?? null,
                alias: merged.alias ?? null,
                destinationPort: merged.destinationPort ?? null,
                scheme: merged.scheme ?? siteResource.scheme,
                ssl: merged.ssl ?? siteResource.ssl,
                subdomain: merged.httpConfigSubdomain ?? null,
                domainId: merged.httpConfigDomainId ?? null,
                fullDomain: merged.httpConfigFullDomain ?? null,
                tcpPortRangeString: merged.tcpPortRangeString ?? null,
                udpPortRangeString: merged.udpPortRangeString ?? null,
                disableIcmp: merged.disableIcmp ?? false,
                authDaemonMode: merged.authDaemonMode ?? null,
                authDaemonPort: merged.authDaemonPort ?? null,
                pamMode: merged.pamMode ?? null
            });

            toast({
                title: t("editInternalResourceDialogSuccess"),
                description:
                    options?.successMessage ??
                    t(
                        "editInternalResourceDialogInternalResourceUpdatedSuccessfully"
                    )
            });

            if (merged.niceId && merged.niceId !== siteResource.niceId) {
                router.replace(
                    getPrivateResourceSettingsHref(
                        siteResource.orgId,
                        merged.niceId
                    )
                );
            }

            router.refresh();
            return true;
        } catch (error) {
            toast({
                title: t("editInternalResourceDialogError"),
                description: formatAxiosError(
                    error,
                    t(
                        "editInternalResourceDialogFailedToUpdateInternalResource"
                    )
                ),
                variant: "destructive"
            });
            return false;
        }
    }

    return { save, siteResource, access };
}
