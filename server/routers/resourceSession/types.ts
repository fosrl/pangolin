import type { PaginatedResponse } from "@server/types/Pagination";

export const resourceSessionAuthMethods = [
    "sso",
    "password",
    "pincode",
    "whitelist",
    "accessToken"
] as const;

export type ResourceSessionAuthMethod =
    (typeof resourceSessionAuthMethods)[number];

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

export type ListResourceSessionsResponse = PaginatedResponse<{
    sessions: ResourceSessionItem[];
}>;
