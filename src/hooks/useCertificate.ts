"use client";

import { useCallback } from "react";
import { GetCertificateResponse } from "@server/routers/certificates/types";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { domainQueries } from "@app/lib/queries";
import { durationToMs } from "@app/lib/durationToMs";

type UseCertificateProps = {
    orgId: string;
    domainId: string;
    fullDomain: string;
    polling?: boolean;
    pollingInterval?: number;
    initialCertValue?: GetCertificateResponse | null;
};

type UseCertificateReturn = {
    cert: GetCertificateResponse | null;
    certLoading: boolean;
    certError: string | null;
    refreshing: boolean;
    fetchCert: () => Promise<void>;
    refreshCert: () => Promise<void>;
    // clearCert: () => void;
};

const POLL_JITTER_MS = durationToMs(1, "seconds");
/** A valid cert isn't going anywhere soon, so check on it far less often. */
const VALID_POLL_INTERVAL_MS = durationToMs(30, "seconds");

export function useCertificate({
    orgId,
    domainId,
    fullDomain,
    initialCertValue,
    polling = false,
    pollingInterval = durationToMs(5, "seconds")
}: UseCertificateProps): UseCertificateReturn {
    const api = createApiClient(useEnvContext());
    const queryClient = useQueryClient();

    const certQuery = domainQueries.getCertificate({
        orgId,
        domainId,
        domain: fullDomain
    });

    const { data, isLoading, isError, refetch } = useQuery({
        ...certQuery,
        enabled: Boolean(orgId && domainId && fullDomain),
        refetchInterval: (query) => {
            if (!polling) return false;
            const interval =
                query.state.data?.status === "valid"
                    ? VALID_POLL_INTERVAL_MS
                    : pollingInterval;
            // Add a small random offset to each tick. Without it, every row in
            // a table would poll at the exact same instant, hitting the server
            // in bursts instead of spreading the requests out.
            // the requests will be jittered by less or more than 1s
            const jitter = (Math.random() * 2 - 1) * POLL_JITTER_MS;
            return Math.max(1000, interval + jitter);
        },
        // An explicit `null` is a real answer ("this domain has no certificate")
        // and is seeded like any other, so a server-prefetched row doesn't
        // refetch on mount. Only an omitted prop leaves the cache empty.
        ...(initialCertValue !== undefined && { initialData: initialCertValue })
    });

    const cert = data ?? null;

    const restartCert = useMutation({
        mutationFn: async (certId: number) => {
            await api.post(`/org/${orgId}/certificate/${certId}/restart`, {});
        },
        onSuccess: () => {
            // the backend flips the status asynchronously; reflect it optimistically
            setTimeout(() => {
                queryClient.setQueryData(certQuery.queryKey, (prev) =>
                    prev ? { ...prev, status: "pending" } : prev
                );
            }, 500);
        },
        onError: (error) => {
            console.error("Failed to restart certificate:", error);
        }
    });

    const fetchCert = useCallback(async () => {
        await refetch();
    }, [refetch]);

    const { mutateAsync: restartCertAsync } = restartCert;
    const refreshCert = useCallback(async () => {
        if (!cert) return;

        try {
            await restartCertAsync(cert.certId);
        } catch {
            // surfaced through certError
        }
    }, [cert, restartCertAsync]);

    // const clearCert = useCallback(() => {
    //     queryClient.removeQueries({ queryKey: certQuery.queryKey });
    // }, [queryClient, certQuery.queryKey]);

    let certError: string | null = null;
    if (restartCert.isError) {
        certError = "Failed to restart";
    } else if (isError || (!isLoading && data === null)) {
        // Null value means failed to get the certificate
        certError = "Failed";
    }

    return {
        cert,
        certLoading: isLoading,
        certError,
        refreshing: restartCert.isPending,
        fetchCert,
        refreshCert
        // clearCert
    };
}
