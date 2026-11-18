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
import { getResourceMtlsOwner, listMtlsCertificates } from "@server/lib/mtls";
import { ListResourceMtlsCertificatesResponse } from "@server/routers/resource/types";

const listResourceMtlsCertificatesParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

const description =
    "List the trusted CA certificates for a resource's mTLS. When no shared resource policy is assigned, these are the resource's inline policy certificates.";

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/mtls/certificates",
    description,
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: listResourceMtlsCertificatesParamsSchema
    },
    responses: {}
});

registry.registerPath({
    method: "get",
    path: "/public-resource/{resourceId}/mtls/certificates",
    description,
    tags: [OpenAPITags.PublicResource],
    request: {
        params: listResourceMtlsCertificatesParamsSchema
    },
    responses: {}
});

export async function listResourceMtlsCertificates(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listResourceMtlsCertificatesParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { resourceId } = parsedParams.data;

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

        const certificates = (
            await listMtlsCertificates(getResourceMtlsOwner(resource))
        ).map((c) => ({ ...c, resourceId }));

        return response<ListResourceMtlsCertificatesResponse>(res, {
            data: { certificates },
            success: true,
            error: false,
            message: "CA certificates retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
