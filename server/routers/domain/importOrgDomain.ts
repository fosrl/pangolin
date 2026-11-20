import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, domains, orgDomains, orgs, roles, userOrgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { and, eq, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing";
import { build } from "@server/build";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    domainId: z.string().nonempty()
});

const bodySchema = z.strictObject({
    sourceOrgId: z.string().nonempty()
});

export type ImportOrgDomainResponse = {
    domainId: string;
};

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/domain/{domainId}/import",
    description:
        "Link an existing domain from a source organization to this organization. Requires a root API key.",
    tags: [OpenAPITags.Domain],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {}
});

async function userIsOrgAdmin(
    userId: string,
    orgId: string,
    session: Request["session"]
): Promise<boolean> {
    const [userOrgRow] = await db
        .select()
        .from(userOrgs)
        .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
        .limit(1);
    if (!userOrgRow) {
        return false;
    }

    const policyCheck = await checkOrgAccessPolicy({
        orgId,
        userId,
        session
    });
    if (!policyCheck.allowed || policyCheck.error) {
        return false;
    }

    const roleIds = await getUserOrgRoleIds(userId, orgId);
    if (roleIds.length === 0) {
        return false;
    }

    const [adminRole] = await db
        .select({ roleId: roles.roleId })
        .from(roles)
        .where(and(inArray(roles.roleId, roleIds), eq(roles.isAdmin, true)))
        .limit(1);

    return !!adminRole;
}

export async function importOrgDomain(
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
        const { orgId: targetOrgId, domainId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }
        const { sourceOrgId } = parsedBody.data;

        if (sourceOrgId === targetOrgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Source and target organization must be different"
                )
            );
        }

        const [sourceLink] = await db
            .select({ configManaged: domains.configManaged })
            .from(orgDomains)
            .innerJoin(domains, eq(domains.domainId, orgDomains.domainId))
            .where(
                and(
                    eq(orgDomains.domainId, domainId),
                    eq(orgDomains.orgId, sourceOrgId)
                )
            )
            .limit(1);

        if (!sourceLink) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Domain not found for the source organization"
                )
            );
        }

        if (sourceLink.configManaged) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Config managed domains are already available in every organization"
                )
            );
        }

        if (req.apiKey) {
            // An org key can't belong to both the source and the target org,
            // so it can't prove access to the source org's domain.
            if (!req.apiKey.isRoot) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Importing a domain requires a root API key"
                    )
                );
            }
        } else {
            const sourceAdmin = await userIsOrgAdmin(
                req.user!.userId,
                sourceOrgId,
                req.session
            );
            if (!sourceAdmin) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "You must be an organization admin in the source organization where this domain is linked"
                    )
                );
            }
        }

        const [targetOrg] = await db
            .select({ orgId: orgs.orgId })
            .from(orgs)
            .where(eq(orgs.orgId, targetOrgId))
            .limit(1);

        if (!targetOrg) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Target organization not found"
                )
            );
        }

        const [alreadyLinked] = await db
            .select({ domainId: orgDomains.domainId })
            .from(orgDomains)
            .where(
                and(
                    eq(orgDomains.domainId, domainId),
                    eq(orgDomains.orgId, targetOrgId)
                )
            )
            .limit(1);

        if (alreadyLinked) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    "This domain is already linked to the target organization"
                )
            );
        }

        if (build == "saas") {
            const usage = await usageService.getUsage(
                targetOrgId,
                LimitId.DOMAINS
            );
            if (!usage) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        "No usage data found for this organization"
                    )
                );
            }
            const rejectDomains = await usageService.checkLimitSet(
                targetOrgId,
                LimitId.DOMAINS,
                {
                    ...usage,
                    instantaneousValue: (usage.instantaneousValue || 0) + 1
                }
            );
            if (rejectDomains) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Domain limit exceeded. Please upgrade your plan."
                    )
                );
            }
        }

        await db.transaction(async (trx) => {
            await trx.insert(orgDomains).values({
                orgId: targetOrgId,
                domainId
            });
            await usageService.add(targetOrgId, LimitId.DOMAINS, 1, trx);
        });

        return response<ImportOrgDomainResponse>(res, {
            data: { domainId },
            success: true,
            error: false,
            message: "Domain imported successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
