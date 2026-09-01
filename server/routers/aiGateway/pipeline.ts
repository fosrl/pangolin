import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
    AiBudget,
    AiProvider,
    aiModels,
    aiProviders,
    clients,
    db,
    exitNodes,
    resourceAiModels,
    resourceAiProviders,
    resources,
    siteResourceAiModels,
    siteResourceAiProviders,
    siteResources,
    users
} from "@server/db";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import {
    AiProviderAuthType,
    AiProviderType,
    applyAiProviderAuthHeaders,
    applyAiProviderCustomHeaders,
    authTypeRequiresApiKey
} from "@server/lib/aiProviderDefaults";
import {
    AI_CAPABILITY_DEFS,
    providerHasCapability,
    type AiCapability
} from "@server/lib/aiCapabilities";
import {
    buildAiCapabilityErrorBody,
    type AiCapabilityErrorKind
} from "@server/lib/aiGatewayAuthError";
import { proxyAiGatewayToSiteTarget } from "@server/routers/aiGateway/targetRouting";
import {
    SESSION_COOKIE_NAME,
    validateSessionToken
} from "@server/auth/sessions/app";
import { getUserOrgRoles } from "@server/lib/userOrgRoles";
import { isIpInCidr } from "@server/lib/ip";
import { localCache } from "@server/lib/cache";
import {
    AI_GATEWAY_TRUST_HEADER,
    AI_GATEWAY_RESOURCE_TYPE_HEADER,
    AI_GATEWAY_CLIENT_IP_HEADER,
    isAiGatewayTrustHeaderValid,
    getAiGatewayResourceType,
    type AiGatewayResourceType
} from "@server/lib/aiGatewayTrust";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import {
    resolveEffectiveLists,
    type AccessMode,
    type ModelListType
} from "@server/lib/aiInferenceResource";
import {
    compareModelKeySpecificity,
    isAllowedByLists,
    mostSpecificMatchingAllow
} from "@server/lib/aiModelKeyMatch";
import {
    catalogOwnershipScore,
    keepBestScored,
    providerClassRank
} from "@server/lib/aiProviderSelection";
import { aiGatewayUpstreamFetch } from "@server/lib/aiGatewayUpstreamFetch";
import { getModelPricing, calculateAiCost } from "@server/lib/aiModelPricing";
import {
    applyUsageToBudgetCache,
    checkBudgets,
    recordUsage
} from "@server/lib/aiBudgetEnforcement";
import {
    extractUsage,
    estimateUsage,
    isUsageEmpty,
    needsStreamUsageInjection,
    withStreamUsageOption,
    extractResponseModel,
    emptyUsage,
    type AiUsage
} from "@server/lib/aiUsageExtraction";
import { streamAiGatewayResponse } from "@server/routers/aiGateway/streamAiGatewayResponse";
import { logAiSession } from "#dynamic/routers/aiGateway/logAiSession";

const EXIT_NODE_RANGES_CACHE_KEY = "aiGateway:exitNodeRanges";
const EXIT_NODE_RANGES_TTL_SEC = 6000;
const CLIENT_BY_IP_TTL_SEC = 30;
const REQUEST_USER_TTL_SEC = 30;

type CachedClient = { clientId: number; userId: string | null } | null;

async function getExitNodeRanges(): Promise<string[]> {
    const cached = localCache.get<string[]>(EXIT_NODE_RANGES_CACHE_KEY);
    if (cached) {
        return cached;
    }

    const rows = await db
        .select({ address: exitNodes.address })
        .from(exitNodes);
    const ranges = rows.map((r) => r.address);

    localCache.set(
        EXIT_NODE_RANGES_CACHE_KEY,
        ranges,
        EXIT_NODE_RANGES_TTL_SEC
    );
    return ranges;
}

