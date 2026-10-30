// The client settings an org applies to a user's devices, resolved from the
// roleClientSettings table. Clients fetch these from
// GET /org/:orgId/my-client-settings each time they connect and when their
// settings are opened. An absent field is not managed by the server: the client
// uses its own value for it.
export type ClientSettings = {
    overrideDns?: boolean;
    mtu?: number;
    tunnelDns?: boolean;
    primaryDns?: string;
    secondaryDns?: string;
    exitNodeTakesPrecedence?: boolean;
    exitNodeSiteResourceId?: number;
    exitNodeLocked?: boolean;
    matchDomains?: string[];
    preferLocalRoutes?: boolean;
};

// Client settings are an enterprise feature; this is the OSS stub of
// server/private/lib/clientSettings.ts.
export async function getClientSettingsForUser(
    orgId: string,
    userId: string
): Promise<ClientSettings | undefined> {
    return undefined;
}
