import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { getResourceMtlsOwner, removeMtlsCertificate } from "@server/lib/mtls";
import { DeleteResourceMtlsCertificateResponse } from "@server/routers/resource/types";

const deleteResourceMtlsCertificateParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive(),
    mtlsCertificateId: z.coerce.number().int().positive()
});

const description =
    "Remove a trusted CA certificate from a resource. If it is the last one, mTLS is disabled on the resource since it can no longer verify any client. When no shared resource policy is assigned, this updates the resource's inline policy.";

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

        const [resource] = await db
            .select({
                resourceId: resources.resourceId,
                resourcePolicyId: resources.resourcePolicyId,
                defaultResourcePolicyId: resources.defaultResourcePolicyId
            })
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        const result = await removeMtlsCertificate(
            getResourceMtlsOwner(resource),
            mtlsCertificateId
        );

        if (!result) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `CA certificate with ID ${mtlsCertificateId} not found`
                )
            );
        }

        const { mtlsDisabled } = result;

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
