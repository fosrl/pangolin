import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { redirects, db } from "@server/db";
import type { Redirect } from "@server/db";
import response from "@server/lib/response";
import stoi from "@server/lib/stoi";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";

export type GetRedirectResponse = {
    redirect: Redirect;
};

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    redirectId: z
        .string()
        .optional()
        .transform(stoi)
        .pipe(z.int().positive().optional())
        .optional(),
    niceId: z.string().optional()
});

async function query(orgId: string, redirectId?: number, niceId?: string) {
    if (redirectId) {
        const [res] = await db
            .select()
            .from(redirects)
            .where(
                and(
                    eq(redirects.redirectId, redirectId),
                    eq(redirects.orgId, orgId)
                )
            )
            .limit(1);
        return res;
    } else if (niceId) {
        const [res] = await db
            .select()
            .from(redirects)
            .where(
                and(eq(redirects.niceId, niceId), eq(redirects.orgId, orgId))
            )
            .limit(1);
        return res;
    }
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/redirects/{redirectId}",
    description: "Get a redirect by ID.",
    tags: [OpenAPITags.Redirect],
    request: {
        params: z.object({
            orgId: z.string(),
            redirectId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/redirect/{niceId}",
    description:
        "Get a redirect by orgId and niceId. NiceId is a readable ID for the redirect and unique on a per org basis.",
    tags: [OpenAPITags.Redirect],
    request: {
        params: z.object({
            orgId: z.string(),
            niceId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function getRedirect(
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

        const { orgId, redirectId, niceId } = parsedParams.data;

        const redirect = await query(orgId, redirectId, niceId);

        if (!redirect) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Redirect with ID ${redirectId || niceId} not found`
                )
            );
        }

        return response<GetRedirectResponse>(res, {
            data: {
                redirect
            },
            success: true,
            error: false,
            message: "Redirect retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
