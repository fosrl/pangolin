import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { idp, idpOrg } from "@server/db";
import { eq, and } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.strictObject({
    idpId: z.coerce.number<number>(),
    orgId: z.string()
});

registry.registerPath({
    method: "delete",
    path: "/idp/{idpId}/org/{orgId}",
    description: "Create an OIDC IdP for an organization.",
    tags: [OpenAPITags.GlobalIdp],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function deleteIdpOrgPolicy(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { idpId, orgId } = parsedParams.data;

        const [existing] = await db
            .select()
            .from(idp)
            .leftJoin(idpOrg, eq(idpOrg.orgId, orgId))
            .where(and(eq(idp.idpId, idpId), eq(idpOrg.orgId, orgId)));

        if (!existing.idp) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "An IDP with this ID does not exist."
                )
            );
        }

        if (!existing.idpOrg) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "A policy for this IDP and org does not exist."
                )
            );
        }

        await db
            .delete(idpOrg)
            .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, orgId)));

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Policy deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
