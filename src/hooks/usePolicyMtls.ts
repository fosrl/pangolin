import ResourceContext from "@app/contexts/resourceContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";
import { orgQueries } from "@app/lib/queries";
import { useResourcePolicyContext } from "@app/providers/ResourcePolicyProvider";
import { resourceModeSupportsMtls } from "@server/lib/mtlsModes";
import { useQuery } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useContext, useEffect, useState } from "react";

// mTLS is set on the policy being edited, like the other auth methods. When
// editing in the context of a resource it doesn't apply to TCP/UDP resources.
export function usePolicyMtls() {
    const { policy, updatePolicy } = useResourcePolicyContext();
    const resourceContext = useContext(ResourceContext);
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const resource = resourceContext?.resource;

    const supported = !resource || resourceModeSupportsMtls(resource.mode);

    const { data: certificates = [], isLoading: isLoadingCertificates } =
        useQuery({
            ...orgQueries.resourcePolicyMtlsCertificates({
                resourcePolicyId: policy.resourcePolicyId
            }),
            enabled: supported
        });

    const [enabled, setEnabled] = useState(policy.mtlsEnabled);

    // The server switches mTLS off when the last CA is removed.
    useEffect(() => {
        setEnabled(policy.mtlsEnabled);
    }, [policy.mtlsEnabled]);

    const hasCertificates = certificates.length > 0;
    const isDirty = supported && enabled !== policy.mtlsEnabled;

    async function save(): Promise<AxiosResponse | void> {
        if (!supported || !isDirty) return;
        const res = await api.put(
            `/resource-policy/${policy.resourcePolicyId}`,
            { mtlsEnabled: enabled }
        );
        updatePolicy({ mtlsEnabled: enabled });
        return res;
    }

    return {
        supported,
        // A policy page has no single resource; there it applies to the
        // policy's resources that have SSL enabled.
        sslEnabled: resource ? Boolean(resource.ssl) : true,
        enabled,
        setEnabled,
        certificates,
        isLoadingCertificates,
        hasCertificates,
        isDirty,
        save
    };
}