async function findClientByIp(ip: string): Promise<CachedClient> {
    const cacheKey = `aiGateway:clientByIp:${ip}`;
    const cached = localCache.get<CachedClient>(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const [client] = await db
        .select({ clientId: clients.clientId, userId: clients.userId })
        .from(clients)
        .where(
            eq(
                clients.exitNodeSubnet,
                `${ip}/${config.getRawConfig().gerbil.site_block_size}`
            )
        )
        .limit(1);

    const result: CachedClient = client || null;
    localCache.set(cacheKey, result, CLIENT_BY_IP_TTL_SEC);
    return result;
}

export type ProviderAttachment = {
    provider: AiProvider;
    accessMode: AccessMode;
};

type ResourceModelPattern = {
    providerId: number;
    modelKey: string;
    listType: ModelListType;
    enabled: boolean;
};

export type ProviderPatternLists = {
    allows: string[];
    blocks: string[];
};

export type ResolvedTarget = {
    resourceId: number | null;
    siteResourceId: number | null;
    orgId: string | null;
    attachments: ProviderAttachment[];
    resourceListsByProvider: Map<number, ProviderPatternLists>;
};

type ProviderSelection =
    | { ok: true; provider: AiProvider }
    | {
          ok: false;
          status: number;
          kind: AiCapabilityErrorKind;
          message: string;
      };

export type RequestUser = {
    userId: string;
    username: string;
    email: string | null;
    name: string | null;
    role: string | null;
    roleIds: number[];
};

// Identity resolved for a gateway request: the app/session or virtual-API-key
// user (if any) plus the virtual API key that authenticated the request (if
// any) - a manual virtual API key with no associated user has a
// virtualApiKeyId but no user.
export type RequestIdentity = {
    user: RequestUser | null;
    virtualApiKeyId: string | null;
};

// Identity headers forwarded to the upstream inference endpoint when the
// requesting user is known. Omitted entirely (not sent empty) when we
// couldn't resolve a user for the request.
export function applyRequestUserHeaders(
    headers: Record<string, string>,
    requestUser: RequestUser | null
): void {
    if (!requestUser) {
        return;
    }
    const remoteHeaders = config.getRawConfig().server.remote_headers;
    headers[remoteHeaders.user] = requestUser.username;
    if (requestUser.email) {
        headers[remoteHeaders.email] = requestUser.email;
    }
    if (requestUser.name) {
        headers[remoteHeaders.name] = requestUser.name;
    }
    if (requestUser.role) {
        headers[remoteHeaders.role] = requestUser.role;
    }
}

async function buildRequestUser(
    userId: string,
    orgId: string | null
): Promise<RequestUser | null> {
    const cacheKey = `aiGateway:requestUser:${userId}:${orgId || ""}`;
    const cached = localCache.get<RequestUser | null>(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1);

    if (!user) {
        localCache.set(cacheKey, null, REQUEST_USER_TTL_SEC);
        return null;
    }

    const orgRoles = orgId ? await getUserOrgRoles(user.userId, orgId) : [];

    const requestUser: RequestUser = {
        userId: user.userId,
        username: user.username,
        email: user.email,
        name: user.name,
        role: orgRoles.map((r) => r.roleName).join(", ") || null,
        roleIds: orgRoles.map((r) => r.roleId)
    };

    localCache.set(cacheKey, requestUser, REQUEST_USER_TTL_SEC);
    return requestUser;
}

async function resolveRequestUser(
    req: Request,
    resourceId: number | null,
    orgId: string | null,
    resourceType: AiGatewayResourceType | null
): Promise<RequestIdentity> {
    // Public inference: identity comes from Badger via Remote-* only when the
    // Traefik trust header proves the request passed verify-session (VAK).
    if (isAiGatewayTrustHeaderValid(req.headers as Record<string, string>)) {
        const remoteHeaders = config.getRawConfig().server.remote_headers;
        const virtualApiKeyId =
            getRequestHeader(req, remoteHeaders.virtual_api_key_id) || null;
        const userId = getRequestHeader(req, remoteHeaders.user_id);

        if (userId) {
            const username =
                getRequestHeader(req, remoteHeaders.user) || userId;
            const email = getRequestHeader(req, remoteHeaders.email);
            const name = getRequestHeader(req, remoteHeaders.name);
            const role = getRequestHeader(req, remoteHeaders.role);
            const orgRoles = orgId ? await getUserOrgRoles(userId, orgId) : [];

            return {
                user: {
                    userId,
                    username,
                    email: email || null,
                    name: name || null,
                    role:
                        role ||
                        orgRoles.map((r) => r.roleName).join(", ") ||
                        null,
                    roleIds: orgRoles.map((r) => r.roleId)
                },
                virtualApiKeyId
            };
        }

        // Trusted request with no associated user (manual key without
        // userId) - still attribute usage to the virtual API key itself.
        if (resourceId != null) {
            return { user: null, virtualApiKeyId };
        }
    }

    // Public inference must come through Badger; do not authorize via app session.
    if (resourceId != null) {
        return { user: null, virtualApiKeyId: null };
    }

    const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionToken) {
        const { session, user } = await validateSessionToken(sessionToken);
        if (session && user) {
            return {
                user: await buildRequestUser(user.userId, orgId),
                virtualApiKeyId: null
            };
        }
    }

    // TODO: MAKE SURE THIS CAN NOT BE SPOOFED AND CAN BE TRUSTED AS AN INTERNAL ADDRESS FROM A NODE

    // Only siteResources are reached over a client's exit-node tunnel, so
    // only they can be attributed to a user by IP. Public resources must be
    // authenticated via Badger above; the trust middleware stamps this
    // header per-router so we don't need to re-derive it from resourceId.
    if (resourceType !== "site-resource") {
        return { user: null, virtualApiKeyId: null };
    }

    // Prefer the dedicated header Badger stamps at the Traefik hop (opt-in
    // via server.enable_ai_gateway_client_ip_header) over req.ip, since an
    // intermediary proxy between Traefik and this gateway may overwrite
    // X-Forwarded-For/X-Real-Ip rather than appending to them, corrupting
    // what req.ip resolves to.
    const ip = getRequestHeader(req, AI_GATEWAY_CLIENT_IP_HEADER) || req.ip;
    if (!ip) {
        return { user: null, virtualApiKeyId: null };
    }

    logger.debug(`AI gateway request from IP ${ip} (site-resource)`);

    const exitNodeRanges = await getExitNodeRanges();
    const inExitNodeRange = exitNodeRanges.some((range) =>
        isIpInCidr(ip, range)
    );
    if (!inExitNodeRange) {
        return { user: null, virtualApiKeyId: null };
    }

    const client = await findClientByIp(ip);
    if (!client || !client.userId) {
        return { user: null, virtualApiKeyId: null };
    }

    return {
        user: await buildRequestUser(client.userId, orgId),
        virtualApiKeyId: null
    };
}

