import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, domains } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { domain } from "zod/v4/core/regexes";

const getDomainSchema = z
    .object({
        domainId: z
            .string()
            .optional(),
        orgId: z.string().optional()
    })
    .strict();

async function query(domainId?: string, orgId?: string) {
    if (domainId) {
        const [res] = await db
            .select()
            .from(domains)
            .where(eq(domains.domainId, domainId))
            .limit(1);
        return res;
    }
}

export type GetDomainResponse = NonNullable<Awaited<ReturnType<typeof query>>>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/domain/{domainId}",
    description: "Get a domain by domainId.",
    tags: [OpenAPITags.Domain],
    request: {
        params: z.object({
            domainId: z.string(),
            orgId: z.string()
        })
    },
    responses: {}
});

export async function getDomain(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getDomainSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId, domainId } = parsedParams.data;

        const domain = await query(domainId, orgId);

        if (!domain) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Domain not found"));
        }

        return response<GetDomainResponse>(res, {
            data: domain,
            success: true,
            error: false,
            message: "Domain retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
