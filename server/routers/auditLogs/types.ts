export type QueryActionAuditLogResponse = {
    log: {
        orgId: string;
        action: string;
        actorType: string;
        actorId: string;
        metadata: string | null;
        timestamp: number;
        actor: string;
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
    filterAttributes: {
        actors: string[];
    };
};

export type QueryRequestAuditLogResponse = {
    log: {
        timestamp: number;
        action: boolean;
        reason: number;
        orgId: string | null;
        actorType: string | null;
        actor: string | null;
        actorId: string | null;
        resourceId: number | null;
        siteResourceId: number | null;
        resourceNiceId: string | null;
        resourceName: string | null;
        ip: string | null;
        location: string | null;
        userAgent: string | null;
        metadata: string | null;
        headers: string | null;
        query: string | null;
        originalRequestURL: string | null;
        scheme: string | null;
        host: string | null;
        path: string | null;
        method: string | null;
        tls: boolean | null;
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
    filterAttributes: {
        actors: string[];
        resources: {
            id: number;
            name: string | null;
        }[];
        locations: string[];
        hosts: string[];
        paths: string[];
    };
};

export type QueryAccessAuditLogResponse = {
    log: {
        orgId: string;
        action: boolean;
        actorType: string | null;
        actorId: string | null;
        resourceId: number | null;
        siteResourceId: number | null;
        resourceName: string | null;
        resourceNiceId: string | null;
        ip: string | null;
        location: string | null;
        userAgent: string | null;
        metadata: string | null;
        type: string;
        timestamp: number;
        actor: string | null;
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
    filterAttributes: {
        actors: string[];
        resources: {
            id: number;
            name: string | null;
        }[];
        locations: string[];
    };
};

export type QueryAiSessionLogResponse = {
    log: {
        id: number;
        sessionId: string;
        orgId: string | null;
        providerId: number | null;
        providerName: string | null;
        providerType: string | null;
        capability: string;
        resourceId: number | null;
        siteResourceId: number | null;
        resourceName: string | null;
        resourceNiceId: string | null;
        resourceType: "public" | "site" | null;
        userId: string | null;
        userEmail: string | null;
        virtualApiKeyId: string | null;
        virtualApiKeyName: string | null;
        virtualApiKeyLastChars: string | null;
        requestedModel: string | null;
        isStream: boolean;
        requestBody: string | null;
        responseBody: string | null;
        normalizedRequest: string | null;
        normalizedResponse: string | null;
        truncated: boolean;
        statusCode: number | null;
        createdAt: number;
        usage: {
            promptTokens: number;
            cacheReadTokens: number;
            cacheWriteTokens: number;
            completionTokens: number;
            reasoningTokens: number;
            totalTokens: number;
            costUsd: number | null;
            estimated: boolean;
        } | null;
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
    filterAttributes: {
        providers: {
            id: number;
            name: string | null;
        }[];
        resources: {
            id: number;
            name: string | null;
        }[];
        users: {
            id: string;
            email: string | null;
        }[];
        virtualApiKeys: {
            id: string;
            name: string | null;
            lastChars: string | null;
        }[];
        models: string[];
    };
};

export type QueryConnectionAuditLogResponse = {
    log: {
        sessionId: string;
        siteResourceId: number | null;
        orgId: string | null;
        siteId: number | null;
        clientId: number | null;
        clientEndpoint: string | null;
        userId: string | null;
        sourceAddr: string;
        destAddr: string;
        protocol: string;
        startedAt: number;
        endedAt: number | null;
        bytesTx: number | null;
        bytesRx: number | null;
        resourceName: string | null;
        resourceNiceId: string | null;
        siteName: string | null;
        siteNiceId: string | null;
        clientName: string | null;
        clientNiceId: string | null;
        clientType: string | null;
        userEmail: string | null;
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
    filterAttributes: {
        protocols: string[];
        destAddrs: string[];
        clients: {
            id: number;
            name: string;
        }[];
        resources: {
            id: number;
            name: string | null;
        }[];
        users: {
            id: string;
            email: string | null;
        }[];
    };
};
