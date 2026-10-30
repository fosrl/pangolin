// The role's stored client settings, as edited on the role's page. Null means
// the setting isn't managed by the server.
export type RoleClientSettingsValues = {
    enabled: boolean;
    overrideDns: boolean | null;
    mtu: number | null;
    tunnelDns: boolean | null;
    primaryDns: string | null;
    secondaryDns: string | null;
    exitNodeTakesPrecedence: boolean | null;
    exitNodeSiteResourceId: number | null;
    exitNodeLocked: boolean;
    matchDomains: string[] | null;
    preferLocalRoutes: boolean | null;
};

export type GetRoleClientSettingsResponse = RoleClientSettingsValues;
export type UpdateRoleClientSettingsResponse = RoleClientSettingsValues;
