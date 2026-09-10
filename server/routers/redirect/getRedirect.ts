import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { domains, redirects, resources, db } from "@server/db";
import response from "@server/lib/response";
import stoi from "@server/lib/stoi";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";

export type GetRedirectResponse = {
    redirect: {
        redirectId: number;
        orgId: string;
        niceId: string;
        name: string;
        destinationDomain: string;
        pathMatchType: "exact" | "prefix" | "regex";
        matchPath: string;
        rewritePath: string | null;
        rewritePathType: "exact" | "prefix" | "regex" | "stripPrefix" | null;
        permanent: boolean;
        enabled: boolean;
        resourceId: number | null;
        resourceName: string | null;
        resourceNiceId: string | null;
        resourceFullDomain: string | null;
        resourceSsl: boolean | null;
        resourceWildcard: boolean | null;
        domainId: string | null;
        baseDomain: string | null;
    };
};

const redirectColumns = {
    redirectId: redirects.redirectId,
    orgId: redirects.orgId,
    niceId: redirects.niceId,
    name: redirects.name,
    destinationDomain: redirects.destinationDomain,
    pathMatchType: redirects.pathMatchType,
    matchPath: redirects.matchPath,
    rewritePath: redirects.rewritePath,
    rewritePathType: redirects.rewritePathType,
    permanent: redirects.permanent,
    enabled: redirects.enabled,
    resourceId: redirects.resourceId,
    resourceName: resources.name,
    resourceNiceId: resources.niceId,
    resourceFullDomain: resources.fullDomain,
    resourceSsl: resources.ssl,
    resourceWildcard: resources.wildcard,
    domainId: redirects.domainId,
    baseDomain: domains.baseDomain
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
            .select(redirectColumns)
            .from(redirects)
            .leftJoin(resources, eq(resources.resourceId, redirects.resourceId))
            .leftJoin(domains, eq(domains.domainId, redirects.domainId))
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
            .select(redirectColumns)
            .from(redirects)
            .leftJoin(resources, eq(resources.resourceId, redirects.resourceId))
            .leftJoin(domains, eq(domains.domainId, redirects.domainId))
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
