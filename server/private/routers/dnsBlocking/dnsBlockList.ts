/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, dnsBlockLists } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, asc, eq } from "drizzle-orm";
import { parseDomains } from "@server/lib/dnsBlocklist/parse";
import { pushBlocklistForRoles } from "@server/lib/dnsBlocklist";
import { getRoleIdsUsingList } from "./util";
import {
    DNS_BLOCK_LIST_MAX_DOMAINS,
    type CreateDnsBlockListResponse,
    type GetDnsBlockListResponse,
    type ListDnsBlockListsResponse,
    type UpdateDnsBlockListResponse
} from "@server/routers/dnsBlocking/types";

const orgParamsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const listParamsSchema = z.strictObject({
    orgId: z.string().nonempty(),
    listId: z.coerce.number<string>().int().positive()
});

const bodySchema = z.strictObject({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(1000).nullable().optional(),
    // Hosts-file lines or plain domains; normalized and de-duplicated here.
    domains: z.string().max(10_000_000),
    // Send browsers to the block page instead of failing the lookup
    showBlockPage: z.boolean().optional()
});

// Normalizes the submitted text. Returns an error message when it cannot be
// used, so a typo-only paste does not silently save an empty list.
function normalizeDomains(
    text: string
): { domains: string; count: number } | { error: string } {
    const parsed = parseDomains(text);
    if (parsed.size === 0 && text.trim().length > 0) {
        return { error: "No valid domain names found" };
    }
    if (parsed.size > DNS_BLOCK_LIST_MAX_DOMAINS) {
        return {
            error: `A list can have at most ${DNS_BLOCK_LIST_MAX_DOMAINS} domains`
        };
    }
    return { domains: [...parsed].sort().join("\n"), count: parsed.size };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/dns-block-lists",
    description: "List the custom DNS block lists of an organization.",
    tags: [OpenAPITags.Org],
    request: { params: orgParamsSchema },
    responses: { 200: { description: "Successful response" } }
});

export async function listDnsBlockLists(
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

        const lists = await db
            .select({
                dnsBlockListId: dnsBlockLists.dnsBlockListId,
                name: dnsBlockLists.name,
                description: dnsBlockLists.description,
                domainCount: dnsBlockLists.domainCount,
                showBlockPage: dnsBlockLists.showBlockPage,
                updatedAt: dnsBlockLists.updatedAt
            })
            .from(dnsBlockLists)
            .where(eq(dnsBlockLists.orgId, orgId))
            .orderBy(asc(dnsBlockLists.name));

        return response<ListDnsBlockListsResponse>(res, {
            data: { lists },
            success: true,
            error: false,
            message: "DNS block lists retrieved successfully",
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
    path: "/org/{orgId}/dns-block-list/{listId}",
    description: "Get a custom DNS block list, including its domains.",
    tags: [OpenAPITags.Org],
    request: { params: listParamsSchema },
    responses: { 200: { description: "Successful response" } }
});

export async function getDnsBlockList(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { orgId, listId } = parsedParams.data;

        const [list] = await db
            .select()
            .from(dnsBlockLists)
            .where(
                and(
                    eq(dnsBlockLists.dnsBlockListId, listId),
                    eq(dnsBlockLists.orgId, orgId)
                )
            )
            .limit(1);

        if (!list) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "DNS block list not found")
            );
        }

        return response<GetDnsBlockListResponse>(res, {
            data: {
                dnsBlockListId: list.dnsBlockListId,
                name: list.name,
                description: list.description,
                domainCount: list.domainCount,
                showBlockPage: list.showBlockPage,
                updatedAt: list.updatedAt,
                domains: list.domains
            },
            success: true,
            error: false,
            message: "DNS block list retrieved successfully",
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
    method: "put",
    path: "/org/{orgId}/dns-block-list",
    description: "Create a custom DNS block list.",
    tags: [OpenAPITags.Org],
    request: {
        params: orgParamsSchema,
        body: { content: { "application/json": { schema: bodySchema } } }
    },
    responses: { 201: { description: "Successful response" } }
});

