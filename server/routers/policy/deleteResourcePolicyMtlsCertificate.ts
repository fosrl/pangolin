import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { removeMtlsCertificate } from "@server/lib/mtls";

const deleteResourcePolicyMtlsCertificateParamsSchema = z.strictObject({
    resourcePolicyId: z.string().transform(Number).pipe(z.int().positive()),
    mtlsCertificateId: z.coerce.number().int().positive()
});

export type DeleteResourcePolicyMtlsCertificateResponse = {
    // true when removing the last CA certificate forced mTLS off
    mtlsDisabled: boolean;
};

const description =
    "Remove a trusted CA certificate from a resource policy. If it is the last one, mTLS is disabled on the policy since it can no longer verify any client.";

registry.registerPath({
    method: "delete",
    path: "/resource-policy/{resourcePolicyId}/mtls/certificate/{mtlsCertificateId}",
    description,
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: deleteResourcePolicyMtlsCertificateParamsSchema
    },
    responses: {}
});

registry.registerPath({
    method: "delete",
    path: "/public-resource-policy/{resourcePolicyId}/mtls/certificate/{mtlsCertificateId}",
    description,
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: deleteResourcePolicyMtlsCertificateParamsSchema
    },
    responses: {}
});

export async function deleteResourcePolicyMtlsCertificate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams =
            deleteResourcePolicyMtlsCertificateParamsSchema.safeParse(
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
        const { resourcePolicyId, mtlsCertificateId } = parsedParams.data;

        const result = await removeMtlsCertificate(
            { type: "policy", resourcePolicyId },
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

        return response<DeleteResourcePolicyMtlsCertificateResponse>(res, {
            data: result,
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
