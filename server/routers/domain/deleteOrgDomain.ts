import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, domains, orgDomains } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, count, eq, ne } from "drizzle-orm";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";

const paramsSchema = z.strictObject({
    domainId: z.string(),
    orgId: z.string()
});

export type DeleteAccountDomainResponse = {
    success: boolean;
};

export async function deleteAccountDomain(
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
                    "Domain not found for this account"
                );
            }

            if (existing.domains.configManaged) {
                throw createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot delete a domain that is managed by the config"
                );
            }

            // A shared domain can only be deleted from the last org using
            // it. Other orgs have to unassociate it first.
            const [{ otherOrgCount }] = await trx
                .select({ otherOrgCount: count() })
                .from(orgDomains)
                .where(
                    and(
                        eq(orgDomains.domainId, domainId),
                        ne(orgDomains.orgId, orgId)
                    )
                );

            if (otherOrgCount > 0) {
                throw createHttpError(
                    HttpCode.CONFLICT,
                    `This domain is shared with ${otherOrgCount} other organization(s). Unassociate it from all other organizations before deleting it.`
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

            await trx.delete(domains).where(eq(domains.domainId, domainId));

            await usageService.add(orgId, LimitId.DOMAINS, -1, trx);
        });

        return response<DeleteAccountDomainResponse>(res, {
            data: { success: true },
            success: true,
            error: false,
            message: "Domain deleted from account successfully",
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
