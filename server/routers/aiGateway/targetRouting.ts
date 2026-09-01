import { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
    AiBudget,
    AiProvider,
    db,
    exitNodes,
    sites,
    targetHealthCheck,
    targets
} from "@server/db";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import { localCache } from "@server/lib/cache";
import {
    AiProviderAuthType,
    applyAiProviderAuthHeaders,
    applyAiProviderCustomHeaders,
    authTypeRequiresApiKey
} from "@server/lib/aiProviderDefaults";
import {
    AI_CAPABILITY_DEFS,
    type AiCapability
} from "@server/lib/aiCapabilities";
import { buildAiCapabilityErrorBody } from "@server/lib/aiGatewayAuthError";
import {
    needsStreamUsageInjection,
    withStreamUsageOption
} from "@server/lib/aiUsageExtraction";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import {
    applyRequestUserHeaders,
    recordAiGatewayCompletion,
    type RequestUser
} from "@server/routers/aiGateway/pipeline";
import { streamAiGatewayResponse } from "@server/routers/aiGateway/streamAiGatewayResponse";
import {
    AI_GATEWAY_TRUST_HEADER,
    AI_GATEWAY_RESOURCE_TYPE_HEADER
} from "@server/lib/aiGatewayTrust";

// Short TTL: long enough to spare the DB on a burst of requests, short
// enough that target/site changes (added, removed, exit node moved) show up
// almost immediately without needing explicit cache invalidation.
const PROVIDER_TARGETS_TTL_SEC = 7;

// Header gerbil reads to know which scheme://host:port (reachable over the
// WireGuard network) to rewrite an incoming /router/* request to. Must
// match gerbil's `pangolinDestHeader` constant.
const PANGOLIN_DEST_HEADER = "p-dest-header";

// Header gerbil reads for the Host header value to send to the destination,
// when it should differ from PANGOLIN_DEST_HEADER (the target's configured
// ip rather than the WireGuard routing address). Must match gerbil's
// `pangolinHostHeader` constant.
const PANGOLIN_HOST_HEADER = "p-dest-host-header";

const SKIP_HEADERS = new Set([
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
    AI_GATEWAY_RESOURCE_TYPE_HEADER.toLowerCase()
]);

type ResolvedProviderTarget = {
    targetId: number;
    // "<scheme>://<site exitNodeSubnet host>:<internalPort>", passed to
    // gerbil as the destination to proxy the request to over the WireGuard
    // tunnel.
    destination: string;
    // The target's configured ip, passed to gerbil as the Host header to
    // send to the destination (which may differ from the WireGuard routing
    // address above, e.g. for vhost-based targets).
    hostHeader: string;
    // The target's site's exit node HTTP API base URL (gerbil's /router/*).
    gerbilBaseUrl: string;
};

async function fetchProviderTargets(
    providerId: number
): Promise<ResolvedProviderTarget[]> {
    const rows = await db
        .select({
            targetId: targets.targetId,
            ip: targets.ip,
            internalPort: targets.internalPort,
            port: targets.port,
            method: targets.method,
            exitNodeSubnet: sites.exitNodeSubnet,
            reachableAt: exitNodes.reachableAt,
            exitNodeType: exitNodes.type,
            hcHealth: targetHealthCheck.hcHealth
        })
        .from(targets)
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .innerJoin(exitNodes, eq(sites.exitNodeId, exitNodes.exitNodeId))
        .leftJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .where(
            and(eq(targets.providerId, providerId), eq(targets.enabled, true))
        );

    const resolved: ResolvedProviderTarget[] = [];
    for (const row of rows) {
        // Sites not yet connected to an exit node (no subnet assigned) or
        // whose exit node has no known HTTP address can't be routed to.
        if (!row.exitNodeSubnet || !row.reachableAt) {
            continue;
        }
        // Sites connected to a remote exit node aren't reachable via a
        // gerbil sidecar's /router/* proxy - only "gerbil" type exit nodes
        // run that endpoint.
        if (row.exitNodeType !== "gerbil") {
            continue;
        }
        // A target with an active health check that's currently failing is
        // taken out of rotation. No health check (null) or "unknown" (check
        // hasn't run yet / hcEnabled is off) still routes normally, matching
        // the convention in getTraefikConfig.ts's target selection.
        if (row.hcHealth === "unhealthy") {
            continue;
        }
        const host = row.exitNodeSubnet.split("/")[0];
        const port = row.internalPort ?? row.port;
        const scheme = row.method?.toLowerCase() ?? "https";
        resolved.push({
            targetId: row.targetId,
            destination: `${scheme}://${host}:${port}`,
            hostHeader: row.ip,
            gerbilBaseUrl: row.reachableAt
        });
    }

    return resolved;
}

