import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { LimitOffsetPaginationSchema } from "@server/lib/openapi/pagination";
import {
    accessAuditLog,
    actionAuditLog,
    aiSessionLog,
    connectionAuditLog,
    requestAuditLog,
    sshCommandLog,
    sshSessionLog
} from "@server/db";

function idName<T extends z.ZodTypeAny>(idType: T) {
    return z.object({
        id: idType,
        name: z.string().nullable()
    });
}

const ActionAuditLogEntrySchema = createSelectSchema(actionAuditLog, {
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    action: (s) => s.openapi({ description: "The action that was performed." }),
    actorType: (s) =>
        s.openapi({
            description: "Kind of actor, for example user or api key."
        }),
    actorId: (s) => s.openapi({ description: "ID of the actor." }),
    metadata: (s) =>
        s.openapi({
            description:
                "Additional details about the action, as a JSON string."
        }),
    actor: (s) => s.openapi({ description: "Display name of the actor." })
}).pick({
    orgId: true,
    action: true,
    actorType: true,
    actorId: true,
    metadata: true,
    timestamp: true,
    actor: true
});

export const ActionAuditLogSchema = z.object({
    log: z.array(ActionAuditLogEntrySchema),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({ actors: z.array(z.string()) }).openapi({
        description: "Distinct values that can be used to filter the log."
    })
});
export type QueryActionAuditLogResponse = z.infer<typeof ActionAuditLogSchema>;

const RequestAuditLogEntrySchema = createSelectSchema(requestAuditLog, {
    action: (s) =>
        s.openapi({ description: "Whether the request was allowed." }),
    reason: (s) =>
        s.openapi({
            description:
                "Numeric code for why the request was allowed or blocked."
        }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    actorType: (s) =>
        s.openapi({ description: "Kind of actor that made the request." }),
    actor: (s) => s.openapi({ description: "Display name of the actor." }),
    actorId: (s) => s.openapi({ description: "ID of the actor." }),
    resourceId: (s) =>
        s.openapi({
            description: "ID of the public resource that was requested."
        }),
    siteResourceId: (s) =>
        s.openapi({
            description: "ID of the private resource that was requested."
        }),
    ip: (s) => s.openapi({ description: "IP address the request came from." }),
    location: (s) =>
        s.openapi({ description: "Country code of the IP address." }),
    userAgent: (s) => s.openapi({ description: "User agent of the client." }),
    metadata: (s) =>
        s.openapi({ description: "Additional details, as a JSON string." }),
    headers: (s) =>
        s.openapi({ description: "Request headers, as a JSON string." }),
    query: (s) =>
        s.openapi({
            description: "Query string parameters, as a JSON string."
        }),
    originalRequestURL: (s) =>
        s.openapi({ description: "Full URL that was requested." }),
    scheme: (s) => s.openapi({ description: "http or https." }),
    host: (s) => s.openapi({ description: "Host that was requested." }),
    path: (s) => s.openapi({ description: "Path that was requested." }),
    method: (s) => s.openapi({ description: "HTTP method." }),
    tls: (s) => s.openapi({ description: "Whether the request used TLS." })
})
    .pick({
        timestamp: true,
        action: true,
        reason: true,
        orgId: true,
        actorType: true,
        actor: true,
        actorId: true,
        resourceId: true,
        siteResourceId: true,
        ip: true,
        location: true,
        userAgent: true,
        metadata: true,
        headers: true,
        query: true,
        originalRequestURL: true,
        scheme: true,
        host: true,
        path: true,
        method: true,
        tls: true
    })
    .extend({
        resourceNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the resource." }),
        resourceName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the resource." })
    });

export const RequestAuditLogSchema = z.object({
    log: z.array(RequestAuditLogEntrySchema),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        actors: z.array(z.string()),
        resources: z.array(idName(z.number().int())),
        locations: z.array(z.string()),
        hosts: z.array(z.string()),
        paths: z.array(z.string())
    })
});
export type QueryRequestAuditLogResponse = z.infer<
    typeof RequestAuditLogSchema
