import type { LauncherResource } from "@server/routers/launcher/types";

export function getPrivateResourceSettingsHref(
    orgId: string,
    niceId: string
): string {
    return `/${orgId}/settings/resources/private/${niceId}/general`;
}

export function getPublicResourceSettingsHref(
    orgId: string,
    niceId: string
): string {
    return `/${orgId}/settings/resources/public/${niceId}/general`;
}

export function getLauncherResourceAdminHref(
    orgId: string,
    resource: LauncherResource
): string {
    if (resource.resourceType === "public") {
        return getPublicResourceSettingsHref(orgId, resource.niceId);
    }

    return getPrivateResourceSettingsHref(orgId, resource.niceId);
}
