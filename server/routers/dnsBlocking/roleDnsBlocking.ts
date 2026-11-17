import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, roleDnsBlocking, roles } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { eq } from "drizzle-orm";
import {
    DNS_BLOCK_CATEGORIES,
    getBlocklistSource,
    isDnsBlockCategory
} from "@server/lib/dnsBlocklist/source";
import { parseCategories } from "@server/lib/dnsBlocklist/resolve";
import { pushBlocklistForRoles } from "@server/lib/dnsBlocklist";
import { getDnsBlockEntitlements } from "#dynamic/lib/dnsBlocklist/entitlements";
import {
    allListsBelongToOrg,
    getRoleListIds,
    setRoleListIds
} from "#dynamic/lib/dnsBlocklist/customLists";
import type {
    GetRoleDnsBlockingResponse,
    ListDnsBlockCategoriesResponse,
    UpdateRoleDnsBlockingResponse
} from "@server/routers/dnsBlocking/types";

const roleParamsSchema = z.strictObject({
    roleId: z.coerce.number<string>().int().positive()
});

const orgParamsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z.strictObject({
    enabled: z.boolean(),
    categories: z.array(z.string()).max(DNS_BLOCK_CATEGORIES.length),
    listIds: z.array(z.number().int().positive()).max(500)
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/dns-block-categories",
    description:
        "List the built-in DNS blocking categories and which of them the organization can use.",
    tags: [OpenAPITags.Org],
    request: { params: orgParamsSchema },
    responses: { 200: { description: "Successful response" } }
});

export async function listDnsBlockCategories(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = orgParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { orgId } = parsedParams.data;

        const entitlements = await getDnsBlockEntitlements(orgId);
        const source = getBlocklistSource();

        const categories = [];
        for (const id of DNS_BLOCK_CATEGORIES) {
            const domains = await source.getCategoryDomains(id);
            categories.push({
                id,
                domainCount: domains.size,
                // Ads and malware is a community feature
                available: id === "ads" || entitlements.allCategories
            });
        }

        return response<ListDnsBlockCategoriesResponse>(res, {
            data: {
                categories,
                customListsAvailable: entitlements.customLists
            },
            success: true,
            error: false,
            message: "DNS block categories retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

registry.registerPath({
    method: "get",
    path: "/role/{roleId}/dns-blocking",
    description: "Get the DNS blocking applied to a role's members.",
    tags: [OpenAPITags.Role],
    request: { params: roleParamsSchema },
    responses: { 200: { description: "Successful response" } }
});

export async function getRoleDnsBlocking(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = roleParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { roleId } = parsedParams.data;

        const [row] = await db
            .select()
            .from(roleDnsBlocking)
            .where(eq(roleDnsBlocking.roleId, roleId))
            .limit(1);

        return response<GetRoleDnsBlockingResponse>(res, {
            data: {
                enabled: row?.enabled ?? false,
                categories: parseCategories(row?.categories),
                listIds: await getRoleListIds(roleId)
            },
            success: true,
            error: false,
            message: "Role DNS blocking retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

registry.registerPath({
    method: "post",
    path: "/role/{roleId}/dns-blocking",
    description: "Update the DNS blocking applied to a role's members.",
    tags: [OpenAPITags.Role],
    request: {
        params: roleParamsSchema,
        body: { content: { "application/json": { schema: bodySchema } } }
    },
    responses: { 200: { description: "Successful response" } }
});

export async function updateRoleDnsBlocking(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = roleParamsSchema.safeParse(req.params);
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
        const { roleId } = parsedParams.data;
        const body = parsedBody.data;

        const [role] = await db
            .select({ roleId: roles.roleId, orgId: roles.orgId })
            .from(roles)
            .where(eq(roles.roleId, roleId))
            .limit(1);
        if (!role) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Role with ID ${roleId} not found`
                )
            );
        }

        const unknown = body.categories.filter((c) => !isDnsBlockCategory(c));
        if (unknown.length > 0) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Unknown DNS blocking categories: ${unknown.join(", ")}`
                )
            );
        }
        const categories = [...new Set(body.categories)].sort();
        const listIds = [...new Set(body.listIds)];

        // Ads and malware blocking is open to everyone. Other categories and
        // custom lists need a license. After a downgrade a role can still hold
        // selections it made earlier, and keeping them is not an error; adding
        // new ones is.
        const entitlements = await getDnsBlockEntitlements(role.orgId);
        if (!entitlements.allCategories || !entitlements.customLists) {
            const [existing] = await db
                .select({ categories: roleDnsBlocking.categories })
                .from(roleDnsBlocking)
                .where(eq(roleDnsBlocking.roleId, roleId))
                .limit(1);
            const savedCategories = new Set(
                parseCategories(existing?.categories)
            );
            const savedListIds = new Set(await getRoleListIds(roleId));

            const addsPaidCategory =
                !entitlements.allCategories &&
                categories.some((c) => c !== "ads" && !savedCategories.has(c));
            const addsPaidList =
                !entitlements.customLists &&
                listIds.some((id) => !savedListIds.has(id));

            if (addsPaidCategory || addsPaidList) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Only ad and malware blocking is available without a license"
                    )
                );
            }
        }

        if (!(await allListsBelongToOrg(role.orgId, listIds))) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "One or more DNS block lists do not exist in this organization"
                )
            );
        }

        await db.transaction(async (trx) => {
            const values = {
                enabled: body.enabled,
                categories: JSON.stringify(categories)
            };
            await trx
                .insert(roleDnsBlocking)
                .values({ roleId, orgId: role.orgId, ...values })
                .onConflictDoUpdate({
                    target: roleDnsBlocking.roleId,
                    set: values
                });

            await setRoleListIds(trx, roleId, listIds);
        });

        // Devices of everyone in this role pick up the change right away.
        await pushBlocklistForRoles(role.orgId, [roleId]);

        return response<UpdateRoleDnsBlockingResponse>(res, {
            data: { enabled: body.enabled, categories, listIds },
            success: true,
            error: false,
            message: "Role DNS blocking updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
