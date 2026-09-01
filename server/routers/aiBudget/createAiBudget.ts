import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    aiBudgets,
    aiModels,
    aiProviders,
    db,
    resources,
    roles,
    siteResources,
    virtualApiKeys
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq, isNull } from "drizzle-orm";
import type { CreateOrEditAiBudgetResponse } from "@server/routers/aiBudget/types";
import {
    aiBudgetEnforcementSchema,
    aiBudgetPeriodSchema,
    aiBudgetUnitSchema,
    refineBudgetScopeFields
} from "@server/routers/aiBudget/validation";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z
    .strictObject({
        providerId: z.coerce.number().int().positive().optional(),
        modelId: z.coerce.number().int().positive().optional(),
        resourceId: z.coerce.number().int().positive().optional(),
        siteResourceId: z.coerce.number().int().positive().optional(),
        roleId: z.coerce.number().int().positive().optional(),
        virtualApiKeyId: z.string().nonempty().optional(),
        amount: z.number().positive(),
        unit: aiBudgetUnitSchema,
        period: aiBudgetPeriodSchema.optional().default("monthly"),
        enforcement: aiBudgetEnforcementSchema.optional().default("hard"),
        enabled: z.boolean().optional()
    })
    .superRefine((data, ctx) => refineBudgetScopeFields(data, ctx));

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/ai-budget",
    description: "Create an AI budget for an organization.",
    tags: [OpenAPITags.AiBudget],
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
    responses: {
        201: {
            description: "Successful response"
        }
    }
});

export async function createAiBudget(
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
        const {
            providerId,
            modelId,
            resourceId,
            siteResourceId,
            roleId,
            virtualApiKeyId,
            amount,
            unit,
            period,
            enforcement,
            enabled
        } = parsedBody.data;

        if (providerId !== undefined) {
            const [provider] = await db
                .select({ orgId: aiProviders.orgId })
                .from(aiProviders)
                .where(eq(aiProviders.providerId, providerId))
                .limit(1);
            if (!provider || provider.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `AI provider with ID ${providerId} not found in this organization`
                    )
                );
            }
        }

        if (modelId !== undefined) {
            const [model] = await db
                .select({ orgId: aiProviders.orgId })
                .from(aiModels)
                .innerJoin(
                    aiProviders,
                    eq(aiModels.providerId, aiProviders.providerId)
                )
                .where(eq(aiModels.modelId, modelId))
                .limit(1);
            if (!model || model.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `AI model with ID ${modelId} not found in this organization`
                    )
                );
            }
        }

        if (resourceId !== undefined) {
            const [resource] = await db
                .select({ orgId: resources.orgId })
                .from(resources)
                .where(eq(resources.resourceId, resourceId))
                .limit(1);
            if (!resource || resource.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource with ID ${resourceId} not found in this organization`
                    )
                );
            }
        }

        if (siteResourceId !== undefined) {
            const [siteResource] = await db
                .select({ orgId: siteResources.orgId })
                .from(siteResources)
                .where(eq(siteResources.siteResourceId, siteResourceId))
                .limit(1);
            if (!siteResource || siteResource.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Site resource with ID ${siteResourceId} not found in this organization`
                    )
                );
            }
        }

        if (roleId !== undefined) {
            const [role] = await db
                .select({ orgId: roles.orgId })
                .from(roles)
                .where(eq(roles.roleId, roleId))
                .limit(1);
            if (!role || role.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Role with ID ${roleId} not found in this organization`
                    )
                );
            }
        }

        if (virtualApiKeyId !== undefined) {
            const [key] = await db
                .select({ orgId: virtualApiKeys.orgId })
                .from(virtualApiKeys)
                .where(eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId))
                .limit(1);
            if (!key || key.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Virtual API key with ID ${virtualApiKeyId} not found in this organization`
                    )
                );
            }
        }

        const scopeCondition =
            providerId !== undefined
                ? eq(aiBudgets.providerId, providerId)
                : modelId !== undefined
                  ? eq(aiBudgets.modelId, modelId)
                  : resourceId !== undefined
                    ? eq(aiBudgets.resourceId, resourceId)
                    : siteResourceId !== undefined
                      ? eq(aiBudgets.siteResourceId, siteResourceId)
                      : roleId !== undefined
                        ? eq(aiBudgets.roleId, roleId)
                        : virtualApiKeyId !== undefined
                          ? eq(aiBudgets.virtualApiKeyId, virtualApiKeyId)
                          : and(
                                eq(aiBudgets.orgId, orgId),
                                isNull(aiBudgets.providerId),
                                isNull(aiBudgets.modelId),
                                isNull(aiBudgets.resourceId),
                                isNull(aiBudgets.siteResourceId),
                                isNull(aiBudgets.roleId),
                                isNull(aiBudgets.virtualApiKeyId)
                            );

        const [existing] = await db
            .select({ budgetId: aiBudgets.budgetId })
            .from(aiBudgets)
            .where(
                and(
                    scopeCondition,
                    eq(aiBudgets.unit, unit),
                    eq(aiBudgets.period, period)
                )
            )
            .limit(1);
        if (existing) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `A ${period} ${unit} budget already exists for this scope`
                )
            );
        }

        const now = Date.now();
        const [budget] = await db
            .insert(aiBudgets)
            .values({
                orgId,
                providerId: providerId ?? null,
                modelId: modelId ?? null,
                resourceId: resourceId ?? null,
                siteResourceId: siteResourceId ?? null,
                roleId: roleId ?? null,
                virtualApiKeyId: virtualApiKeyId ?? null,
                amount,
                unit,
                period,
                enforcement,
                enabled: enabled ?? true,
                createdAt: now,
                updatedAt: now
            })
            .returning();

        return response<CreateOrEditAiBudgetResponse>(res, {
            data: { budget },
            success: true,
            error: false,
            message: "AI budget created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