function getRequestHeader(req: Request, name: string): string | undefined {
    const raw = req.headers[name.toLowerCase()];
    if (Array.isArray(raw)) {
        return raw[0];
    }
    return raw;
}

// Which table a host is looked up in depends on which Traefik router the
// request came through, per the trust middleware's resource-type header -
// falls back to checking both (public preferred on overlap) only when that
// header is absent, e.g. a request that reached the gateway outside Traefik.
export async function resolveTarget(
    host: string,
    resourceType: AiGatewayResourceType | null
): Promise<ResolvedTarget | null> {
    if (resourceType === "resource") {
        return resolveResourceTarget(host);
    }
    if (resourceType === "site-resource") {
        return resolveSiteResourceTarget(host);
    }

    const [resourceTarget, siteResourceTarget] = await Promise.all([
        resolveResourceTarget(host),
        resolveSiteResourceTarget(host)
    ]);
    return resourceTarget ?? siteResourceTarget;
}

async function resolveResourceTarget(
    host: string
): Promise<ResolvedTarget | null> {
    const [resourceRow] = await db
        .select({
            resourceId: resources.resourceId,
            orgId: resources.orgId
        })
        .from(resources)
        .where(
            and(
                eq(resources.fullDomain, host),
                eq(resources.mode, "inference"),
                eq(resources.enabled, true)
            )
        )
        .limit(1);

    if (resourceRow) {
        const [attachmentRows, resourcePatterns] = await Promise.all([
            db
                .select({
                    provider: aiProviders,
                    accessMode: resourceAiProviders.accessMode
                })
                .from(resourceAiProviders)
                .innerJoin(
                    aiProviders,
                    eq(resourceAiProviders.providerId, aiProviders.providerId)
                )
                .where(
                    and(
                        eq(
                            resourceAiProviders.resourceId,
                            resourceRow.resourceId
                        ),
                        eq(aiProviders.enabled, true),
                        eq(resourceAiProviders.enabled, true)
                    )
                ),
            db
                .select({
                    providerId: aiModels.providerId,
                    modelKey: aiModels.modelKey,
                    listType: resourceAiModels.listType,
                    enabled: aiModels.enabled
                })
                .from(resourceAiModels)
                .innerJoin(
                    aiModels,
                    eq(resourceAiModels.modelId, aiModels.modelId)
                )
                .where(eq(resourceAiModels.resourceId, resourceRow.resourceId))
        ]);

        return {
            resourceId: resourceRow.resourceId,
            siteResourceId: null,
            orgId: resourceRow.orgId,
            attachments: attachmentRows.map((a) => ({
                provider: a.provider,
                accessMode: a.accessMode
            })),
            resourceListsByProvider: groupPatternsByProvider(resourcePatterns)
        };
    }

    return null;
}

