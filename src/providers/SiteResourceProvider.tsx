"use client";

import SiteResourceContext, {
    type SiteResourceAccessState
} from "@app/contexts/siteResourceContext";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import {
    accessTagsToIds,
    type PrivateResourceAccessTag,
    type PrivateResourceClient,
    type SiteResourceData
} from "@app/lib/privateResourceForm";
import { orgQueries, resourceQueries } from "@app/lib/queries";
import { UserType } from "@server/types/UserTypes";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

type SiteResourceProviderProps = {
    children: React.ReactNode;
    siteResource: SiteResourceData;
};

export function SiteResourceProvider({
    children,
    siteResource: serverSiteResource
}: SiteResourceProviderProps) {
    const t = useTranslations();
    const [siteResource, setSiteResource] =
        useState<SiteResourceData>(serverSiteResource);

    useEffect(() => {
        setSiteResource(serverSiteResource);
    }, [serverSiteResource]);

    const resourceRolesQuery = useQuery(
        resourceQueries.siteResourceRoles({
            siteResourceId: siteResource.id
        })
    );
    const resourceUsersQuery = useQuery(
        resourceQueries.siteResourceUsers({
            siteResourceId: siteResource.id
        })
    );
    const resourceClientsQuery = useQuery(
        resourceQueries.siteResourceClients({
            siteResourceId: siteResource.id
        })
    );

    const access = useMemo<SiteResourceAccessState>(() => {
        const roles = (resourceRolesQuery.data ?? []) as {
            roleId: number;
            name: string;
        }[];
        const users = (resourceUsersQuery.data ?? []) as {
            userId: string;
        }[];
        const clients = (resourceClientsQuery.data ?? []) as {
            clientId: number;
        }[];

        return {
            roleIds: roles
                .filter((r) => r.name !== "Admin")
                .map((r) => r.roleId),
            userIds: users.map((u) => u.userId),
            clientIds: clients.map((c) => c.clientId)
        };
    }, [
        resourceRolesQuery.data,
        resourceUsersQuery.data,
        resourceClientsQuery.data
    ]);

    const [accessOverride, setAccessOverride] =
        useState<SiteResourceAccessState | null>(null);

    const resolvedAccess = accessOverride ?? access;

    const updateSiteResource = (updated: Partial<SiteResourceData>) => {
        if (!siteResource) {
            throw new Error(t("resourceErrorNoUpdate"));
        }
        setSiteResource((prev) => ({ ...prev, ...updated }));
    };

    return (
        <SiteResourceContext.Provider
            value={{
                siteResource,
                updateSiteResource,
                access: resolvedAccess,
                setAccess: setAccessOverride
            }}
        >
            {children}
        </SiteResourceContext.Provider>
    );
}

export function useAccessFormDefaults(orgId: string, siteResourceId: number) {
    const resourceRolesQuery = useQuery(
        resourceQueries.siteResourceRoles({ siteResourceId })
    );
    const resourceUsersQuery = useQuery(
        resourceQueries.siteResourceUsers({ siteResourceId })
    );
    const resourceClientsQuery = useQuery(
        resourceQueries.siteResourceClients({ siteResourceId })
    );
    const clientsQuery = useQuery(
        orgQueries.machineClients({
            orgId,
            perPage: 1
        })
    );

    const loading =
        resourceRolesQuery.isLoading ||
        resourceUsersQuery.isLoading ||
        resourceClientsQuery.isLoading;

    const roles: PrivateResourceAccessTag[] = (
        (resourceRolesQuery.data ?? []) as { roleId: number; name: string }[]
    )
        .map((i) => ({ id: i.roleId.toString(), text: i.name }))
        .filter((r) => r.text !== "Admin");

    const users: PrivateResourceAccessTag[] = (
        (resourceUsersQuery.data ?? []) as {
            userId: string;
            email?: string;
            username?: string;
            type?: string;
            idpName?: string;
        }[]
    ).map((i) => ({
        id: i.userId.toString(),
        text: `${getUserDisplayName({ email: i.email, username: i.username })}${i.type !== UserType.Internal ? ` (${i.idpName})` : ""}`
    }));

    const clients: PrivateResourceClient[] = [
        ...((resourceClientsQuery.data ?? []) as {
            clientId: number;
            name: string;
        }[])
    ];

    const allClients = (clientsQuery.data ?? []).filter((c) => !c.userId);

    return {
        loading,
        roles,
        users,
        clients,
        hasMachineClients: allClients.length > 0,
        accessIds: accessTagsToIds({ roles, users, clients })
    };
}

export default SiteResourceProvider;
