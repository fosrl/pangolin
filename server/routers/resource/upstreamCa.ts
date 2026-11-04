import { db, resources, resourceUpstreamCa } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import { z } from "zod";
import {
    createUpstreamCaHandlers,
    paramsSchema,
    putBodySchema,
    type UpstreamCaStore
} from "./upstreamCaHandlers";

const responseSchema = z.object({
    data: z.object({ certificatePem: z.string().nullable() }),
    success: z.boolean(),
    error: z.boolean(),
    message: z.string(),
    status: z.number()
});

for (const [path, tag] of [
    ["/resource/{resourceId}/upstream-ca", OpenAPITags.PublicResourceLegacy],
    ["/public-resource/{resourceId}/upstream-ca", OpenAPITags.PublicResource]
] as const) {
    registry.registerPath({
        method: "get",
        path,
        description:
            "Get the custom CA bundle used to verify an HTTP resource's HTTPS upstream.",
        tags: [tag],
        request: { params: paramsSchema },
        responses: {
            200: {
                description: "CA bundle (null when not configured)",
                content: { "application/json": { schema: responseSchema } }
            }
        }
    });

    registry.registerPath({
        method: "put",
        path,
        description:
            "Create or replace an HTTP resource's custom upstream CA bundle. Metadata outside PEM certificates is ignored.",
        tags: [tag],
        request: {
            params: paramsSchema,
            body: {
                content: {
                    "application/json": { schema: putBodySchema }
                }
            }
        },
        responses: {
            200: {
                description: "CA bundle stored",
                content: { "application/json": { schema: responseSchema } }
            }
        }
    });

    registry.registerPath({
        method: "delete",
        path,
        description:
            "Remove an HTTP resource's custom upstream CA bundle. TLS verification settings are unchanged.",
        tags: [tag],
        request: { params: paramsSchema },
        responses: {
            200: {
                description: "CA bundle removed",
                content: { "application/json": { schema: responseSchema } }
            }
        }
    });
}

const upstreamCaStore: UpstreamCaStore = {
    async getResourceMode(resourceId) {
        const [resource] = await db
            .select({ mode: resources.mode })
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);
        return resource?.mode ?? null;
    },
    async getCertificate(resourceId) {
        const [ca] = await db
            .select({ certificatePem: resourceUpstreamCa.certificatePem })
            .from(resourceUpstreamCa)
            .where(eq(resourceUpstreamCa.resourceId, resourceId))
            .limit(1);
        return ca?.certificatePem ?? null;
    },
    async saveCertificate(resourceId, certificatePem) {
        await db
            .insert(resourceUpstreamCa)
            .values({ resourceId, certificatePem })
            .onConflictDoUpdate({
                target: resourceUpstreamCa.resourceId,
                set: { certificatePem }
            });
    },
    async deleteCertificate(resourceId) {
        await db
            .delete(resourceUpstreamCa)
            .where(eq(resourceUpstreamCa.resourceId, resourceId));
    }
};

export const {
    getResourceUpstreamCa,
    putResourceUpstreamCa,
    deleteResourceUpstreamCa
} = createUpstreamCaHandlers(upstreamCaStore, (error) => logger.error(error));
