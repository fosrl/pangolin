import {
    db,
    idp,
    resourcePolicyRules,
    resourcePolicies,
    resourcePolicyHeaderAuth,
    resourcePolicyPassword,
    resourcePolicyPincode,
    resourcePolicyWhiteList,
    rolePolicies,
    roles,
    userPolicies,
    users
} from "@server/db";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import HttpCode from "@server/types/HttpCode";
import { and, eq, isNull, not, or, type SQL } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import z from "zod";
import { fromError } from "zod-validation-error";

const getResourcePolicySchema = z
    .strictObject({
        niceId: z.string(),
        orgId: z.string()
    })
    .or(
        z.strictObject({
            resourcePolicyId: z.coerce
                .number<string>()
                .int()
                .positive()
                .openapi({
                    type: "integer",
                    description: "Resource policy ID"
                })
        })
    );

export async function queryResourcePolicy(
    params: z.infer<typeof getResourcePolicySchema>
) {
    const conditions: SQL<unknown>[] = [];
    if ("resourcePolicyId" in params) {
        conditions.push(
            eq(resourcePolicies.resourcePolicyId, params.resourcePolicyId)
        );
    } else {
        conditions.push(
            eq(resourcePolicies.niceId, params.niceId),
            eq(resourcePolicies.orgId, params.orgId)
        );
    }

    const [res] = await db
        .select({
            resourcePolicyId: resourcePolicies.resourcePolicyId,
            sso: resourcePolicies.sso,
            applyRules: resourcePolicies.applyRules,
            emailWhitelistEnabled: resourcePolicies.emailWhitelistEnabled,
            idpId: resourcePolicies.idpId,
            niceId: resourcePolicies.niceId,
            name: resourcePolicies.name,
            passwordId: resourcePolicyPassword.passwordId,
            pincodeId: resourcePolicyPincode.pincodeId,
            headerAuth: {
                id: resourcePolicyHeaderAuth.headerAuthId,
                extendedCompability:
                    resourcePolicyHeaderAuth.extendedCompatibility
            }
        })
        .from(resourcePolicies)
        .leftJoin(
            resourcePolicyPassword,
            eq(
                resourcePolicyPassword.resourcePolicyId,
                resourcePolicies.resourcePolicyId
            )
        )
        .leftJoin(
            resourcePolicyPincode,
            eq(
                resourcePolicyPincode.resourcePolicyId,
                resourcePolicies.resourcePolicyId
            )
        )
        .leftJoin(
            resourcePolicyHeaderAuth,
            eq(
                resourcePolicyHeaderAuth.resourcePolicyId,
                resourcePolicies.resourcePolicyId
            )
        )
        .where(and(...conditions))
        .limit(1);

    if (!res) return null;

    const policyUsers = await db
        .select({
            userId: userPolicies.userId,
            email: users.email,
            name: users.name,
            username: users.username,
            type: users.type,
            idpName: idp.name
        })
        .from(userPolicies)
        .innerJoin(users, eq(userPolicies.userId, users.userId))
        .leftJoin(idp, eq(idp.idpId, users.idpId))
        .where(eq(userPolicies.resourcePolicyId, res.resourcePolicyId));

    const policyRoles = await db
        .select({
            roleId: rolePolicies.roleId,
            name: roles.name
        })
        .from(rolePolicies)
        .innerJoin(
            roles,
            and(
                eq(rolePolicies.roleId, roles.roleId),
                or(isNull(roles.isAdmin), not(roles.isAdmin))
            )
        )
        .where(eq(rolePolicies.resourcePolicyId, res.resourcePolicyId));

    const policyEmailWhiteList = await db
        .select({
            whiteListId: resourcePolicyWhiteList.whitelistId,
            email: resourcePolicyWhiteList.email
        })
        .from(resourcePolicyWhiteList)
        .where(
            eq(resourcePolicyWhiteList.resourcePolicyId, res.resourcePolicyId)
        );

    const policyRules = await db
        .select({
            ruleId: resourcePolicyRules.ruleId,
            enabled: resourcePolicyRules.enabled,
            priority: resourcePolicyRules.priority,
            action: resourcePolicyRules.action,
            match: resourcePolicyRules.match,
            value: resourcePolicyRules.value
        })
        .from(resourcePolicyRules)
        .where(eq(resourcePolicyRules.resourcePolicyId, res.resourcePolicyId));

    return {
        ...res,
        roles: policyRoles,
        users: policyUsers,
        emailWhiteList: policyEmailWhiteList,
        rules: policyRules
    };
}

export type GetResourcePolicyResponse = NonNullable<
    Awaited<ReturnType<typeof queryResourcePolicy>>
>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/resource-policy/{niceId}",
    description:
        "Get a resource policy by orgId and niceId. NiceId is a readable ID for the resource and unique on a per org basis.",
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: z.object({
            orgId: z.string(),
            niceId: z.string()
        })
    },
    responses: {}
});

registry.registerPath({
    method: "get",
    path: "/resource-policy/{resourcePolicyId}",
    description: "Get a resource policy by its resourcePolicyId.",
    tags: [OpenAPITags.PublicResourcePolicyLegacy],
    request: {
        params: z.object({
            resourcePolicyId: z.number()
        })
    },
    responses: {}
});

registry.registerPath({
    method: "get",
    path: "/public-resource-policy/{resourcePolicyId}",
    description: "Get a resource policy by its resourcePolicyId.",
    tags: [OpenAPITags.PublicResourcePolicy],
    request: {
        params: z.object({
            resourcePolicyId: z.number()
        })
    },
    responses: {}
});

export async function getResourcePolicy(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getResourcePolicySchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const policy = await queryResourcePolicy(parsedParams.data);

        if (!policy) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource policy not found")
            );
        }

        return response<GetResourcePolicyResponse>(res, {
            data: policy,
            success: true,
            error: false,
            message: "Resource Policy retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
