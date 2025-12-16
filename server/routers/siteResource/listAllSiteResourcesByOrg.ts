import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { siteResources, sites, SiteResource } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { eq, and } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";

const listAllSiteResourcesByOrgParamsSchema = z.strictObject({
    orgId: z.string()
});

const listAllSiteResourcesByOrgQuerySchema = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

export type ListAllSiteResourcesByOrgResponse = {
    siteResources: (SiteResource & {
        siteName: string;
        siteNiceId: string;
        siteAddress: string | null;
    })[];
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/site-resources",
    description: "List all site resources for an organization.",
    tags: [OpenAPITags.Client, OpenAPITags.Org],
    request: {
        params: listAllSiteResourcesByOrgParamsSchema,
        query: listAllSiteResourcesByOrgQuerySchema
    },
    responses: {}
});

export async function listAllSiteResourcesByOrg(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listAllSiteResourcesByOrgParamsSchema.safeParse(
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

        const parsedQuery = listAllSiteResourcesByOrgQuerySchema.safeParse(
            req.query
        );
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { limit, offset } = parsedQuery.data;

        // Get all site resources for the org with site names
        const siteResourcesList = await db
            .select({
                siteResourceId: siteResources.siteResourceId,
                siteId: siteResources.siteId,
                orgId: siteResources.orgId,
                niceId: siteResources.niceId,
                name: siteResources.name,
                mode: siteResources.mode,
                protocol: siteResources.protocol,
                proxyPort: siteResources.proxyPort,
                destinationPort: siteResources.destinationPort,
                destination: siteResources.destination,
                enabled: siteResources.enabled,
                alias: siteResources.alias,
                tcpPortRangeString: siteResources.tcpPortRangeString,
                udpPortRangeString: siteResources.udpPortRangeString,
                disableIcmp: siteResources.disableIcmp,
                siteName: sites.name,
                siteNiceId: sites.niceId,
                siteAddress: sites.address
            })
            .from(siteResources)
            .innerJoin(sites, eq(siteResources.siteId, sites.siteId))
            .where(eq(siteResources.orgId, orgId))
            .limit(limit)
            .offset(offset);

        return response(res, {
            data: { siteResources: siteResourcesList },
            success: true,
            error: false,
            message: "Site resources retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error listing all site resources by org:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to list site resources"
            )
        );
    }
}