>;

const AccessAuditLogEntrySchema = createSelectSchema(accessAuditLog, {
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    action: (s) => s.openapi({ description: "Whether access was granted." }),
    actorType: (s) =>
        s.openapi({ description: "Kind of actor that tried to get access." }),
    actorId: (s) => s.openapi({ description: "ID of the actor." }),
    resourceId: (s) => s.openapi({ description: "ID of the public resource." }),
    siteResourceId: (s) =>
        s.openapi({ description: "ID of the private resource." }),
    ip: (s) => s.openapi({ description: "IP address of the client." }),
    location: (s) =>
        s.openapi({ description: "Country code of the IP address." }),
    userAgent: (s) => s.openapi({ description: "User agent of the client." }),
    metadata: (s) =>
        s.openapi({ description: "Additional details, as a JSON string." }),
    type: (s) =>
        s.openapi({
            description:
                "How access was attempted, for example password, pincode, whitelist or sso."
        }),
    actor: (s) => s.openapi({ description: "Display name of the actor." })
})
    .pick({
        orgId: true,
        action: true,
        actorType: true,
        actorId: true,
        resourceId: true,
        siteResourceId: true,
        ip: true,
        location: true,
        userAgent: true,
        metadata: true,
        type: true,
        timestamp: true,
        actor: true
    })
    .extend({
        resourceName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the resource." }),
        resourceNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the resource." })
    });

export const AccessAuditLogSchema = z.object({
    log: z.array(AccessAuditLogEntrySchema),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        actors: z.array(z.string()),
        resources: z.array(idName(z.number().int())),
        locations: z.array(z.string())
    })
});
export type QueryAccessAuditLogResponse = z.infer<typeof AccessAuditLogSchema>;

const idEmail = z.object({ id: z.string(), email: z.string().nullable() });

const ConnectionAuditLogEntrySchema = createSelectSchema(connectionAuditLog, {
    sessionId: (s) =>
        s.openapi({ description: "ID of the connection session." }),
    siteResourceId: (s) =>
        s.openapi({ description: "ID of the private resource." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    siteId: (s) =>
        s.openapi({
            description: "ID of the site that carried the connection."
        }),
    clientId: (s) =>
        s.openapi({
            description: "ID of the client that opened the connection."
        }),
    clientEndpoint: (s) =>
        s.openapi({ description: "Public endpoint of the client." }),
    userId: (s) =>
        s.openapi({ description: "ID of the user that owns the client." }),
    sourceAddr: (s) =>
        s.openapi({ description: "Source address of the connection." }),
    destAddr: (s) =>
        s.openapi({ description: "Destination address of the connection." }),
    protocol: (s) =>
        s.openapi({
            description: "Transport protocol, for example tcp or udp."
        }),
    endedAt: (s) =>
        s.openapi({
            description:
                "Epoch seconds when the connection ended. Null while it is open."
        }),
    bytesTx: (s) =>
        s.openapi({ description: "Bytes sent through the connection." }),
    bytesRx: (s) =>
        s.openapi({ description: "Bytes received through the connection." })
})
    .pick({
        sessionId: true,
        siteResourceId: true,
        orgId: true,
        siteId: true,
        clientId: true,
        clientEndpoint: true,
        userId: true,
        sourceAddr: true,
        destAddr: true,
        protocol: true,
        startedAt: true,
        endedAt: true,
        bytesTx: true,
        bytesRx: true
    })
    .extend({
        resourceName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the private resource." }),
        resourceNiceId: z.string().nullable().openapi({
            description: "Human readable ID of the private resource."
        }),
        siteName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the site." }),
        siteNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the site." }),
        clientName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the client." }),
        clientNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the client." }),
        clientType: z
            .string()
            .nullable()
            .openapi({ description: "Kind of client." }),
        userEmail: z.string().nullable().openapi({
            description: "Email of the user that owns the client."
        })
    });

export const ConnectionAuditLogSchema = z.object({
    log: z.array(ConnectionAuditLogEntrySchema),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        protocols: z.array(z.string()),
        destAddrs: z.array(z.string()),
        clients: z.array(z.object({ id: z.number().int(), name: z.string() })),
        resources: z.array(idName(z.number().int())),
        users: z.array(idEmail)
    })
});
export type QueryConnectionAuditLogResponse = z.infer<
    typeof ConnectionAuditLogSchema
