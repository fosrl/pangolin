import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resourceMtlsCertificates, resources } from "@server/db";
import { and, count, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";

const deleteResourceMtlsCertificateParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive(),
    mtlsCertificateId: z.coerce.number().int().positive()
});

const description =
    "Remove a trusted CA certificate from a resource. If it is the last one, mTLS is disabled on the resource since it can no longer verify any client.";

registry.registerPath({
    method: "delete",
    path: "/resource/{resourceId}/mtls/certificate/{mtlsCertificateId}",
    description,
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: deleteResourceMtlsCertificateParamsSchema
    },
    responses: {}
});

registry.registerPath({
    method: "delete",
    path: "/public-resource/{resourceId}/mtls/certificate/{mtlsCertificateId}",
    description,
    tags: [OpenAPITags.PublicResource],
    request: {
        params: deleteResourceMtlsCertificateParamsSchema
    },
    responses: {}
});

export type DeleteResourceMtlsCertificateResponse = {
    // true when removing the last CA certificate forced mTLS off
    mtlsDisabled: boolean;
};

export async function deleteResourceMtlsCertificate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams =
            deleteResourceMtlsCertificateParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { resourceId, mtlsCertificateId } = parsedParams.data;

        const [existing] = await db
            .select()
            .from(resourceMtlsCertificates)
            .where(
                and(
                    eq(
                        resourceMtlsCertificates.mtlsCertificateId,
                        mtlsCertificateId
                    ),
                    eq(resourceMtlsCertificates.resourceId, resourceId)
                )
            )
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `CA certificate with ID ${mtlsCertificateId} not found`
                )
            );
        }

        let mtlsDisabled = false;
        await db.transaction(async (trx) => {
            await trx
                .delete(resourceMtlsCertificates)
                .where(
                    eq(
                        resourceMtlsCertificates.mtlsCertificateId,
                        mtlsCertificateId
                    )
                );

            const [{ remaining }] = await trx
                .select({ remaining: count() })
                .from(resourceMtlsCertificates)
                .where(eq(resourceMtlsCertificates.resourceId, resourceId));

            // With no CA left there is nothing to verify clients against, so
            // leaving mTLS "enabled" would either lock everyone out or be
            // silently ignored by the Traefik config builder.
            if (remaining === 0) {
                const updated = await trx
                    .update(resources)
                    .set({ mtlsEnabled: false })
                    .where(
                        and(
                            eq(resources.resourceId, resourceId),
                            eq(resources.mtlsEnabled, true)
                        )
                    )
                    .returning({ resourceId: resources.resourceId });
                mtlsDisabled = updated.length > 0;
            }
        });

        return response<DeleteResourceMtlsCertificateResponse>(res, {
            data: { mtlsDisabled },
            success: true,
            error: false,
            message: "CA certificate removed successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
