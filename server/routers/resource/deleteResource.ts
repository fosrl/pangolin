import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { newts, resources, sites, targets } from "@server/db";
import { eq, and, ne } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { addPeer } from "../gerbil/peers";
import { removeTargets } from "../newt/targets";
import { getAllowedIps } from "../target/helpers";
import { OpenAPITags, registry } from "@server/openApi";
import { removeDomainFromAcmeJson } from "@server/lib/traefik/acmeCleanup";

// Define Zod schema for request parameters validation
const deleteResourceSchema = z.strictObject({
    resourceId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "delete",
    path: "/resource/{resourceId}",
    description: "Delete a resource.",
    tags: [OpenAPITags.Resource],
    request: {
        params: deleteResourceSchema
    },
    responses: {}
});

export async function deleteResource(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = deleteResourceSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const targetsToBeRemoved = await db
            .select()
            .from(targets)
            .where(eq(targets.resourceId, resourceId));

        const [deletedResource] = await db
            .delete(resources)
            .where(eq(resources.resourceId, resourceId))
            .returning();

        if (!deletedResource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        // Clean up ACME certificate if the deleted resource had SSL and a domain,
        // and no other resource is still using the same domain
        if (deletedResource.ssl && deletedResource.fullDomain) {
            const otherResourcesWithSameDomain = await db
                .select({ resourceId: resources.resourceId })
                .from(resources)
                .where(
                    and(
                        eq(resources.fullDomain, deletedResource.fullDomain),
                        ne(resources.resourceId, deletedResource.resourceId)
                    )
                )
                .limit(1);

            if (otherResourcesWithSameDomain.length === 0) {
                await removeDomainFromAcmeJson(deletedResource.fullDomain);
            }
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Resource deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
