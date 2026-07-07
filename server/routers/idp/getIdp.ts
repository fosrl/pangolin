import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { idp, idpOidcConfig } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";

const paramsSchema = z
    .object({
        idpId: z.coerce.number<number>()
    })
    .strict();

async function query(idpId: number) {
    const [res] = await db
        .select()
        .from(idp)
        .where(eq(idp.idpId, idpId))
        .leftJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .limit(1);
    return res;
}

export type GetIdpResponse = NonNullable<Awaited<ReturnType<typeof query>>>;

registry.registerPath({
    method: "get",
    path: "/idp/{idpId}",
    description: "Get an IDP by its IDP ID.",
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

export async function getIdp(
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

        const { idpId } = parsedParams.data;

        const idpRes = await query(idpId);

        if (!idpRes) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Idp not found"));
        }

        const key = config.getRawConfig().server.secret!;

        if (idpRes.idp.type === "oidc") {
            const clientSecret = idpRes.idpOidcConfig!.clientSecret;
            const clientId = idpRes.idpOidcConfig!.clientId;

            idpRes.idpOidcConfig!.clientSecret = decrypt(clientSecret, key);
            idpRes.idpOidcConfig!.clientId = decrypt(clientId, key);
        }

        return response<GetIdpResponse>(res, {
            data: idpRes,
            success: true,
            error: false,
            message: "Idp retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