async function resolveSiteResourceTarget(
    host: string
): Promise<ResolvedTarget | null> {
    const [siteResourceRow] = await db
        .select({
            siteResourceId: siteResources.siteResourceId,
            orgId: siteResources.orgId
        })
        .from(siteResources)
        .where(
            and(
                eq(siteResources.fullDomain, host),
                eq(siteResources.mode, "inference"),
                eq(siteResources.enabled, true)
            )
        )
        .limit(1);

    if (siteResourceRow) {
        const [attachmentRows, resourcePatterns] = await Promise.all([
            db
                .select({
                    provider: aiProviders,
                    accessMode: siteResourceAiProviders.accessMode
                })
                .from(siteResourceAiProviders)
                .innerJoin(
                    aiProviders,
                    eq(
                        siteResourceAiProviders.providerId,
                        aiProviders.providerId
                    )
                )
                .where(
                    and(
                        eq(
                            siteResourceAiProviders.siteResourceId,
                            siteResourceRow.siteResourceId
                        ),
                        eq(aiProviders.enabled, true),
                        eq(siteResourceAiProviders.enabled, true)
                    )
                ),
            db
                .select({
                    providerId: aiModels.providerId,
                    modelKey: aiModels.modelKey,
                    listType: siteResourceAiModels.listType,
                    enabled: aiModels.enabled
                })
                .from(siteResourceAiModels)
                .innerJoin(
                    aiModels,
                    eq(siteResourceAiModels.modelId, aiModels.modelId)
                )
                .where(
                    eq(
                        siteResourceAiModels.siteResourceId,
                        siteResourceRow.siteResourceId
                    )
                )
        ]);

        return {
            resourceId: null,
            siteResourceId: siteResourceRow.siteResourceId,
            orgId: siteResourceRow.orgId,
            attachments: attachmentRows.map((a) => ({
                provider: a.provider,
                accessMode: a.accessMode
            })),
            resourceListsByProvider: groupPatternsByProvider(resourcePatterns)
        };
    }

    return null;
}

function groupPatternsByProvider(
    patterns: ResourceModelPattern[]
): Map<number, ProviderPatternLists> {
    const byProvider = new Map<number, ProviderPatternLists>();
    for (const pattern of patterns) {
        if (!pattern.enabled) {
            continue;
        }
        let lists = byProvider.get(pattern.providerId);
        if (!lists) {
            lists = { allows: [], blocks: [] };
            byProvider.set(pattern.providerId, lists);
        }
        if (pattern.listType === "allow") {
            lists.allows.push(pattern.modelKey);
        } else {
            lists.blocks.push(pattern.modelKey);
        }
    }
    return byProvider;
}

