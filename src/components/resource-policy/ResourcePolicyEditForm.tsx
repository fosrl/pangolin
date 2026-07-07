"use client";

import { useResourceContext } from "@app/hooks/useResourceContext";
import { resourceQueries } from "@app/lib/queries";
import { ResourcePolicyProvider } from "@app/providers/ResourcePolicyProvider";
import { useQuery } from "@tanstack/react-query";
import { EditPolicyForm, type EditPolicyFormSection } from "./EditPolicyForm";

type ResourcePolicyEditFormProps = {
    section: Extract<EditPolicyFormSection, "authentication" | "rules">;
};

export function ResourcePolicyEditForm({
    section
}: ResourcePolicyEditFormProps) {
    const { resource } = useResourceContext();

    const { data: policies, isLoading: isLoadingPolicies } = useQuery(
        resourceQueries.policies({
            resourceId: resource.resourceId
        })
    );

    if (isLoadingPolicies || !policies) {
        return <></>;
    }

    if (!policies.sharedPolicy) {
        return (
            <ResourcePolicyProvider policy={policies.defaultPolicy}>
                <EditPolicyForm hidePolicyNameForm section={section} />
            </ResourcePolicyProvider>
        );
    }

    return (
        <ResourcePolicyProvider
            policy={policies.sharedPolicy}
            key={policies.sharedPolicy.resourcePolicyId}
        >
            <EditPolicyForm
                resourceId={resource.resourceId}
                section={section}
            />
        </ResourcePolicyProvider>
    );
}
