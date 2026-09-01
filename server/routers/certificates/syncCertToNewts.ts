import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pushCertUpdateToAffectedNewts } from "@server/lib/acmeCertSync";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";

const bodySchema = z.object({
    domain: z.string().min(1),
    domainId: z.string().nullable().optional().default(null)
});

export async function syncCertToNewts(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsed.error).toString()
            )
        );
    }

    const { domain, domainId } = parsed.data;

    logger.debug(
        `syncCertToNewts: received request to push cert update for domain "${domain}" (domainId: ${domainId ?? "none"})`
    );

    try {
        await pushCertUpdateToAffectedNewts(domain, domainId, null, null);

        res.status(HttpCode.OK).json({
            data: null,
            success: true,
            error: false,
            message: `Certificate update pushed to affected newts for domain "${domain}"`
        });
    } catch (err) {
        logger.error(
            `syncCertToNewts: error pushing cert update for domain "${domain}": ${err}`
        );
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to push certificate update to affected newts"
            )
        );
    }
}