async function getProviderTargets(
    providerId: number
): Promise<ResolvedProviderTarget[]> {
    const cacheKey = `aiGateway:providerTargets:${providerId}`;
    const cached = localCache.get<ResolvedProviderTarget[]>(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const resolved = await fetchProviderTargets(providerId);
    localCache.set(cacheKey, resolved, PROVIDER_TARGETS_TTL_SEC);
    return resolved;
}

// Round-robin cursor per provider. Process-local and unpersisted - fine
// since it only needs to spread load across targets, not guarantee a
// perfectly even distribution across restarts or multiple server instances.
const roundRobinCursors = new Map<number, number>();

function pickTarget(
    providerId: number,
    providerTargets: ResolvedProviderTarget[]
): ResolvedProviderTarget {
    const cursor = roundRobinCursors.get(providerId) ?? 0;
    roundRobinCursors.set(providerId, cursor + 1);
    return providerTargets[cursor % providerTargets.length];
}

function pathFromRequest(req: Request): string {
    // Query string is preserved - some providers use it to select the
    // streaming response format (e.g. Gemini's `?alt=sse`), and gerbil's
    // /router/* forwards it through untouched.
    const raw = req.originalUrl || req.url || req.path;
    return raw.startsWith("/") ? raw : `/${raw}`;
}

/**
 * Proxies an AI gateway request to one of a "custom" / "target" routing-mode
 * provider's site targets, via that site's gerbil sidecar. Gerbil's
 * /router/* endpoint forwards the request (untouched body, same path minus
 * the /router prefix, and all headers besides PANGOLIN_DEST_HEADER and
 * PANGOLIN_HOST_HEADER) over the WireGuard tunnel to the destination named
 * in PANGOLIN_DEST_HEADER, sending PANGOLIN_HOST_HEADER as the Host header.
 * Always writes a response to `res`, including on failure.
 */
export async function proxyAiGatewayToSiteTarget(
    req: Request,
    res: Response,
    provider: AiProvider,
    requestUser: RequestUser | null,
    capability: AiCapability,
    ctx: {
        orgId: string | null;
        resourceId: number | null;
        siteResourceId: number | null;
        requestedModel: string | undefined;
        budgets: AiBudget[];
        virtualApiKeyId: string | null;
    }
): Promise<void> {
    const providerTargets = await getProviderTargets(provider.providerId);
    if (providerTargets.length === 0) {
        res.status(HttpCode.INTERNAL_SERVER_ERROR).json(
            buildAiCapabilityErrorBody(
                capability,
                "internal",
                "AI provider has no reachable site targets configured",
                HttpCode.INTERNAL_SERVER_ERROR
            )
        );
        return;
    }

    const target = pickTarget(provider.providerId, providerTargets);
    const gerbilUrl = `${target.gerbilBaseUrl.replace(/\/+$/, "")}/router${pathFromRequest(req)}`;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (SKIP_HEADERS.has(key.toLowerCase()) || value === undefined) {
            continue;
        }
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    const authType = provider.authType as AiProviderAuthType;
    let apiKey: string | null = null;
    if (authTypeRequiresApiKey(authType)) {
        if (!provider.apiKey) {
            res.status(HttpCode.INTERNAL_SERVER_ERROR).json(
                buildAiCapabilityErrorBody(
                    capability,
                    "internal",
                    "AI provider has no API key configured",
                    HttpCode.INTERNAL_SERVER_ERROR
                )
            );
            return;
        }
        const secret = config.getRawConfig().server.secret!;
        apiKey = decrypt(provider.apiKey, secret);
    }
    applyAiProviderCustomHeaders(
        headers,
        provider.headers,
        config.getRawConfig().server.secret!
    );
    applyAiProviderAuthHeaders(headers, authType, apiKey);
    applyRequestUserHeaders(headers, requestUser);

    headers[PANGOLIN_DEST_HEADER] = target.destination;
    headers[PANGOLIN_HOST_HEADER] = target.hostHeader;

    // Same OpenAI stream_options.include_usage injection direct-upstream
    // requests get (pipeline.ts) - needed here too now that target-routed
    // requests get usage/cost tracking and session logging as well.
    const injectedUsageOurselves = needsStreamUsageInjection(
        capability,
        req.body
    );
    const outboundBody = injectedUsageOurselves
        ? withStreamUsageOption(req.body)
        : req.body;
    const body = JSON.stringify(outboundBody);

    logger.debug("AI gateway target-routed request", {
        providerId: provider.providerId,
        targetId: target.targetId,
        destination: target.destination,
        hostHeader: target.hostHeader,
        url: gerbilUrl,
        headers,
        body: outboundBody
    });

    // Cancel the request to gerbil (which cascades to gerbil cancelling its
    // proxied request to the actual site target, since gerbil's reverse
    // proxy derives the outbound request's context from the inbound one) if
    // the client goes away before we're done.
    const abortController = new AbortController();
    const onClientClose = () => {
        if (!res.writableEnded) {
            abortController.abort();
        }
    };
    res.on("close", onClientClose);

    let upstreamRes: globalThis.Response;
    try {
        upstreamRes = await fetch(gerbilUrl, {
            method: "POST",
            headers,
            body,
            signal: abortController.signal
        });
    } catch (fetchError) {
        res.off("close", onClientClose);
        if (abortController.signal.aborted) {
            // Client already disconnected; nothing left to respond to.
            return;
        }
        logger.error({
            message: "AI gateway target proxy request failed",
            url: gerbilUrl,
            targetId: target.targetId,
            error: fetchError,
            cause:
                fetchError instanceof Error
                    ? (fetchError as Error & { cause?: unknown }).cause
                    : undefined
        });
        res.status(HttpCode.BAD_GATEWAY).json(
            buildAiCapabilityErrorBody(
                capability,
                "internal",
                "Failed to reach AI provider target",
                HttpCode.BAD_GATEWAY
            )
        );
        return;
    }

    const isStream = AI_CAPABILITY_DEFS[capability].isStreaming(
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
            requestedModel: ctx.requestedModel,
            requestBody: outboundBody,
            responseText: fullText,
            isStream,
            statusCode: upstreamRes.status,
            headers: upstreamRes.headers,
            orgId: ctx.orgId,
            resourceId: ctx.resourceId,
            siteResourceId: ctx.siteResourceId,
            requestUserId: requestUser?.userId ?? null,
            virtualApiKeyId: ctx.virtualApiKeyId,
            budgets: ctx.budgets
        });
    }
}
