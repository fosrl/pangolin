import type { LauncherResource } from "@server/routers/launcher/types";

export function getLauncherResourceAdminHref(
    orgId: string,
    resource: LauncherResource
): string {
    if (resource.resourceType === "public") {
        return `/${orgId}/settings/resources/public/${resource.niceId}/general`;
    }

    const qs = new URLSearchParams({ query: resource.niceId });
    if (resource.site?.siteId != null) {
        qs.set("siteId", String(resource.site.siteId));
    }

    return `/${orgId}/settings/resources/private?${qs.toString()}`;
}
