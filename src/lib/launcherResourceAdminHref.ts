import type { LauncherResource } from "@server/routers/launcher/types";

export function getPrivateResourceSettingsHref(
    orgId: string,
    niceId: string
): string {
    return `/${orgId}/settings/resources/private/${niceId}/general`;
}

export function getLauncherResourceAdminHref(
    orgId: string,
    resource: LauncherResource
): string {
    if (resource.resourceType === "public") {
        return `/${orgId}/settings/resources/public/${resource.niceId}/general`;
    }

    return getPrivateResourceSettingsHref(orgId, resource.niceId);
}
