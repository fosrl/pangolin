import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import {
    MAX_UPSTREAM_CA_PEM_LENGTH,
    normalizeUpstreamCaPem
} from "@server/lib/upstreamCa";

export const paramsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

export const putBodySchema = z.strictObject({
    certificatePem: z.string().min(1).max(MAX_UPSTREAM_CA_PEM_LENGTH)
});

// Inject persistence so HTTP handler behaviour can be tested without a server,
// credentials, or a running database. Authentication stays in the router stack.
export type UpstreamCaStore = {
    getResourceMode(resourceId: number): Promise<string | null>;
    getCertificate(resourceId: number): Promise<string | null>;
    saveCertificate(resourceId: number, certificatePem: string): Promise<void>;
    deleteCertificate(resourceId: number): Promise<void>;
};

function resourceIdFromParams(params: Request["params"]): number {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            fromError(parsed.error).toString()
        );
    }
    return parsed.data.resourceId;
}

export function createUpstreamCaHandlers(
    store: UpstreamCaStore,
    logUnexpectedError: (error: unknown) => void
) {
    async function requireHttpResource(resourceId: number): Promise<void> {
        const mode = await store.getResourceMode(resourceId);
        if (mode === null) {
            throw createHttpError(
                HttpCode.NOT_FOUND,
                `Resource with ID ${resourceId} not found`
            );
        }
        if (mode !== "http") {
            throw createHttpError(
                HttpCode.BAD_REQUEST,
                "Upstream CA certificates are only supported on HTTP resources"
            );
        }
    }

    function handleError(error: unknown, next: NextFunction) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        logUnexpectedError(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }

    async function getResourceUpstreamCa(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> {
        try {
            const resourceId = resourceIdFromParams(req.params);
            await requireHttpResource(resourceId);
            const certificatePem = await store.getCertificate(resourceId);

            return response(res, {
                data: { certificatePem },
                success: true,
                error: false,
                message: "Upstream CA retrieved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            return handleError(error, next);
        }
    }

    async function putResourceUpstreamCa(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> {
        try {
            const resourceId = resourceIdFromParams(req.params);
            const parsedBody = putBodySchema.safeParse(req.body);
            if (!parsedBody.success) {
                throw createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                );
            }
            await requireHttpResource(resourceId);

            let certificatePem: string;
            try {
                certificatePem = normalizeUpstreamCaPem(
                    parsedBody.data.certificatePem
                );
            } catch (error) {
                throw createHttpError(
                    HttpCode.BAD_REQUEST,
                    error instanceof Error
                        ? error.message
                        : "Invalid CA certificate"
                );
            }

            await store.saveCertificate(resourceId, certificatePem);

            return response(res, {
                data: { certificatePem },
                success: true,
                error: false,
                message: "Upstream CA saved successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            return handleError(error, next);
        }
    }

    async function deleteResourceUpstreamCa(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> {
        try {
            const resourceId = resourceIdFromParams(req.params);
            await requireHttpResource(resourceId);

            // Idempotent: deleting an absent CA still succeeds. Do not toggle
            // verifyUpstreamTls; a missing trust anchor must not disable checks.
            await store.deleteCertificate(resourceId);

            return response(res, {
                data: { certificatePem: null },
                success: true,
                error: false,
                message: "Upstream CA removed successfully",
                status: HttpCode.OK
            });
        } catch (error) {
            return handleError(error, next);
        }
    }

    return {
        getResourceUpstreamCa,
        putResourceUpstreamCa,
        deleteResourceUpstreamCa
    };
}
