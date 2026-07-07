"use client";

import {
    SettingsContainer,
} from "@app/components/Settings";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { resourceQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import {
    ProxyResourceTargetsForm
} from "@app/app/[orgId]/settings/resources/public/ProxyResourceTargetsForm";
import {
    use,
} from "react";

export default function ReverseProxyTargetsPage(props: {
    params: Promise<{ resourceId: number; orgId: string }>;
}) {
    const params = use(props.params);
    const { resource, updateResource } = useResourceContext();

    const { data: remoteTargets = [], isLoading: isLoadingTargets } = useQuery(
        resourceQueries.resourceTargets({
            resourceId: resource.resourceId
        })
    );

    if (isLoadingTargets) {
        return null;
    }

    return (
        <SettingsContainer>
            <ProxyResourceTargetsForm
                orgId={params.orgId}
                isHttp={["http", "ssh", "rdp", "vnc"].includes(resource.mode)}
                initialTargets={remoteTargets}
                resource={resource}
                updateResource={updateResource}
            />
        </SettingsContainer>
    );
}