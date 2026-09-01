"use client";

import { orgQueries } from "@app/lib/queries";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDebounce } from "use-debounce";

const SEARCH_PER_PAGE = 5;
const MIN_QUERY_LENGTH = 2;

export type SiteSearchResult = {
    id: string;
    name: string;
    href: string;
};

export type ResourceSearchResult = {
    id: string;
    name: string;
    href: string;
};

export type UserSearchResult = {
    id: string;
    name: string;
    email: string;
    href: string;
};

export type ClientSearchResult = {
    id: string;
    name: string;
    href: string;
};

export function useCommandPaletteSearch({
    orgId,
    query,
    enabled
}: {
    orgId?: string;
    query: string;
    enabled: boolean;
}) {
    const [debouncedQuery] = useDebounce(query, 150);
    const trimmedQuery = debouncedQuery.trim();
    const shouldSearch =
        enabled && !!orgId && trimmedQuery.length >= MIN_QUERY_LENGTH;

    const [
        sitesQuery,
        proxyResourcesQuery,
        privateResourcesQuery,
        usersQuery,
        clientsQuery,
        userDevicesQuery
    ] = useQueries({
        queries: [
            {
                ...orgQueries.sites({
                    orgId: orgId ?? "",
                    query: trimmedQuery,
                    perPage: SEARCH_PER_PAGE
                }),
                enabled: shouldSearch
            },
            {
                ...orgQueries.proxyResources({
                    orgId: orgId ?? "",
                    query: trimmedQuery,
                    perPage: SEARCH_PER_PAGE
                }),
                enabled: shouldSearch
            },
            {
                ...orgQueries.privateResources({
                    orgId: orgId ?? "",
                    query: trimmedQuery,
                    perPage: SEARCH_PER_PAGE
                }),
                enabled: shouldSearch
            },
            {
                ...orgQueries.users({
                    orgId: orgId ?? "",
                    query: trimmedQuery,
                    perPage: SEARCH_PER_PAGE
                }),
                enabled: shouldSearch
            },
            {
                ...orgQueries.machineClients({
                    orgId: orgId ?? "",
                    query: trimmedQuery,
                    perPage: SEARCH_PER_PAGE
                }),
                enabled: shouldSearch
            },
            {
                ...orgQueries.userDevices({
                    orgId: orgId ?? "",
                    query: trimmedQuery,
                    perPage: SEARCH_PER_PAGE
                }),
                enabled: shouldSearch
            }
        ]
    });

    const sites = useMemo((): SiteSearchResult[] => {
        if (!orgId || !sitesQuery.data) return [];
        return sitesQuery.data.map((site) => ({
            id: `site-${site.siteId}`,
            name: site.name,
            href: `/${orgId}/settings/sites/${site.niceId}`
        }));
    }, [orgId, sitesQuery.data]);

    const publicResources = useMemo((): ResourceSearchResult[] => {
        if (!orgId || !proxyResourcesQuery.data) return [];
        return proxyResourcesQuery.data.map((resource) => ({
            id: `resource-${resource.resourceId}`,
            name: resource.name,
            href: `/${orgId}/settings/resources/proxy/${resource.niceId}`
        }));
    }, [orgId, proxyResourcesQuery.data]);

    const privateResources = useMemo((): ResourceSearchResult[] => {
        if (!orgId || !privateResourcesQuery.data) return [];
        return privateResourcesQuery.data.map((resource) => ({
            id: `site-resource-${resource.siteResourceId}`,
            name: resource.name,
            href: `/${orgId}/settings/resources/private/${resource.niceId}`
        }));
    }, [orgId, privateResourcesQuery.data]);

    const users = useMemo((): UserSearchResult[] => {
        if (!orgId || !usersQuery.data) return [];
        return usersQuery.data.map((user) => ({
            id: `user-${user.id}`,
            name: user.name ?? user.email ?? user.username ?? "",
            email: user.email ?? user.username ?? "",
            href: `/${orgId}/settings/access/users/${user.id}`
        }));
    }, [orgId, usersQuery.data]);

    const machineClients = useMemo((): ClientSearchResult[] => {
        if (!orgId || !clientsQuery.data) return [];
        return clientsQuery.data
            .filter((client) => !client.userId)
            .map((client) => ({
                id: `client-${client.clientId}`,
                name: client.name,
                href: `/${orgId}/settings/clients/machine/${client.niceId}`
            }));
    }, [orgId, clientsQuery.data]);

    const userDevices = useMemo((): ClientSearchResult[] => {
        if (!orgId || !userDevicesQuery.data) return [];
        return userDevicesQuery.data
            .filter((client) => !client.userId)
            .map((client) => ({
                id: `client-${client.clientId}`,
                name: client.name,
                href: `/${orgId}/settings/clients/user/${client.niceId}`
            }));
    }, [orgId, userDevicesQuery.data]);

    const isLoading =
        shouldSearch &&
        (sitesQuery.isFetching ||
            proxyResourcesQuery.isFetching ||
            privateResourcesQuery.isFetching ||
            usersQuery.isFetching ||
            userDevicesQuery.isFetching ||
            clientsQuery.isFetching);

    const hasResults =
        sites.length > 0 ||
        publicResources.length > 0 ||
        users.length > 0 ||
        privateResources.length > 0 ||
        userDevices.length > 0 ||
        machineClients.length > 0;

    return {
        debouncedQuery: trimmedQuery,
        shouldSearch,
        sites,
        publicResources,
        privateResources,
        users,
        machineClients,
        userDevices,
        isLoading,
        hasResults
    };
}
