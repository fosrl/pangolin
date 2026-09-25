import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { redirects, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    redirectId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/redirects/{redirectId}",
    description: "Delete a redirect.",
    tags: [OpenAPITags.Redirect],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function deleteRedirect(
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

        const { orgId, redirectId } = parsedParams.data;

        const [existing] = await db
            .select({ redirectId: redirects.redirectId })
            .from(redirects)
            .where(
                and(
                    eq(redirects.redirectId, redirectId),
                    eq(redirects.orgId, orgId)
                )
            )
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Redirect with ID ${redirectId} not found`
                )
            );
        }

        await db
            .delete(redirects)
            .where(
                and(
                    eq(redirects.redirectId, redirectId),
                    eq(redirects.orgId, orgId)
                )
            );

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Redirect deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