export async function createDnsBlockList(
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
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }
        const { orgId } = parsedParams.data;
        const { name, description, domains, showBlockPage } = parsedBody.data;

        const normalized = normalizeDomains(domains);
        if ("error" in normalized) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, normalized.error)
            );
        }

        const [list] = await db
            .insert(dnsBlockLists)
            .values({
                orgId,
                name,
                description: description ?? null,
                domains: normalized.domains,
                domainCount: normalized.count,
                showBlockPage: showBlockPage ?? false,
                updatedAt: Math.floor(Date.now() / 1000)
            })
            .returning();

        // No role can reference a new list yet, so there is nothing to push.
        return response<CreateDnsBlockListResponse>(res, {
            data: {
                dnsBlockListId: list.dnsBlockListId,
                name: list.name,
                description: list.description,
                domainCount: list.domainCount,
                showBlockPage: list.showBlockPage,
                updatedAt: list.updatedAt,
                domains: list.domains
            },
            success: true,
            error: false,
            message: "DNS block list created successfully",
            status: HttpCode.CREATED
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
    path: "/org/{orgId}/dns-block-list/{listId}",
    description: "Update a custom DNS block list.",
    tags: [OpenAPITags.Org],
    request: {
        params: listParamsSchema,
        body: { content: { "application/json": { schema: bodySchema } } }
    },
    responses: { 200: { description: "Successful response" } }
});

export async function updateDnsBlockList(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listParamsSchema.safeParse(req.params);
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
        const { orgId, listId } = parsedParams.data;
        const { name, description, domains, showBlockPage } = parsedBody.data;

        const normalized = normalizeDomains(domains);
        if ("error" in normalized) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, normalized.error)
            );
        }

        const [list] = await db
            .update(dnsBlockLists)
            .set({
                name,
                description: description ?? null,
                domains: normalized.domains,
                domainCount: normalized.count,
                // left unchanged when the request does not include it
                ...(showBlockPage !== undefined ? { showBlockPage } : {}),
                updatedAt: Math.floor(Date.now() / 1000)
            })
            .where(
                and(
                    eq(dnsBlockLists.dnsBlockListId, listId),
                    eq(dnsBlockLists.orgId, orgId)
                )
            )
            .returning();

        if (!list) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "DNS block list not found")
            );
        }

        // Connected devices of every role using this list get the new domains.
        await pushBlocklistForRoles(orgId, await getRoleIdsUsingList(listId));

        return response<UpdateDnsBlockListResponse>(res, {
            data: {
                dnsBlockListId: list.dnsBlockListId,
                name: list.name,
                description: list.description,
                domainCount: list.domainCount,
                showBlockPage: list.showBlockPage,
                updatedAt: list.updatedAt,
                domains: list.domains
            },
            success: true,
            error: false,
            message: "DNS block list updated successfully",
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
    method: "delete",
    path: "/org/{orgId}/dns-block-list/{listId}",
    description: "Delete a custom DNS block list.",
    tags: [OpenAPITags.Org],
    request: { params: listParamsSchema },
    responses: { 200: { description: "Successful response" } }
});

export async function deleteDnsBlockList(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { orgId, listId } = parsedParams.data;

        // The roles using the list are lost once it is deleted (the join rows
        // cascade), so find them first.
        const roleIds = await getRoleIdsUsingList(listId);

        const deleted = await db
            .delete(dnsBlockLists)
            .where(
                and(
                    eq(dnsBlockLists.dnsBlockListId, listId),
                    eq(dnsBlockLists.orgId, orgId)
                )
            )
            .returning({ dnsBlockListId: dnsBlockLists.dnsBlockListId });

        if (deleted.length === 0) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "DNS block list not found")
            );
        }

        await pushBlocklistForRoles(orgId, roleIds);

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "DNS block list deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
