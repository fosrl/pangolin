import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, newts } from "@server/db";
import { sites } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import stoi from "@server/lib/stoi";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { SiteSchema } from "@server/routers/site/types";
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import { getCountryCodeForIp } from "@server/lib/geoip";

const getSiteSchema = z.strictObject({
    siteId: z
        .string()
        .optional()
        .transform(stoi)
        .pipe(z.int().positive().optional())
        .optional(),
    niceId: z.string().optional(),
    orgId: z.string().optional()
});

async function query(siteId?: number, niceId?: string, orgId?: string) {
    if (siteId) {
        const [res] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .leftJoin(newts, eq(sites.siteId, newts.siteId))
            .limit(1);
        return res;
    } else if (niceId && orgId) {
        const [res] = await db
            .select()
            .from(sites)
            .where(and(eq(sites.niceId, niceId), eq(sites.orgId, orgId)))
            .leftJoin(newts, eq(sites.siteId, newts.siteId))
            .limit(1);
        return res;
    }
}

export type GetSiteResponse = z.infer<typeof GetSiteResponseDataSchema>;

const GetSiteResponseDataSchema = SiteSchema.extend({
    newtId: z.string().nullable().openapi({
        description: "ID of the Newt agent connected to this site."
    }),
    newtVersion: z.string().nullable().openapi({
        description: "Version of the Newt agent."
    }),
    agent: z.string().nullable().openapi({
        description: "Name of the agent software."
    }),
    agentVersion: z.string().nullable().openapi({
        description: "Version of the agent software."
    }),
    countryCode: z.string().nullable().openapi({
        description:
            "Two letter country code resolved from the site's endpoint IP."
    })
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/site/{niceId}",
    description:
        "Get a site by orgId and niceId. NiceId is a readable ID for the site and unique on a per org basis.",
    tags: [OpenAPITags.Site],
    request: {
        params: z.object({
            orgId: z.string(),
            niceId: z.string()
        })
    },
    responses: createApiSuccessResponses(GetSiteResponseDataSchema)
});

registry.registerPath({
    method: "get",
    path: "/site/{siteId}",
    description: "Get a site by siteId.",
    tags: [OpenAPITags.Site],
    request: {
        params: z.object({
            siteId: z.number()
        })
    },
    responses: createApiSuccessResponses(GetSiteResponseDataSchema)
});

export async function getSite(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getSiteSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { siteId, niceId, orgId } = parsedParams.data;

        const site = await query(siteId, niceId, orgId);

        if (!site) {
            return next(createHttpError(HttpCode.NOT_FOUND, "Site not found"));
        }

        const data: GetSiteResponse = {
            ...site.sites,
            newtId: site.newt ? site.newt.newtId : null,
            newtVersion: site.newt?.version ?? null,
            agent: site.newt?.agent ?? null,
            agentVersion: site.newt?.agentVersion ?? null,
            countryCode: site.sites.endpoint
                ? ((await getCountryCodeForIp(site.sites.endpoint)) ?? null)
                : null
        };

        return response<GetSiteResponse>(res, {
            data,
            success: true,
            error: false,
            message: "Site retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
