import "@server/extendZod";
import { z } from "zod";
import { LimitOffsetPaginationSchema } from "./common";

function idName<T extends z.ZodTypeAny>(idType: T) {
    return z.object({
        id: idType,
        name: z.string().nullable()
    });
}
const idEmail = z.object({ id: z.string(), email: z.string().nullable() });

const ts = (what: string) =>
    z
        .number()
        .int()
        .openapi({ description: `Epoch seconds when ${what}.` });

export const ActionAuditLogSchema = z.object({
    log: z.array(
        z.object({
            orgId: z
                .string()
                .openapi({ description: "ID of the organization." }),
            action: z
                .string()
                .openapi({ description: "The action that was performed." }),
            actorType: z.string().openapi({
                description: "Kind of actor, for example user or api key."
            }),
            actorId: z.string().openapi({ description: "ID of the actor." }),
            metadata: z.string().nullable().openapi({
                description:
                    "Additional details about the action, as a JSON string."
            }),
            timestamp: ts("the action was performed"),
            actor: z
                .string()
                .openapi({ description: "Display name of the actor." })
        })
    ),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({ actors: z.array(z.string()) }).openapi({
        description: "Distinct values that can be used to filter the log."
    })
});

const requestLogEntry = z.object({
    timestamp: ts("the request was made"),
    action: z
        .boolean()
        .openapi({ description: "Whether the request was allowed." }),
    reason: z.number().int().openapi({
        description: "Numeric code for why the request was allowed or blocked."
    }),
    orgId: z
        .string()
        .nullable()
        .openapi({ description: "ID of the organization." }),
    actorType: z
        .string()
        .nullable()
        .openapi({ description: "Kind of actor that made the request." }),
    actor: z
        .string()
        .nullable()
        .openapi({ description: "Display name of the actor." }),
    actorId: z.string().nullable().openapi({ description: "ID of the actor." }),
    resourceId: z.number().int().nullable().openapi({
        description: "ID of the public resource that was requested."
    }),
    siteResourceId: z.number().int().nullable().openapi({
        description: "ID of the private resource that was requested."
    }),
    resourceNiceId: z
        .string()
        .nullable()
        .openapi({ description: "Human readable ID of the resource." }),
    resourceName: z
        .string()
        .nullable()
        .openapi({ description: "Name of the resource." }),
    ip: z
        .string()
        .nullable()
        .openapi({ description: "IP address the request came from." }),
    location: z
        .string()
        .nullable()
        .openapi({ description: "Country code of the IP address." }),
    userAgent: z
        .string()
        .nullable()
        .openapi({ description: "User agent of the client." }),
    metadata: z
        .string()
        .nullable()
        .openapi({ description: "Additional details, as a JSON string." }),
    headers: z
        .string()
        .nullable()
        .openapi({ description: "Request headers, as a JSON string." }),
    query: z
        .string()
        .nullable()
        .openapi({ description: "Query string parameters, as a JSON string." }),
    originalRequestURL: z
        .string()
        .nullable()
        .openapi({ description: "Full URL that was requested." }),
    scheme: z.string().nullable().openapi({ description: "http or https." }),
    host: z
        .string()
        .nullable()
        .openapi({ description: "Host that was requested." }),
    path: z
        .string()
        .nullable()
        .openapi({ description: "Path that was requested." }),
    method: z.string().nullable().openapi({ description: "HTTP method." }),
    tls: z
        .boolean()
        .nullable()
        .openapi({ description: "Whether the request used TLS." })
});

export const RequestAuditLogSchema = z.object({
    log: z.array(requestLogEntry),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        actors: z.array(z.string()),
        resources: z.array(idName(z.number().int())),
        locations: z.array(z.string()),
        hosts: z.array(z.string()),
        paths: z.array(z.string())
    })
});

