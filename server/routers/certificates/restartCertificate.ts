import { certificates, db } from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const restartCertificateParamsSchema = z.strictObject({
    certId: z.coerce.number().int().positive(),
    orgId: z.string()
});

registry.registerPath({
    method: "post",
    path: "/certificate/{certId}",
    description: "Restart a certificate by ID.",
    tags: ["Certificate"],
    request: {
        params: z.object({
            certId: z.coerce.number().int().positive(),
            orgId: z.string()
        })
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

export async function restartCertificate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = restartCertificateParamsSchema.safeParse(
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

        const { certId } = parsedParams.data;

        // get the certificate by ID
        const [cert] = await db
            .select()
            .from(certificates)
            .where(eq(certificates.certId, certId))
            .limit(1);

        if (!cert) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Certificate not found")
            );
        }

        if (cert.status != "failed" && cert.status != "expired") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Certificate is already valid, no need to restart"
                )
            );
        }

        // update the certificate status to 'pending'
        await db
            .update(certificates)
            .set({
                status: "pending",
                errorMessage: null,
                lastRenewalAttempt: Math.floor(Date.now() / 1000)
            })
            .where(eq(certificates.certId, certId));

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Certificate restarted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
