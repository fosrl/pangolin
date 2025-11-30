import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, domains, orgDomains } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z
    .object({
        orgId: z.string(),
        domainId: z.string()
    })
    .strict();

const bodySchema = z
    .object({
        certResolver: z.string().optional().nullable(),
        preferWildcardCert: z.boolean().optional().nullable()
    })
    .strict();

export type UpdateDomainResponse = {
    domainId: string;
    certResolver: string | null;
    preferWildcardCert: boolean | null;
};


registry.registerPath({
    method: "patch",
    path: "/org/{orgId}/domain/{domainId}",
    description: "Update a domain by domainId.",
    tags: [OpenAPITags.Domain],
    request: {
        params: z.object({
            domainId: z.string(),
            orgId: z.string()
        })
    },
    responses: {}
});

export async function updateOrgDomain(
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

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, domainId } = parsedParams.data;
        const { certResolver, preferWildcardCert } = parsedBody.data;

        const [orgDomain] = await db
            .select()
            .from(orgDomains)
            .where(
                and(
                    eq(orgDomains.orgId, orgId),
                    eq(orgDomains.domainId, domainId)
                )
            );

        if (!orgDomain) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Domain not found or does not belong to this organization"
                )
            );
        }


        const [existingDomain] = await db
            .select()
            .from(domains)
            .where(eq(domains.domainId, domainId));

        if (!existingDomain) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Domain not found")
            );
        }

        if (existingDomain.type !== "wildcard") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Domain settings can only be updated for wildcard domains"
                )
            );
        }

        const updateData: Partial<{
            certResolver: string | null;
            preferWildcardCert: boolean;
        }> = {};

        if (certResolver !== undefined) {
            updateData.certResolver = certResolver;
        }

        if (preferWildcardCert !== undefined && preferWildcardCert !== null) {
            updateData.preferWildcardCert = preferWildcardCert;
        }

        const [updatedDomain] = await db
            .update(domains)
            .set(updateData)
            .where(eq(domains.domainId, domainId))
            .returning();

        if (!updatedDomain) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to update domain"
                )
            );
        }

        return response<UpdateDomainResponse>(res, {
            data: {
                domainId: updatedDomain.domainId,
                certResolver: updatedDomain.certResolver,
                preferWildcardCert: updatedDomain.preferWildcardCert
            },
            success: true,
            error: false,
            message: "Domain updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}