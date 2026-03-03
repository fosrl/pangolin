export type OAuthClient = {
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    backchannelLogoutUri: string | null;
    postLogoutRedirectUris: string[] | null;
    redirectUris: string[];
    scopes: string;
    pkceRequired: boolean;
    enabled: boolean;
    orgId: string;
    createdAt: number;
    updatedAt: number;
    lastChars: string;
};