async function selectProvider(
    attachments: ProviderAttachment[],
    resourceListsByProvider: Map<number, ProviderPatternLists>,
    requestedModel: string | undefined
): Promise<ProviderSelection> {
    if (!requestedModel) {
        return {
            ok: false,
            status: HttpCode.FORBIDDEN,
            kind: "invalid_request",
            message: "A model must be specified for this resource"
        };
    }

    const attachmentByProviderId = new Map(
        attachments.map((a) => [a.provider.providerId, a])
    );
    const providerIds = [...attachmentByProviderId.keys()];
    if (providerIds.length === 0) {
        return {
            ok: false,
            status: HttpCode.FORBIDDEN,
            kind: "permission",
            message: `Model "${requestedModel}" is not permitted on this resource`
        };
    }

    const providerModels = await db
        .select({
            providerId: aiModels.providerId,
            modelKey: aiModels.modelKey,
            listType: aiModels.listType,
            enabled: aiModels.enabled
        })
        .from(aiModels)
        .where(inArray(aiModels.providerId, providerIds));

    const allowsByProvider = new Map<number, string[]>();
    const blocksByProvider = new Map<number, string[]>();
    for (const model of providerModels) {
        if (!model.enabled) {
            continue;
        }
        const targetMap =
            model.listType === "allow" ? allowsByProvider : blocksByProvider;
        const existing = targetMap.get(model.providerId) ?? [];
        existing.push(model.modelKey);
        targetMap.set(model.providerId, existing);
    }

    type ModelCandidate = {
        provider: AiProvider;
        modelKey: string;
    };

    const candidates: ModelCandidate[] = [];
    for (const [providerId, attachment] of attachmentByProviderId) {
        const resourceLists = resourceListsByProvider.get(providerId);
        const { allows, blocks } = resolveEffectiveLists({
            accessMode: attachment.accessMode,
            providerAllows: allowsByProvider.get(providerId) ?? [],
            providerBlocks: blocksByProvider.get(providerId) ?? [],
            resourceAllows: resourceLists?.allows ?? [],
            resourceBlocks: resourceLists?.blocks ?? []
        });

        if (!isAllowedByLists(requestedModel, allows, blocks)) {
            continue;
        }
        const matchingAllow = mostSpecificMatchingAllow(requestedModel, allows);
        if (!matchingAllow) {
            continue;
        }
        candidates.push({
            provider: attachment.provider,
            modelKey: matchingAllow
        });
    }

    if (candidates.length === 0) {
        return {
            ok: false,
            status: HttpCode.FORBIDDEN,
            kind: "permission",
            message: `Model "${requestedModel}" is not permitted on this resource`
        };
    }

    // 1) Prefer the most specific allow pattern that matched the request.
    candidates.sort((a, b) =>
        compareModelKeySpecificity(a.modelKey, b.modelKey)
    );
    const bestSpecificity = candidates[0].modelKey;
    let remaining = candidates.filter(
        (c) => compareModelKeySpecificity(c.modelKey, bestSpecificity) === 0
    );

    // 2) Prefer providers whose catalog owns this model id. Aggregators only
    // score when the model is known somewhere in the catalog.
    remaining = keepBestScored(remaining, (c) =>
        catalogOwnershipScore(c.provider.type as AiProviderType, requestedModel)
    );

    // 3) Prefer native typed providers over aggregators over custom.
    remaining = keepBestScored(remaining, (c) =>
        providerClassRank(c.provider.type as AiProviderType)
    );

    const uniqueProviders = new Map<number, AiProvider>();
    for (const candidate of remaining) {
        uniqueProviders.set(candidate.provider.providerId, candidate.provider);
    }

    if (uniqueProviders.size === 1) {
        return { ok: true, provider: [...uniqueProviders.values()][0] };
    }

    return {
        ok: false,
        status: HttpCode.FORBIDDEN,
        kind: "permission",
        message: `Model "${requestedModel}" is ambiguous across multiple AI providers on this resource. Ask your administrator to configure a more specific allow pattern for this model.`
    };
}

