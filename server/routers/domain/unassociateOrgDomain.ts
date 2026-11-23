import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    domains,
    loginPage,
    loginPageOrg,
    orgDomains,
    redirects,
    resources,
    siteResources,
    Transaction
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq, ne } from "drizzle-orm";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import { OpenAPITags, registry } from "@server/openApi";

const paramsSchema = z.strictObject({
    domainId: z.string(),
    orgId: z.string()
});

export type UnassociateOrgDomainResponse = {
    success: boolean;
};

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/domain/{domainId}/unassociate",
    description:
        "Remove a shared domain from this organization. The domain stays in the other organizations it is shared with. Fails if this is the last organization using the domain; delete the domain instead.",
    tags: [OpenAPITags.Domain],
    request: {
        params: paramsSchema
    },
    responses: {}
});

/**
 * Returns a short description of what in the org still uses the domain, or
 * null if nothing does.
 */
async function domainInUseByOrg(
    trx: Transaction,
    orgId: string,
    domainId: string
): Promise<string | null> {
    const [resource] = await trx
        .select({ id: resources.resourceId })
        .from(resources)
        .where(
            and(eq(resources.orgId, orgId), eq(resources.domainId, domainId))
        )
        .limit(1);
    if (resource) {
        return "public resources";
    }

    const [siteResource] = await trx
        .select({ id: siteResources.siteResourceId })
        .from(siteResources)
        .where(
            and(
                eq(siteResources.orgId, orgId),
                eq(siteResources.domainId, domainId)
            )
        )
        .limit(1);
    if (siteResource) {
        return "private resources";
    }

    const [redirect] = await trx
        .select({ id: redirects.redirectId })
        .from(redirects)
        .where(
            and(eq(redirects.orgId, orgId), eq(redirects.domainId, domainId))
        )
        .limit(1);
    if (redirect) {
        return "redirects";
    }

    const [page] = await trx
        .select({ id: loginPage.loginPageId })
        .from(loginPage)
        .innerJoin(
            loginPageOrg,
            eq(loginPageOrg.loginPageId, loginPage.loginPageId)
        )
        .where(
            and(eq(loginPageOrg.orgId, orgId), eq(loginPage.domainId, domainId))
        )
        .limit(1);
    if (page) {
        return "the login page";
    }

    return null;
}

export async function unassociateOrgDomain(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsed = paramsSchema.safeParse(req.params);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsed.error).toString()
                )
            );
        }
        const { domainId, orgId } = parsed.data;

        await db.transaction(async (trx) => {
            const [existing] = await trx
                .select()
                .from(orgDomains)
                .where(
                    and(
                        eq(orgDomains.orgId, orgId),
                        eq(orgDomains.domainId, domainId)
                    )
                )
                .innerJoin(domains, eq(orgDomains.domainId, domains.domainId));

            if (!existing) {
                throw createHttpError(
                    HttpCode.NOT_FOUND,
                    "Domain not found for this organization"
                );
            }

            if (existing.domains.configManaged) {
                throw createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot unassociate a domain that is managed by the config"
                );
            }

            const [otherOrgLink] = await trx
                .select({ orgId: orgDomains.orgId })
                .from(orgDomains)
                .where(
                    and(
                        eq(orgDomains.domainId, domainId),
                        ne(orgDomains.orgId, orgId)
                    )
                )
                .limit(1);

            if (!otherOrgLink) {
                throw createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This is the only organization using the domain. Delete the domain instead."
                );
            }

            // Deleting the domain row would null out or cascade these through
            // their foreign keys, but an unlink leaves them pointing at a
            // domain the org no longer has, so refuse.
            const inUse = await domainInUseByOrg(trx, orgId, domainId);
            if (inUse) {
                throw createHttpError(
                    HttpCode.CONFLICT,
                    `This domain is still used by ${inUse} in this organization. Remove or change them first.`
                );
            }

            await trx
                .delete(orgDomains)
                .where(
                    and(
                        eq(orgDomains.orgId, orgId),
                        eq(orgDomains.domainId, domainId)
                    )
                );

            await usageService.add(orgId, LimitId.DOMAINS, -1, trx);
        });

        return response<UnassociateOrgDomainResponse>(res, {
            data: { success: true },
            success: true,
            error: false,
            message: "Domain removed from organization successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
