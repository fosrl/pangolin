import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { cache } from "react";
import { GetOrgResponse } from "@server/routers/org";
import OrgProvider from "@app/providers/OrgProvider";
import VirtualApiKeysTable, {
    type VirtualApiKeyRow
} from "@app/components/VirtualApiKeysTable";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { ListVirtualApiKeysResponse } from "@server/routers/virtualApiKey/types";
import type { ListUsersResponse } from "@server/routers/user";
import type { ListResourcesResponse } from "@server/routers/resource";

export const metadata: Metadata = {
    title: "Virtual Keys"
};

type VirtualApiKeysTablePageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function VirtualApiKeysTablePage(
    props: VirtualApiKeysTablePageProps
) {
    const params = await props.params;
    const cookieHeader = await authCookieHeader();
    const t = await getTranslations();

    let keys: ListVirtualApiKeysResponse["virtualApiKeys"] = [];
    let users: {
        userId: string;
        email: string | null;
        name: string | null;
        username: string | null;
    }[] = [];
    let resources: {
        resourceId: number;
        name: string;
        niceId: string;
    }[] = [];

    try {
        const [keysRes, usersRes, resourcesRes] = await Promise.all([
            internal.get<AxiosResponse<ListVirtualApiKeysResponse>>(
                `/org/${params.orgId}/virtual-api-keys?page=1&pageSize=1000`,
                cookieHeader
            ),
            internal.get<AxiosResponse<ListUsersResponse>>(
                `/org/${params.orgId}/users?page=1&pageSize=1000`,
                cookieHeader
            ),
            internal.get<AxiosResponse<ListResourcesResponse>>(
                `/org/${params.orgId}/resources?page=1&pageSize=1000`,
                cookieHeader
            )
        ]);

        keys = keysRes.data.data.virtualApiKeys ?? [];
        users = (usersRes.data.data.users ?? []).map((u) => ({
            userId: u.id,
            email: u.email ?? null,
            name: u.name ?? null,
            username: u.username ?? null
        }));
        resources = (resourcesRes.data.data.resources ?? []).map((r) => ({
            resourceId: r.resourceId,
            name: r.name,
            niceId: r.niceId
        }));
    } catch {
        // leave empty; page still renders
    }

    let org = null;
    try {
        const getOrg = cache(async () =>
            internal.get<AxiosResponse<GetOrgResponse>>(
                `/org/${params.orgId}`,
                cookieHeader
            )
        );
        const res = await getOrg();
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    if (!org) {
        redirect(`/${params.orgId}/settings/resources`);
    }

    const userById = new Map(users.map((u) => [u.userId, u]));
    const resourceById = new Map(resources.map((r) => [r.resourceId, r]));

    const rows: VirtualApiKeyRow[] = keys.map((key) => {
        const user = key.userId ? userById.get(key.userId) : undefined;
        const keyResources = key.resourceIds
            .map((id) => resourceById.get(id))
            .filter(Boolean) as {
            resourceId: number;
            name: string;
            niceId: string;
        }[];

        const resourceNames = key.allResources
            ? t("virtualApiKeysAllResources")
            : keyResources.map((r) => r.name).join(", ") ||
              t("virtualApiKeysNoResources");

        return {
            virtualApiKeyId: key.virtualApiKeyId,
            orgId: key.orgId,
            kind: key.kind,
            userId: key.userId,
            name: key.name,
            description: key.description,
            lastChars: key.lastChars,
            allResources: key.allResources,
            expiresAt: key.expiresAt,
            lastUsedAt: key.lastUsedAt,
            createdAt: key.createdAt,
            createdByUserId: key.createdByUserId,
            resourceIds: key.resourceIds,
            userName: user?.name ?? null,
            username: user?.username ?? null,
            userEmail: user?.email ?? null,
            resourceNames,
            resources: keyResources
        };
    });

    return (
        <OrgProvider org={org}>
            <VirtualApiKeysTable virtualApiKeys={rows} orgId={params.orgId} />
        </OrgProvider>
    );
}