export const RequestAnalyticsSchema = z.object({
    requestsPerCountry: z
        .array(
            z.object({
                code: z
                    .string()
                    .openapi({ description: "Two letter country code." }),
                count: z
                    .number()
                    .int()
                    .openapi({ description: "Requests from that country." })
            })
        )
        .openapi({ description: "Request counts grouped by country." }),
    requestsPerDay: z
        .array(
            z.object({
                day: z.string().openapi({ description: "Day, as YYYY-MM-DD." }),
                allowedCount: z
                    .number()
                    .int()
                    .openapi({ description: "Requests that were allowed." }),
                blockedCount: z
                    .number()
                    .int()
                    .openapi({ description: "Requests that were blocked." }),
                totalCount: z
                    .number()
                    .int()
                    .openapi({ description: "All requests." })
            })
        )
        .openapi({ description: "Request counts grouped by day." }),
    totalBlocked: z
        .number()
        .int()
        .openapi({ description: "Blocked requests in the period." }),
    totalRequests: z
        .number()
        .int()
        .openapi({ description: "All requests in the period." })
});

export const AccessAuditLogSchema = z.object({
    log: z.array(
        z.object({
            orgId: z
                .string()
                .openapi({ description: "ID of the organization." }),
            action: z
                .boolean()
                .openapi({ description: "Whether access was granted." }),
            actorType: z.string().nullable().openapi({
                description: "Kind of actor that tried to get access."
            }),
            actorId: z
                .string()
                .nullable()
                .openapi({ description: "ID of the actor." }),
            resourceId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the public resource." }),
            siteResourceId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the private resource." }),
            resourceName: z
                .string()
                .nullable()
                .openapi({ description: "Name of the resource." }),
            resourceNiceId: z
                .string()
                .nullable()
                .openapi({ description: "Human readable ID of the resource." }),
            ip: z
                .string()
                .nullable()
                .openapi({ description: "IP address of the client." }),
            location: z
                .string()
                .nullable()
                .openapi({ description: "Country code of the IP address." }),
            userAgent: z
                .string()
                .nullable()
                .openapi({ description: "User agent of the client." }),
            metadata: z.string().nullable().openapi({
                description: "Additional details, as a JSON string."
            }),
            type: z.string().openapi({
                description:
                    "How access was attempted, for example password, pincode, whitelist or sso."
            }),
            timestamp: ts("access was attempted"),
            actor: z
                .string()
                .nullable()
                .openapi({ description: "Display name of the actor." })
        })
    ),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        actors: z.array(z.string()),
        resources: z.array(idName(z.number().int())),
        locations: z.array(z.string())
    })
});

export const ConnectionAuditLogSchema = z.object({
    log: z.array(
        z.object({
            sessionId: z
                .string()
                .openapi({ description: "ID of the connection session." }),
            siteResourceId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the private resource." }),
            orgId: z
                .string()
                .nullable()
                .openapi({ description: "ID of the organization." }),
            siteId: z.number().int().nullable().openapi({
                description: "ID of the site that carried the connection."
            }),
            clientId: z.number().int().nullable().openapi({
                description: "ID of the client that opened the connection."
            }),
            clientEndpoint: z
                .string()
                .nullable()
                .openapi({ description: "Public endpoint of the client." }),
            userId: z.string().nullable().openapi({
                description: "ID of the user that owns the client."
            }),
            sourceAddr: z
                .string()
                .openapi({ description: "Source address of the connection." }),
            destAddr: z.string().openapi({
                description: "Destination address of the connection."
            }),
            protocol: z.string().openapi({
                description: "Transport protocol, for example tcp or udp."
            }),
            startedAt: ts("the connection started"),
            endedAt: z.number().int().nullable().openapi({
                description:
                    "Epoch seconds when the connection ended. Null while it is open."
            }),
            bytesTx: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "Bytes sent through the connection." }),
            bytesRx: z.number().int().nullable().openapi({
                description: "Bytes received through the connection."
            }),
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
        })
    ),
    pagination: LimitOffsetPaginationSchema,
    filterAttributes: z.object({
        protocols: z.array(z.string()),
        destAddrs: z.array(z.string()),
        clients: z.array(z.object({ id: z.number().int(), name: z.string() })),
        resources: z.array(idName(z.number().int())),
        users: z.array(idEmail)
    })
});

