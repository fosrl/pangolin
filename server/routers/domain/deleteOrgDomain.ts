import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, domains, OrgDomains, orgDomains } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
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
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "Domain not found for this account"
                    )
                );
            }

            if (existing.domains.configManaged) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Cannot delete a domain that is managed by the config"
                    )
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
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