>;

const SshSessionLogEntrySchema = createSelectSchema(sshSessionLog, {
    id: (s) => s.openapi({ description: "Numeric ID of the log entry." }),
    sessionId: (s) => s.openapi({ description: "ID of the SSH session." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    siteId: (s) =>
        s.openapi({ description: "ID of the site that carried the session." }),
    siteResourceId: (s) =>
        s.openapi({ description: "ID of the private resource." }),
    resourceId: (s) => s.openapi({ description: "ID of the public resource." }),
    clientId: (s) =>
        s.openapi({ description: "ID of the client that opened the session." }),
    userId: (s) => s.openapi({ description: "ID of the user." }),
    transport: (s) =>
        s.openapi({
            description: 'How the session was opened: "ssh" or "browser".'
        }),
    sourceAddr: (s) =>
        s.openapi({ description: "Source address of the session." }),
    destAddr: (s) =>
        s.openapi({ description: "Destination address of the session." }),
    username: (s) =>
        s.openapi({ description: "Unix username used on the target." }),
    authMethod: (s) =>
        s.openapi({ description: "How the user authenticated." }),
    keyFingerprint: (s) =>
        s.openapi({ description: "Fingerprint of the SSH key used." }),
    certKeyId: (s) =>
        s.openapi({ description: "Key ID of the SSH certificate used." }),
    commandCount: (s) =>
        s.openapi({
            description: "Number of commands recorded in the session."
        }),
    endedAt: (s) =>
        s.openapi({
            description:
                "Epoch seconds when the session ended. Null while it is open."
        })
})
    .pick({
        id: true,
        sessionId: true,
        orgId: true,
        siteId: true,
        siteResourceId: true,
        resourceId: true,
        clientId: true,
        userId: true,
        transport: true,
        sourceAddr: true,
        destAddr: true,
        username: true,
        authMethod: true,
        keyFingerprint: true,
        certKeyId: true,
        commandCount: true,
        startedAt: true,
        endedAt: true
    })
    .extend({
        resourceType: z.enum(["site", "public"]).nullable().openapi({
            description:
                "site for a private resource, public for a public resource."
        }),
        resourceName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the resource." }),
        resourceNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the resource." }),
        siteName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the site." }),
        siteNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the site." }),
        clientName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the client." }),
        clientNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the client." }),
        clientType: z
            .string()
            .nullable()
            .openapi({ description: "Kind of client." }),
        userEmail: z
            .string()
            .nullable()
            .openapi({ description: "Email of the user." })
    });

export const SshSessionLogSchema = z.object({
    log: z.array(SshSessionLogEntrySchema),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        resources: z.array(
            idName(z.number().int()).extend({
                type: z.enum(["site", "public"])
            })
        ),
        sites: z.array(idName(z.number().int())),
        clients: z.array(z.object({ id: z.number().int(), name: z.string() })),
        users: z.array(idEmail),
        usernames: z.array(z.string())
    })
});
export type QuerySshSessionLogResponse = z.infer<typeof SshSessionLogSchema>;

const SshSessionCommandEntrySchema = createSelectSchema(sshCommandLog, {
    id: (s) => s.openapi({ description: "Numeric ID of the command." }),
    command: (s) => s.openapi({ description: "The command that was run." }),
    channel: (s) =>
        s.openapi({ description: "SSH channel the command ran on." }),
    inexact: (s) =>
        s.openapi({
            description:
                "Whether the command text was reconstructed and may not be exact."
        })
}).pick({
    id: true,
    command: true,
    channel: true,
    inexact: true,
    timestamp: true
});