export const SshSessionLogSchema = z.object({
    log: z.array(
        z.object({
            id: z
                .number()
                .int()
                .openapi({ description: "Numeric ID of the log entry." }),
            sessionId: z
                .string()
                .openapi({ description: "ID of the SSH session." }),
            orgId: z
                .string()
                .openapi({ description: "ID of the organization." }),
            siteId: z.number().int().openapi({
                description: "ID of the site that carried the session."
            }),
            siteResourceId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the private resource." }),
            resourceId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the public resource." }),
            clientId: z.number().int().nullable().openapi({
                description: "ID of the client that opened the session."
            }),
            userId: z
                .string()
                .nullable()
                .openapi({ description: "ID of the user." }),
            transport: z.string().openapi({
                description: 'How the session was opened: "ssh" or "browser".'
            }),
            sourceAddr: z
                .string()
                .openapi({ description: "Source address of the session." }),
            destAddr: z.string().openapi({
                description: "Destination address of the session."
            }),
            username: z
                .string()
                .openapi({ description: "Unix username used on the target." }),
            authMethod: z
                .string()
                .nullable()
                .openapi({ description: "How the user authenticated." }),
            keyFingerprint: z
                .string()
                .nullable()
                .openapi({ description: "Fingerprint of the SSH key used." }),
            certKeyId: z.string().nullable().openapi({
                description: "Key ID of the SSH certificate used."
            }),
            commandCount: z.number().int().openapi({
                description: "Number of commands recorded in the session."
            }),
            startedAt: ts("the session started"),
            endedAt: z.number().int().nullable().openapi({
                description:
                    "Epoch seconds when the session ended. Null while it is open."
            }),
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
        })
    ),
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

export const SshSessionCommandsSchema = z.object({
    commands: z.array(
        z.object({
            id: z
                .number()
                .int()
                .openapi({ description: "Numeric ID of the command." }),
            command: z
                .string()
                .openapi({ description: "The command that was run." }),
            channel: z
                .string()
                .openapi({ description: "SSH channel the command ran on." }),
            inexact: z.boolean().openapi({
                description:
                    "Whether the command text was reconstructed and may not be exact."
            }),
            timestamp: ts("the command was run")
        })
    ),
    pagination: LimitOffsetPaginationSchema
});

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

export const AiSessionLogSchema = z.object({
    log: z.array(
        z.object({
            id: z
                .number()
                .int()
                .openapi({ description: "Numeric ID of the log entry." }),
            sessionId: z
                .string()
                .openapi({ description: "ID of the AI session." }),
            orgId: z
                .string()
                .nullable()
                .openapi({ description: "ID of the organization." }),
            providerId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the AI provider." }),
            providerName: z
                .string()
                .nullable()
                .openapi({ description: "Name of the AI provider." }),
            providerType: z
                .string()
                .nullable()
                .openapi({ description: "Type of the AI provider." }),
            capability: z.string().openapi({
                description: "Kind of request, for example chat or embeddings."
            }),
            resourceId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the public resource." }),
            siteResourceId: z
                .number()
                .int()
                .nullable()
                .openapi({ description: "ID of the private resource." }),
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
            userId: z.string().nullable().openapi({
                description: "ID of the user that made the request."
            }),
            userEmail: z.string().nullable().openapi({
                description: "Email of the user that made the request."
            }),
            virtualApiKeyId: z
                .string()
                .nullable()
                .openapi({ description: "ID of the virtual API key used." }),
            virtualApiKeyName: z
                .string()
                .nullable()
                .openapi({ description: "Name of the virtual API key used." }),
            virtualApiKeyLastChars: z.string().nullable().openapi({
                description: "Last characters of the virtual API key used."
            }),
            requestedModel: z
                .string()
                .nullable()
                .openapi({ description: "Model the client asked for." }),
            isStream: z
                .boolean()
                .openapi({ description: "Whether the response was streamed." }),
            requestBody: z
                .string()
                .nullable()
                .openapi({ description: "Raw request body, when stored." }),
            responseBody: z
                .string()
                .nullable()
                .openapi({ description: "Raw response body, when stored." }),
            normalizedRequest: z.string().nullable().openapi({
                description: "Request in a provider independent format."
            }),
            normalizedResponse: z.string().nullable().openapi({
                description: "Response in a provider independent format."
            }),
            truncated: z.boolean().openapi({
                description: "Whether the stored bodies were cut off."
            }),
            statusCode: z.number().int().nullable().openapi({
                description: "HTTP status code returned by the provider."
            }),
            createdAt: ts("the session was created"),
            usage: usage.nullable().openapi({
                description:
                    "Token usage and cost. Null when the provider did not report it."
            })
        })
    ),
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

const dayValueRows = (what: string) =>
    z
        .array(
            z
                .object({ day: z.string() })
                .catchall(z.union([z.number(), z.string()]))
        )
        .openapi({
            description: `One object per day, as YYYY-MM-DD in day, with one numeric property per series (${what}). Series outside the top entries are grouped under other.`
        });

const requests = z
    .number()
    .int()
    .openapi({ description: "Number of requests." });
const totalTokens = z
    .number()
    .int()
    .openapi({ description: "Total tokens used." });
const costUsd = z.number().openapi({ description: "Cost in US dollars." });

export const AiUsageFilterOptionsSchema = z.object({
    providers: z.array(idName(z.number().int())),
    resources: z.array(idName(z.number().int())),
    roles: z.array(idName(z.number().int())),
    users: z.array(idEmail),
    virtualApiKeys: z.array(
        z.object({
            id: z.string(),
            name: z.string().nullable(),
            lastChars: z.string()
        })
    ),
    models: z.array(z.string())
});

export const AiUsageOverviewSchema = z.object({
    totalRequests: requests,
    totalTokens,
    totalCost: costUsd,
    estimatedPercent: z.number().openapi({
        description:
            "Share of token counts that were estimated rather than reported by the provider."
    }),
    tokenBreakdown: z.object({
        promptTokens: z.number().int(),
        cacheReadTokens: z.number().int(),
        cacheWriteTokens: z.number().int(),
        completionTokens: z.number().int(),
        reasoningTokens: z.number().int()
    }),
    requestsPerDay: z.array(z.object({ day: z.string(), requests })),
    tokensPerDay: z.array(
        z.object({
            day: z.string(),
            promptTokens: z.number().int(),
            cacheReadTokens: z.number().int(),
            cacheWriteTokens: z.number().int(),
            completionTokens: z.number().int(),
            reasoningTokens: z.number().int()
        })
    ),
    costPerDay: z.array(z.object({ day: z.string(), cost: costUsd })),
    modelCostPerDay: dayValueRows("one per model"),
    modelTokensPerDay: dayValueRows("one per model"),
    topModels: z.array(
        z.object({ model: z.string(), requests, totalTokens, costUsd })
    )
});

export const AiUsageProvidersSchema = z.object({
    providerCostPerDay: dayValueRows("one per provider"),
    providerTokensPerDay: dayValueRows("one per provider"),
    topProviders: z.array(
        z.object({
            providerId: z.number().int().nullable(),
            name: z.string().nullable(),
            requests,
            totalTokens,
            costUsd
        })
    )
});

export const AiUsageResourcesSchema = z.object({
    resourceCostPerDay: dayValueRows("one per resource"),
    resourceTokensPerDay: dayValueRows("one per resource"),
    topResources: z.array(
        z.object({
            key: z.string().openapi({
                description: "Series key used in the per-day objects."
            }),
            resourceId: z.number().int().nullable(),
            siteResourceId: z.number().int().nullable(),
            type: z.enum(["public", "site"]).nullable(),
            name: z.string().nullable(),
            requests,
            totalTokens,
            costUsd
        })
    )
});

export const AiUsageUsersRolesSchema = z.object({
    topUsers: z.array(
        z.object({
            userId: z.string().nullable(),
            email: z.string().nullable(),
            requests,
            totalTokens,
            costUsd
        })
    ),
    userCostPerDay: dayValueRows("one per user"),
    userTokensPerDay: dayValueRows("one per user"),
    topRoles: z.array(
        z.object({
            roleId: z.number().int(),
            name: z.string().nullable(),
            requests,
            totalTokens,
            costUsd
        })
    ),
    roleCostPerDay: dayValueRows("one per role"),
    roleTokensPerDay: dayValueRows("one per role")
});

export const AiUsageVirtualApiKeysSchema = z.object({
    topVirtualApiKeys: z.array(
        z.object({
            virtualApiKeyId: z.string().nullable(),
            name: z.string().nullable(),
            lastChars: z.string().nullable(),
            kind: z.enum(["manual", "user"]).nullable(),
            requests,
            totalTokens,
            costUsd
        })
    ),
    virtualApiKeyCostPerDay: dayValueRows("one per virtual API key"),
    virtualApiKeyTokensPerDay: dayValueRows("one per virtual API key")
});
