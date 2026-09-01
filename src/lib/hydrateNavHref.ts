export type NavHrefParams = {
    orgId?: string;
    niceId?: string;
    resourceId?: string;
    userId?: string;
    apiKeyId?: string;
    clientId?: string;
};

export function hydrateNavHref(
    val: string | undefined,
    params: NavHrefParams
): string | undefined {
    if (!val) return undefined;
    return val
        .replace("{orgId}", params.orgId ?? "")
        .replace("{niceId}", params.niceId ?? "")
        .replace("{resourceId}", params.resourceId ?? "")
        .replace("{userId}", params.userId ?? "")
        .replace("{apiKeyId}", params.apiKeyId ?? "")
        .replace("{clientId}", params.clientId ?? "");
}

export function navHrefParamsFromRoute(
    params: Record<string, string | string[] | undefined>
): NavHrefParams {
    return {
        orgId: params.orgId as string | undefined,
        niceId: params.niceId as string | undefined,
        resourceId: params.resourceId as string | undefined,
        userId: params.userId as string | undefined,
        apiKeyId: params.apiKeyId as string | undefined,
        clientId: params.clientId as string | undefined
    };
}