export const SshSessionCommandsSchema = z.object({
    commands: z.array(SshSessionCommandEntrySchema),
    pagination: LimitOffsetPaginationSchema
});
export type QuerySshSessionCommandsResponse = z.infer<
    typeof SshSessionCommandsSchema
>;

const usage = z.object({
    promptTokens: z.number().int(),
    cacheReadTokens: z.number().int(),
    cacheWriteTokens: z.number().int(),
    completionTokens: z.number().int(),
    reasoningTokens: z.number().int(),
    totalTokens: z.number().int(),
    costUsd: z.number().nullable(),
    estimated: z.boolean()
});

const AiSessionLogEntrySchema = createSelectSchema(aiSessionLog, {
    id: (s) => s.openapi({ description: "Numeric ID of the log entry." }),
    sessionId: (s) => s.openapi({ description: "ID of the AI session." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." }),
    providerId: (s) => s.openapi({ description: "ID of the AI provider." }),
    capability: (s) =>
        s.openapi({
            description: "Kind of request, for example chat or embeddings."
        }),
    resourceId: (s) => s.openapi({ description: "ID of the public resource." }),
    siteResourceId: (s) =>
        s.openapi({ description: "ID of the private resource." }),
    userId: (s) =>
        s.openapi({ description: "ID of the user that made the request." }),
    virtualApiKeyId: (s) =>
        s.openapi({ description: "ID of the virtual API key used." }),
    requestedModel: (s) =>
        s.openapi({ description: "Model the client asked for." }),
    isStream: (s) =>
        s.openapi({ description: "Whether the response was streamed." }),
    requestBody: (s) =>
        s.openapi({ description: "Raw request body, when stored." }),
    responseBody: (s) =>
        s.openapi({ description: "Raw response body, when stored." }),
    normalizedRequest: (s) =>
        s.openapi({ description: "Request in a provider independent format." }),
    normalizedResponse: (s) =>
        s.openapi({
            description: "Response in a provider independent format."
        }),
    truncated: (s) =>
        s.openapi({ description: "Whether the stored bodies were cut off." }),
    statusCode: (s) =>
        s.openapi({ description: "HTTP status code returned by the provider." })
})
    .pick({
        id: true,
        sessionId: true,
        orgId: true,
        providerId: true,
        capability: true,
        resourceId: true,
        siteResourceId: true,
        userId: true,
        virtualApiKeyId: true,
        requestedModel: true,
        isStream: true,
        requestBody: true,
        responseBody: true,
        normalizedRequest: true,
        normalizedResponse: true,
        truncated: true,
        statusCode: true,
        createdAt: true
    })
    .extend({
        providerName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the AI provider." }),
        providerType: z
            .string()
            .nullable()
            .openapi({ description: "Type of the AI provider." }),
        resourceName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the resource." }),
        resourceNiceId: z
            .string()
            .nullable()
            .openapi({ description: "Human readable ID of the resource." }),
        resourceType: z.enum(["public", "site"]).nullable().openapi({
            description:
                "public for a public resource, site for a private resource."
        }),
        userEmail: z.string().nullable().openapi({
            description: "Email of the user that made the request."
        }),
        virtualApiKeyName: z
            .string()
            .nullable()
            .openapi({ description: "Name of the virtual API key used." }),
        virtualApiKeyLastChars: z.string().nullable().openapi({
            description: "Last characters of the virtual API key used."
        }),
        usage: usage.nullable().openapi({
            description:
                "Token usage and cost. Null when the provider did not report it."
        })
    });

export const AiSessionLogSchema = z.object({
    log: z.array(AiSessionLogEntrySchema),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        providers: z.array(idName(z.number().int())),
        resources: z.array(idName(z.number().int())),
        users: z.array(idEmail),
        virtualApiKeys: z.array(
            z.object({
                id: z.string(),
                name: z.string().nullable(),
                lastChars: z.string().nullable()
            })
        ),
        models: z.array(z.string())
    })
});
export type QueryAiSessionLogResponse = z.infer<typeof AiSessionLogSchema>;
