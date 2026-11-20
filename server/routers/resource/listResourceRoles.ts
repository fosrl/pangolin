import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { roleResources, roles, rolePolicies, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { RoleSummarySchema } from "@server/lib/openapi/schemas/access";
import {
    createApiSuccessResponses,
    Assert,
    Equals
} from "@server/lib/openapi/createApiResponseSchema";

const listResourceRolesSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

async function query(resourceId: number) {
    return await db
        .select({
            roleId: roles.roleId,
            name: roles.name,
            description: roles.description,
            isAdmin: roles.isAdmin
        })
        .from(roleResources)
        .innerJoin(roles, eq(roleResources.roleId, roles.roleId))
        .where(eq(roleResources.resourceId, resourceId));
}

async function queryInlinePolicy(policyId: number) {
    return await db
        .select({
            roleId: roles.roleId,
            name: roles.name,
            description: roles.description,
            isAdmin: roles.isAdmin
        })
        .from(rolePolicies)
        .innerJoin(roles, eq(rolePolicies.roleId, roles.roleId))
        .where(eq(rolePolicies.resourcePolicyId, policyId));
}

export type ListResourceRolesResponse = {
    roles: NonNullable<Awaited<ReturnType<typeof query>>>;
};

const ListResourceRolesResponseDataSchema = z.object({
    roles: z.array(RoleSummarySchema)
});

type _ListResourceRolesResponseDataSchemaCheck = Assert<
    Equals<
        z.infer<typeof ListResourceRolesResponseDataSchema>,
        ListResourceRolesResponse
    >
>;

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/roles",
    description: "List all roles for a resource.",
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: listResourceRolesSchema
    },
    responses: createApiSuccessResponses(ListResourceRolesResponseDataSchema)
});

registry.registerPath({
    method: "get",
    path: "/public-resource/{resourceId}/roles",
    description: "List all roles for a resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Role],
    request: {
        params: listResourceRolesSchema
    },
    responses: createApiSuccessResponses(ListResourceRolesResponseDataSchema)
});

export async function listResourceRoles(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listResourceRolesSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        const resourceRolesList = isInlinePolicy
            ? await queryInlinePolicy(resource.defaultResourcePolicyId!)
            : await query(resourceId);

        return response<ListResourceRolesResponse>(res, {
            data: {
                roles: resourceRolesList
            },
            success: true,
            error: false,
            message: "Resource roles retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
