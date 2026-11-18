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
    listMtlsCertificates,
    type MtlsCertificateInfo
} from "@server/lib/mtls";

const listResourcePolicyMtlsCertificatesParamsSchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive())
});

export type ListResourcePolicyMtlsCertificatesResponse = {
    certificates: MtlsCertificateInfo[];
};

const description =
    "List the trusted CA certificates for a resource policy's mTLS.";

registry.registerPath({
    method: "get",
    path: "/resource-policy/{resourcePolicyId}/mtls/certificates",
    description,
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: listResourcePolicyMtlsCertificatesParamsSchema
    },
    responses: {}
});

registry.registerPath({
    method: "get",
    path: "/public-resource-policy/{resourcePolicyId}/mtls/certificates",
    description,
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: listResourcePolicyMtlsCertificatesParamsSchema
    },
    responses: {}
});

export async function listResourcePolicyMtlsCertificates(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams =
            listResourcePolicyMtlsCertificatesParamsSchema.safeParse(
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
        const { resourcePolicyId } = parsedParams.data;

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

        const certificates = await listMtlsCertificates({
            type: "policy",
            resourcePolicyId
        });

        return response<ListResourcePolicyMtlsCertificatesResponse>(res, {
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
