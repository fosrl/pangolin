import type { Resource, ResourcePolicy } from "@server/db";

type InlinePolicyFields = Pick<
    ResourcePolicy,
    "sso" | "emailWhitelistEnabled" | "applyRules" | "idpId"
> &
    Partial<Pick<ResourcePolicy, "mtlsEnabled">>;

export function applyInlinePolicyFields<T extends Resource>(
    resource: T,
    policy: InlinePolicyFields | null | undefined
): T {
    return {
        ...resource,
        sso: policy?.sso ?? null,
        emailWhitelistEnabled: policy?.emailWhitelistEnabled ?? null,
        applyRules: policy?.applyRules ?? null,
        skipToIdpId: policy?.idpId ?? null,
        mtlsEnabled: policy?.mtlsEnabled ?? resource.mtlsEnabled
    };
}
