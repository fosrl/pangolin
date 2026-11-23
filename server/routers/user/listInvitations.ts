import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { userInvites, userInviteRoles, roles } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { sql, eq, and, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    PaginationSchema,
    LimitOffsetPaginationSchema
} from "@server/lib/openapi/pagination";
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import { createSelectSchema } from "drizzle-zod";

const listInvitationsParamsSchema = z.strictObject({
    orgId: z.string()
});

const listInvitationsQuerySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().nonnegative()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

export type InvitationListRow = ListInvitationsResponse["invitations"][number];

async function queryInvitations(
    orgId: string,
    limit: number,
    offset: number
): Promise<InvitationListRow[]> {
    const inviteRows = await db
        .select({
            inviteId: userInvites.inviteId,
            email: userInvites.email,
            expiresAt: userInvites.expiresAt
        })
        .from(userInvites)
        .where(eq(userInvites.orgId, orgId))
        .limit(limit)
        .offset(offset);

    if (inviteRows.length === 0) {
        return [];
    }

    const inviteIds = inviteRows.map((r) => r.inviteId);
    const roleRows = await db
        .select({
            inviteId: userInviteRoles.inviteId,
            roleId: userInviteRoles.roleId,
            roleName: roles.name
        })
        .from(userInviteRoles)
        .innerJoin(roles, eq(userInviteRoles.roleId, roles.roleId))
        .where(
            and(
                eq(roles.orgId, orgId),
                inArray(userInviteRoles.inviteId, inviteIds)
            )
        );

    const rolesByInvite = new Map<
        string,
        { roleId: number; roleName: string | null }[]
    >();
    for (const row of roleRows) {
        const list = rolesByInvite.get(row.inviteId) ?? [];
        list.push({ roleId: row.roleId, roleName: row.roleName });
        rolesByInvite.set(row.inviteId, list);
    }

    return inviteRows.map((inv) => ({
        inviteId: inv.inviteId,
        email: inv.email,
        expiresAt: inv.expiresAt,
        roles: rolesByInvite.get(inv.inviteId) ?? []
    }));
}

export type ListInvitationsResponse = z.infer<
    typeof ListInvitationsResponseDataSchema
>;

const InvitationListItemSchema = createSelectSchema(userInvites, {
    inviteId: (s) => s.openapi({ description: "ID of the invitation." }),
    email: (s) =>
        s.openapi({ description: "Email the invitation was sent to." }),
    expiresAt: (s) =>
        s.openapi({
            description: "Epoch milliseconds when the invitation expires."
        })
})
    .pick({ inviteId: true, email: true, expiresAt: true })
    .extend({
        roles: z
            .array(
                z.object({
                    roleId: z
                        .number()
                        .int()
                        .openapi({ description: "Numeric ID of the role." }),
                    roleName: z
                        .string()
                        .nullable()
                        .openapi({ description: "Role name." })
                })
            )
            .openapi({ description: "Roles the user receives when accepting." })
    });

const ListInvitationsResponseDataSchema = z.object({
    invitations: z.array(InvitationListItemSchema),
    pagination: LimitOffsetPaginationSchema
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/invitations",
    description: "List invitations in an organization.",
    tags: [OpenAPITags.Invitation],
    request: {
        params: listInvitationsParamsSchema,
        query: listInvitationsQuerySchema
    },
    responses: createApiSuccessResponses(ListInvitationsResponseDataSchema)
});

export async function listInvitations(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listInvitationsQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedQuery.error)
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listInvitationsParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }
        const { orgId } = parsedParams.data;

        const invitations = await queryInvitations(orgId, limit, offset);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(userInvites)
            .where(eq(userInvites.orgId, orgId));

        return response<ListInvitationsResponse>(res, {
            data: {
                invitations,
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Invitations retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
