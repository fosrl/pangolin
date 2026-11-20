import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, domains, orgDomains, orgs, roles, userOrgRoles } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { and, asc, eq, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const paramsSchema = z.strictObject({
    userId: z.string().nonempty()
});

export type ListUserAdminOrgDomainsResponse = {
    domains: {
        domainId: string;
        baseDomain: string;
        type: string | null;
        verified: boolean;
        orgId: string;
        orgName: string;
    }[];
};

/**
 * Lists the domains of every org where the user holds an admin role, one row
 * per (domain, org) link. Used to pick a domain to import into another org.
 * Config managed domains are skipped since they are already in every org.
 */
export async function listUserAdminOrgDomains(
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
        const { userId } = parsedParams.data;

        const adminRows = await db
            .select({ orgId: userOrgRoles.orgId })
            .from(userOrgRoles)
            .innerJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
            .where(
                and(eq(userOrgRoles.userId, userId), eq(roles.isAdmin, true))
            );
        const adminOrgIds = [...new Set(adminRows.map((r) => r.orgId))];

        const list =
            adminOrgIds.length === 0
                ? []
                : await db
                      .select({
                          domainId: domains.domainId,
                          baseDomain: domains.baseDomain,
                          type: domains.type,
                          verified: domains.verified,
                          orgId: orgDomains.orgId,
                          orgName: orgs.name
                      })
                      .from(orgDomains)
                      .innerJoin(
                          domains,
                          eq(domains.domainId, orgDomains.domainId)
                      )
                      .innerJoin(orgs, eq(orgs.orgId, orgDomains.orgId))
                      .where(
                          and(
                              inArray(orgDomains.orgId, adminOrgIds),
                              eq(domains.configManaged, false)
                          )
                      )
                      .orderBy(asc(domains.baseDomain));

        return response<ListUserAdminOrgDomainsResponse>(res, {
            data: { domains: list },
            success: true,
            error: false,
            message: "Domains retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