// Extracts usage/cost from a completed AI gateway request, records it for
// budget enforcement, and logs the aggregated prompt/response for session
// replay. Shared by both the direct-upstream path (below) and the
// "custom"/target routing-mode path (targetRouting.ts) so both get identical
// usage/cost tracking and session logging instead of only the direct-upstream
// path having it.
export function recordAiGatewayCompletion(args: {
    capability: AiCapability;
    provider: AiProvider;
    requestedModel: string | undefined;
    requestBody: unknown;
    responseText: string;
    isStream: boolean;
    statusCode: number;
    headers: Headers;
    orgId: string | null;
    resourceId: number | null;
    siteResourceId: number | null;
    requestUserId: string | null;
    virtualApiKeyId: string | null;
    budgets: AiBudget[];
}): void {
    const {
        capability,
        provider,
        requestedModel,
        requestBody,
        responseText,
        isStream,
        statusCode,
        headers,
        orgId,
        resourceId,
        siteResourceId,
        requestUserId,
        virtualApiKeyId,
        budgets
    } = args;

    // A non-2xx status means the upstream provider rejected the request
    // (bad auth, invalid request, rate limit, 5xx, etc.) before ever running
    // the model - no tokens were actually billed, so don't estimate usage
    // off the error body text or price/charge it. We still record a
    // zeroed-out row below (rather than skipping it) so request-count
    // dashboards built on aiUsageRecords keep counting every attempt.
    const upstreamSucceeded = statusCode >= 200 && statusCode < 300;

    let usage: AiUsage;
    let model: string | undefined;
    let pricing: ReturnType<typeof getModelPricing> = null;
    let cost: ReturnType<typeof calculateAiCost> = null;

    if (upstreamSucceeded) {
        usage =
            extractUsage(capability, responseText, isStream, headers) ??
            emptyUsage();
        if (isUsageEmpty(usage)) {
            usage = estimateUsage(
                JSON.stringify(requestBody ?? ""),
                responseText
            );
        }

        model = extractResponseModel(responseText) ?? requestedModel;
        pricing = getModelPricing(provider.type as AiProviderType, model);
        cost = calculateAiCost(pricing, usage);
    } else {
        usage = emptyUsage();
        model = requestedModel;
    }

    // Shared by the usage record and the session log so the two can be
    // joined later to show token/cost usage alongside the transcript -
    // generated up front since neither buffered insert's row id is known
    // until its next batch flush.
    const sessionId = randomUUID();

    logger.info("AI gateway request usage", {
        capability,
        providerId: provider.providerId,
        providerType: provider.type,
        model,
        statusCode,
        estimated: usage.estimated,
        promptTokens: usage.promptTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        completionTokens: usage.completionTokens,
        reasoningTokens: usage.reasoningTokens,
        pricingApproximate: pricing?.approximate ?? null,
        totalCostUsd: cost?.totalCost ?? null
    });

    if (orgId) {
        void recordUsage({
            orgId,
            providerId: provider.providerId,
            resourceId,
            siteResourceId,
            userId: requestUserId,
            virtualApiKeyId,
            requestedModel: model ?? "unknown",
            usage,
            costUsd: cost?.totalCost ?? null,
            sessionId
        });

        if (budgets.length > 0) {
            void applyUsageToBudgetCache(budgets, {
                usd: cost?.totalCost ?? 0,
                tokens:
                    usage.promptTokens +
                    usage.cacheReadTokens +
                    usage.cacheWriteTokens +
                    usage.completionTokens +
                    usage.reasoningTokens
            });
        }
    }

    logAiSession({
        sessionId,
        capability,
        provider,
        requestedModel,
        requestBody,
        responseText,
        isStream,
        statusCode,
        orgId,
        resourceId,
        siteResourceId,
        requestUserId,
        virtualApiKeyId
    });
}

// p-host is only used sometimes when overriding the host header for some
// middleware proxy. Shared with the model-discovery endpoint so both resolve
// the inference resource off the same hostname.
export function resolveGatewayHost(req: Request): string {
    return (
        (req.headers["p-host"] as string | undefined) ||
        req.headers.host ||
        ""
    ).split(":")[0];
}

