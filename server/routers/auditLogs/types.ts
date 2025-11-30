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