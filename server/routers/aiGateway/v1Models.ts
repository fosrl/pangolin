import { Request, Response } from "express";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { aiModels, db } from "@server/db";
import {
    providerHasCapability,
    type AiCapability
} from "@server/lib/aiCapabilities";
import {
    buildAiCapabilityErrorBody,
    type AiCapabilityErrorKind
} from "@server/lib/aiGatewayAuthError";
import {
    getAiGatewayResourceType,
    isAiGatewayTrustHeaderValid
} from "@server/lib/aiGatewayTrust";
import { resolveEffectiveLists } from "@server/lib/aiInferenceResource";
import { listCatalogEntriesForType } from "@server/lib/aiModelCatalog";
import {
    listPermittedModels,
    paginateModels,
    MODEL_PAGE_DEFAULT_LIMIT,
    MODEL_PAGE_MAX_LIMIT,
    type CatalogModelMetadata,
    type ConfiguredModel,
    type ModelDiscoveryProvider
} from "@server/lib/aiModelDiscovery";
import type { AiProviderType } from "@server/lib/aiProviderDefaults";
import {
    resolveGatewayHost,
    resolveTarget,
    type ProviderAttachment,
    type ProviderPatternLists
} from "@server/routers/aiGateway/pipeline";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";

const CAPABILITY: AiCapability = "v1_models";

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(MODEL_PAGE_MAX_LIMIT).optional(),
    after_id: z.string().min(1).optional(),
    before_id: z.string().min(1).optional()
});

type ProviderModelLists = {
    allowsByProvider: Map<number, string[]>;
    blocksByProvider: Map<number, string[]>;
    configuredByProvider: Map<number, Map<string, ConfiguredModel>>;
};

function errorResponse(
    res: Response,
    status: number,
    kind: AiCapabilityErrorKind,
    message: string
) {
    return res
        .status(status)
        .json(buildAiCapabilityErrorBody(CAPABILITY, kind, message, status));
}

// Provider-level allow/block lists, plus the display name and creation time of
// every catalog row, so explicitly configured models are reported with the name
// the administrator gave them rather than a bare model id.
async function loadProviderModelLists(
    providerIds: number[]
): Promise<ProviderModelLists> {
    const lists: ProviderModelLists = {
        allowsByProvider: new Map(),
        blocksByProvider: new Map(),
        configuredByProvider: new Map()
    };

    if (providerIds.length === 0) {
        return lists;
    }

    const rows = await db
        .select({
            providerId: aiModels.providerId,
            modelKey: aiModels.modelKey,
            name: aiModels.name,
            listType: aiModels.listType,
            enabled: aiModels.enabled,
            createdAt: aiModels.createdAt
        })
        .from(aiModels)
        .where(inArray(aiModels.providerId, providerIds));

    for (const row of rows) {
        if (!row.enabled) {
            continue;
        }
        const targetMap =
            row.listType === "allow"
                ? lists.allowsByProvider
                : lists.blocksByProvider;
        const existing = targetMap.get(row.providerId) ?? [];
        existing.push(row.modelKey);
        targetMap.set(row.providerId, existing);

        let configured = lists.configuredByProvider.get(row.providerId);
        if (!configured) {
            configured = new Map();
            lists.configuredByProvider.set(row.providerId, configured);
        }
        configured.set(row.modelKey, {
            name: row.name,
            createdAt: row.createdAt
        });
    }

    return lists;
}

function catalogMetadataForType(
    type: AiProviderType
): Map<string, CatalogModelMetadata> {
    const metadata = new Map<string, CatalogModelMetadata>();
    for (const entry of listCatalogEntriesForType(type)) {
        metadata.set(entry.model, {
            maxInputTokens: entry.limits.input,
            maxOutputTokens: entry.limits.output,
            capabilities: entry.capabilities
        });
    }
    return metadata;
}

function buildDiscoveryProviders(
    attachments: ProviderAttachment[],
    resourceListsByProvider: Map<number, ProviderPatternLists>,
    lists: ProviderModelLists
): ModelDiscoveryProvider[] {
    return attachments.map((attachment) => {
        const providerId = attachment.provider.providerId;
        const resourceLists = resourceListsByProvider.get(providerId);
        const { allows, blocks } = resolveEffectiveLists({
            accessMode: attachment.accessMode,
            providerAllows: lists.allowsByProvider.get(providerId) ?? [],
            providerBlocks: lists.blocksByProvider.get(providerId) ?? [],
            resourceAllows: resourceLists?.allows ?? [],
            resourceBlocks: resourceLists?.blocks ?? []
        });

        return {
            providerId,
            allows,
            blocks,
            catalog: catalogMetadataForType(
                attachment.provider.type as AiProviderType
            ),
            configured: lists.configuredByProvider.get(providerId) ?? new Map()
        };
    });
}