export async function handleAiGatewayProxy(
    req: Request,
    res: Response,
    capability: AiCapability
): Promise<any> {
    try {
        const def = AI_CAPABILITY_DEFS[capability];

        const host = resolveGatewayHost(req);
        if (!host) {
            return res
                .status(HttpCode.BAD_REQUEST)
                .json(
                    buildAiCapabilityErrorBody(
                        capability,
                        "invalid_request",
                        "Missing Host header",
                        HttpCode.BAD_REQUEST
                    )
                );
        }

        const resourceType = getAiGatewayResourceType(
            req.headers as Record<string, string>
        );
        const target = await resolveTarget(host, resourceType);
        if (!target) {
            return res
                .status(HttpCode.NOT_FOUND)
                .json(
                    buildAiCapabilityErrorBody(
                        capability,
                        "not_found",
                        "No inference resource found for this host",
                        HttpCode.NOT_FOUND
                    )
                );
        }

        const {
            attachments,
            resourceListsByProvider,
            resourceId,
            siteResourceId,
            orgId
        } = target;

        // Public inference must pass Badger verify-session first. Traefik
        // injects the trust header only on that path; the gateway trusts it
        // and does not re-verify the virtual API key.
        if (
            resourceId != null &&
            !isAiGatewayTrustHeaderValid(req.headers as Record<string, string>)
        ) {
            return res
                .status(HttpCode.UNAUTHORIZED)
                .json(
                    buildAiCapabilityErrorBody(
                        capability,
                        "authentication",
                        "Request must be authenticated via the inference resource",
                        HttpCode.UNAUTHORIZED
                    )
                );
        }

        if (attachments.length === 0) {
            return res
                .status(HttpCode.FORBIDDEN)
                .json(
                    buildAiCapabilityErrorBody(
                        capability,
                        "permission",
                        "No AI providers configured for this resource",
                        HttpCode.FORBIDDEN
                    )
                );
        }

        const capableAttachments = attachments.filter((a) =>
            providerHasCapability(a.provider.capabilities, capability)
        );

        if (capableAttachments.length === 0) {
            return res
                .status(HttpCode.FORBIDDEN)
                .json(
                    buildAiCapabilityErrorBody(
                        capability,
                        "permission",
                        `No AI provider on this resource supports ${capability}`,
                        HttpCode.FORBIDDEN
                    )
                );
        }

        const requestedModel = def.extractModel(req);

        const [identity, selection] = await Promise.all([
            resolveRequestUser(req, resourceId, orgId, resourceType),
            selectProvider(
                capableAttachments,
                resourceListsByProvider,
                requestedModel
            )
        ]);
        const requestUser = identity.user;

        if (requestUser) {
            logger.debug(
                `AI gateway request from user ${requestUser.userId} (${requestUser.username})`
            );
        }

        if (!selection.ok) {
            return res
                .status(selection.status)
                .json(
                    buildAiCapabilityErrorBody(
                        capability,
                        selection.kind,
                        selection.message,
                        selection.status
                    )
                );
        }

        const { provider } = selection;

        let appliedBudgets: AiBudget[] = [];
        if (orgId) {
            const budgetCheck = await checkBudgets({
                orgId,
                providerId: provider.providerId,
                requestedModel: requestedModel!,
                resourceId,
                siteResourceId,
                roleIds: requestUser?.roleIds ?? [],
                requestUserId: requestUser?.userId ?? null,
                virtualApiKeyId: identity.virtualApiKeyId
            });
            appliedBudgets = budgetCheck.budgets;

            if (budgetCheck.blocked) {
                logger.warn("AI gateway request blocked by budget", {
                    budgetId: budgetCheck.blockingBudget?.budgetId,
                    orgId,
                    providerId: provider.providerId,
                    requestedModel,
                    resourceId,
                    siteResourceId,
                    userId: requestUser?.userId ?? null
                });
                return res
                    .status(HttpCode.TOO_MANY_REQUESTS)
                    .json(
                        buildAiCapabilityErrorBody(
                            capability,
                            "rate_limit",
                            "AI usage budget exceeded for this request",
                            HttpCode.TOO_MANY_REQUESTS
                        )
                    );
            }
        }

        if (provider.type === "custom" && provider.routingMode === "target") {
            return await proxyAiGatewayToSiteTarget(
                req,
                res,
                provider,
                requestUser,
                capability,
                {
                    orgId,
                    resourceId,
                    siteResourceId,
                    requestedModel,
                    budgets: appliedBudgets,
                    virtualApiKeyId: identity.virtualApiKeyId
                }
            );
        }

        const upstreamUrl = provider.upstreamUrl;
        const authType = provider.authType as AiProviderAuthType;

        if (!upstreamUrl) {
            return res
                .status(HttpCode.INTERNAL_SERVER_ERROR)
                .json(
                    buildAiCapabilityErrorBody(
                        capability,
                        "internal",
                        "AI provider has no upstream URL configured",
                        HttpCode.INTERNAL_SERVER_ERROR
                    )
                );
        }

        let apiKey: string | null = null;
        if (authTypeRequiresApiKey(authType)) {
            if (!provider.apiKey) {
                return res
                    .status(HttpCode.INTERNAL_SERVER_ERROR)
                    .json(
                        buildAiCapabilityErrorBody(
                            capability,
                            "internal",
                            "AI provider has no API key configured",
                            HttpCode.INTERNAL_SERVER_ERROR
                        )
                    );
            }
            const secret = config.getRawConfig().server.secret!;
            apiKey = decrypt(provider.apiKey, secret);
        }

        const targetUrl = def.resolveUpstreamUrl(
            upstreamUrl,
            req,
            requestedModel!
        );

        const skipHeaders = new Set([
            "p-host",
            "host",
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailers",
            "transfer-encoding",
            "upgrade",
            "content-length",
            "accept-encoding",
            AI_GATEWAY_TRUST_HEADER.toLowerCase(),
            AI_GATEWAY_RESOURCE_TYPE_HEADER.toLowerCase(),
            AI_GATEWAY_CLIENT_IP_HEADER.toLowerCase()
        ]);

        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (skipHeaders.has(key.toLowerCase()) || value === undefined) {
                continue;
            }
            headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        applyAiProviderCustomHeaders(
            headers,
            provider.headers,
            config.getRawConfig().server.secret!
        );
        applyAiProviderAuthHeaders(headers, authType, apiKey);
        applyRequestUserHeaders(headers, requestUser);

        // OpenAI's Chat Completions API only reports usage in a streaming
        // response when asked to via stream_options.include_usage - inject
        // it ourselves when the caller didn't, so we can still track cost,
        // and strip the extra frame it adds back out of what we forward.
        const injectedUsageOurselves = needsStreamUsageInjection(
            capability,
            req.body
        );
        const outboundBody = injectedUsageOurselves
            ? withStreamUsageOption(req.body)
            : req.body;
        const body = JSON.stringify(outboundBody);

        logger.debug("AI gateway upstream request", {
            capability,
            url: targetUrl,
            method: "POST",
            headers,
            body: outboundBody,
            skipTlsVerification: provider.skipTlsVerification
        });

        const abortController = new AbortController();
        const onClientClose = () => {
            if (!res.writableEnded) {
                abortController.abort();
            }
        };
        res.on("close", onClientClose);

        let upstreamRes: globalThis.Response;
        try {
            upstreamRes = await aiGatewayUpstreamFetch(targetUrl, {
                method: "POST",
                headers,
                body,
                skipTlsVerification: provider.skipTlsVerification,
                signal: abortController.signal
            });
        } catch (fetchError) {
            res.off("close", onClientClose);
            if (abortController.signal.aborted) {
                // Client already disconnected; nothing left to respond to.
                return;
            }
            logger.error({
                message: "AI gateway upstream fetch failed",
                url: targetUrl,
                error: fetchError,
                cause:
                    fetchError instanceof Error
                        ? (fetchError as Error & { cause?: unknown }).cause
                        : undefined
            });
            throw fetchError;
        }

        const isStream = def.isStreaming(
            req,
            upstreamRes.headers.get("content-type") || ""
        );

        const { fullText, aborted } = await streamAiGatewayResponse({
            res,
            upstreamRes,
            isStream,
            injectedUsageOurselves,
            abortController,
            onClientClose
        });

        if (!aborted) {
            recordAiGatewayCompletion({
                capability,
                provider,
                requestedModel,
                requestBody: outboundBody,
                responseText: fullText,
                isStream,
                statusCode: upstreamRes.status,
                headers: upstreamRes.headers,
                orgId,
                resourceId,
                siteResourceId,
                requestUserId: requestUser?.userId ?? null,
                virtualApiKeyId: identity.virtualApiKeyId,
                budgets: appliedBudgets
            });
        }
        return;
    } catch (error) {
        logger.error(error);
        return res
            .status(HttpCode.INTERNAL_SERVER_ERROR)
            .json(
                buildAiCapabilityErrorBody(
                    capability,
                    "internal",
                    "Failed to proxy inference request",
                    HttpCode.INTERNAL_SERVER_ERROR
                )
            );
    }
}
