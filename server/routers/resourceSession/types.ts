export type ResourceSessionAuthMethod =
    "sso" | "password" | "pincode" | "whitelist" | "accessToken";

export type ResourceSessionItem = {
    sessionId: string;
    resourceId: number;
    resourceName: string;
    resourceNiceId: string;
    authMethod: ResourceSessionAuthMethod | null;
    issuedAt: number | null;
    expiresAt: number;
    user: {
        userId: string;
        username: string;
        name: string | null;
        email: string | null;
    } | null;
    // Set for email whitelist sessions, which have no user record
    email: string | null;
    accessTokenId: string | null;
    accessTokenTitle: string | null;
};

export type ListResourceSessionsResponse = {
    sessions: ResourceSessionItem[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};