/**
 * Serves Anthropic's model-discovery endpoints (`GET /v1/models` and
 * `GET /v1/models/{id}`) for an inference resource. The gateway answers these
 * itself rather than proxying: upstream providers either don't expose a model
 * list at all or would expose models the resource's allow/block lists forbid,
 * so the response is built from the same effective lists that gate inference.
 */
export async function handleV1Models(
    req: Request,
    res: Response
): Promise<any> {
    try {
        const host = resolveGatewayHost(req);
        if (!host) {
            return errorResponse(
                res,
                HttpCode.BAD_REQUEST,
                "invalid_request",
                "Missing Host header"
            );
        }

        const resourceType = getAiGatewayResourceType(
            req.headers as Record<string, string>
        );
        const target = await resolveTarget(host, resourceType);
        if (!target) {
            return errorResponse(
                res,
                HttpCode.NOT_FOUND,
                "not_found",
                "No inference resource found for this host"
            );
        }

        // Same gate as the inference pipeline: public inference must pass
        // Badger verify-session first, which is what stamps the trust header.
        if (
            target.resourceId != null &&
            !isAiGatewayTrustHeaderValid(req.headers as Record<string, string>)
        ) {
            return errorResponse(
                res,
                HttpCode.UNAUTHORIZED,
                "authentication",
                "Request must be authenticated via the inference resource"
            );
        }

        if (target.attachments.length === 0) {
            return errorResponse(
                res,
                HttpCode.FORBIDDEN,
                "permission",
                "No AI providers configured for this resource"
            );
        }

        const capableAttachments = target.attachments.filter((a) =>
            providerHasCapability(a.provider.capabilities, CAPABILITY)
        );
        if (capableAttachments.length === 0) {
            return errorResponse(
                res,
                HttpCode.FORBIDDEN,
                "permission",
                `No AI provider on this resource supports ${CAPABILITY}`
            );
        }

        const lists = await loadProviderModelLists(
            capableAttachments.map((a) => a.provider.providerId)
        );
        const models = listPermittedModels(
            buildDiscoveryProviders(
                capableAttachments,
                target.resourceListsByProvider,
                lists
            )
        );

        // `GET /v1/models/{id}` - a single model, 404 when this resource
        // doesn't permit it.
        const requestedModel = req.params?.model;
        if (typeof requestedModel === "string" && requestedModel.length > 0) {
            const model = models.find((m) => m.id === requestedModel);
            if (!model) {
                return errorResponse(
                    res,
                    HttpCode.NOT_FOUND,
                    "not_found",
                    `Model "${requestedModel}" is not available on this resource`
                );
            }
            return res.status(HttpCode.OK).json(model);
        }

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return errorResponse(
                res,
                HttpCode.BAD_REQUEST,
                "invalid_request",
                parsedQuery.error.issues[0]?.message ??
                    "Invalid pagination parameters"
            );
        }

        const page = paginateModels(
            models,
            parsedQuery.data.limit ?? MODEL_PAGE_DEFAULT_LIMIT,
            {
                afterId: parsedQuery.data.after_id,
                beforeId: parsedQuery.data.before_id
            }
        );
        if ("error" in page) {
            return errorResponse(
                res,
                HttpCode.BAD_REQUEST,
                "invalid_request",
                page.error
            );
        }

        logger.debug("AI gateway model discovery", {
            host,
            resourceId: target.resourceId,
            siteResourceId: target.siteResourceId,
            providers: capableAttachments.length,
            total: models.length,
            returned: page.data.length
        });

        return res.status(HttpCode.OK).json({
            data: page.data,
            has_more: page.has_more,
            first_id: page.data[0]?.id ?? null,
            last_id: page.data[page.data.length - 1]?.id ?? null
        });
    } catch (error) {
        logger.error(error);
        return errorResponse(
            res,
            HttpCode.INTERNAL_SERVER_ERROR,
            "internal",
            "Failed to list models"
        );
    }
}
