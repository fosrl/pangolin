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
import { addMtlsCertificates, getResourceMtlsOwner } from "@server/lib/mtls";
import { resourceModeSupportsMtls } from "@server/lib/mtlsModes";
import { CreateResourceMtlsCertificateResponse } from "@server/routers/resource/types";

const createResourceMtlsCertificateParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

const createResourceMtlsCertificateBodySchema = z.strictObject({
    name: z.string().min(1).max(255).optional(),
    certificate: z.string().min(1).max(100_000)
});

const description =
    "Add a trusted CA certificate that clients must present a certificate signed by when mTLS is enabled on a resource. Accepts a PEM bundle; each certificate in the bundle is stored separately. When no shared resource policy is assigned, this updates the resource's inline policy.";

registry.registerPath({
    method: "put",
    path: "/resource/{resourceId}/mtls/certificate",
    description,
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: createResourceMtlsCertificateParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourceMtlsCertificateBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "put",
    path: "/public-resource/{resourceId}/mtls/certificate",
    description,
    tags: [OpenAPITags.PublicResource],
    request: {
        params: createResourceMtlsCertificateParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourceMtlsCertificateBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function createResourceMtlsCertificate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams =
            createResourceMtlsCertificateParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = createResourceMtlsCertificateBodySchema.safeParse(
            req.body
        );
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;
        const { name, certificate } = parsedBody.data;

        const [resource] = await db
            .select()
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

        if (!resourceModeSupportsMtls(resource.mode)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "mTLS is not supported on TCP/UDP resources"
                )
            );
        }

        const inserted = await addMtlsCertificates(
            getResourceMtlsOwner(resource),
            certificate,
            name
        );

        return response<CreateResourceMtlsCertificateResponse>(res, {
            data: {
                certificates: inserted.map((c) => ({ ...c, resourceId }))
            },
            success: true,
            error: false,
            message: "CA certificate added successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
