import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resourcePolicies } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    addMtlsCertificates,
    type MtlsCertificateInfo
} from "@server/lib/mtls";

const createResourcePolicyMtlsCertificateParamsSchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

const createResourcePolicyMtlsCertificateBodySchema = z.strictObject({
    name: z.string().min(1).max(255).optional(),
    certificate: z.string().min(1).max(100_000)
});

export type CreateResourcePolicyMtlsCertificateResponse = {
    certificates: MtlsCertificateInfo[];
};

const description =
    "Add a trusted CA certificate that clients must present a certificate signed by when mTLS is enabled on a resource policy. Accepts a PEM bundle; each certificate in the bundle is stored separately.";

registry.registerPath({
    method: "put",
    path: "/resource-policy/{resourcePolicyId}/mtls/certificate",
    description,
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: createResourcePolicyMtlsCertificateParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourcePolicyMtlsCertificateBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "put",
    path: "/public-resource-policy/{resourcePolicyId}/mtls/certificate",
    description,
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: createResourcePolicyMtlsCertificateParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourcePolicyMtlsCertificateBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function createResourcePolicyMtlsCertificate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams =
            createResourcePolicyMtlsCertificateParamsSchema.safeParse(
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

        const parsedBody =
            createResourcePolicyMtlsCertificateBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { resourcePolicyId } = parsedParams.data;
        const { name, certificate } = parsedBody.data;

        const [policy] = await db
            .select({ resourcePolicyId: resourcePolicies.resourcePolicyId })
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId))
            .limit(1);

        if (!policy) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource policy not found")
            );
        }

        const certificates = await addMtlsCertificates(
            { type: "policy", resourcePolicyId },
            certificate,
            name
        );

        return response<CreateResourcePolicyMtlsCertificateResponse>(res, {
            data: { certificates },
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
