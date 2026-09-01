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
import { and, eq, isNull, ne } from "drizzle-orm";
import type { CreateOrEditAiBudgetResponse } from "@server/routers/aiBudget/types";
import {
    aiBudgetEnforcementSchema,
    aiBudgetPeriodSchema,
    aiBudgetUnitSchema,
    refineBudgetScopeFields
} from "@server/routers/aiBudget/validation";

const paramsSchema = z.strictObject({
    budgetId: z.coerce.number().int().positive()
});

const bodySchema = z.strictObject({
    providerId: z.coerce.number().int().positive().nullable().optional(),
    modelId: z.coerce.number().int().positive().nullable().optional(),
    resourceId: z.coerce.number().int().positive().nullable().optional(),
    siteResourceId: z.coerce.number().int().positive().nullable().optional(),
    roleId: z.coerce.number().int().positive().nullable().optional(),
    virtualApiKeyId: z.string().nonempty().nullable().optional(),
    amount: z.number().positive().optional(),
    unit: aiBudgetUnitSchema.optional(),
    period: aiBudgetPeriodSchema.optional(),
    enforcement: aiBudgetEnforcementSchema.optional(),
    enabled: z.boolean().optional()
});

registry.registerPath({
    method: "post",
    path: "/ai-budget/{budgetId}",
    description: "Update an AI budget.",
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
        200: {
            description: "Successful response"
        }
    }
});

export async function updateAiBudget(
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

        const { budgetId } = parsedParams.data;
        const body = parsedBody.data;

        const [existing] =
            req.aiBudget && req.aiBudget.budgetId === budgetId
                ? [req.aiBudget]
                : await db
                      .select()
                      .from(aiBudgets)
                      .where(eq(aiBudgets.budgetId, budgetId))
                      .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI budget with ID ${budgetId} not found`
                )
            );
        }

        const orgId = existing.orgId;

        const nextProviderId =
            body.providerId !== undefined
                ? body.providerId
                : existing.providerId;
        const nextModelId =
            body.modelId !== undefined ? body.modelId : existing.modelId;
        const nextResourceId =
            body.resourceId !== undefined
                ? body.resourceId
                : existing.resourceId;
        const nextSiteResourceId =
            body.siteResourceId !== undefined
                ? body.siteResourceId
                : existing.siteResourceId;
        const nextRoleId =
            body.roleId !== undefined ? body.roleId : existing.roleId;
        const nextVirtualApiKeyId =
            body.virtualApiKeyId !== undefined
                ? body.virtualApiKeyId
                : existing.virtualApiKeyId;
        const nextUnit = body.unit !== undefined ? body.unit : existing.unit;
        const nextPeriod =
            body.period !== undefined ? body.period : existing.period;

        const scopeValidation = z
            .object({
                providerId: z.number().nullable().optional(),
                modelId: z.number().nullable().optional(),
                resourceId: z.number().nullable().optional(),
                siteResourceId: z.number().nullable().optional(),
                roleId: z.number().nullable().optional(),
                virtualApiKeyId: z.string().nullable().optional()
            })
            .superRefine((data, ctx) => refineBudgetScopeFields(data, ctx))
            .safeParse({
                providerId: nextProviderId,
                modelId: nextModelId,
                resourceId: nextResourceId,
                siteResourceId: nextSiteResourceId,
                roleId: nextRoleId,
                virtualApiKeyId: nextVirtualApiKeyId
            });

        if (!scopeValidation.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(scopeValidation.error).toString()
                )
            );
        }

        if (body.providerId !== undefined && body.providerId !== null) {
            const [provider] = await db
                .select({ orgId: aiProviders.orgId })
                .from(aiProviders)
                .where(eq(aiProviders.providerId, body.providerId))
                .limit(1);
            if (!provider || provider.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `AI provider with ID ${body.providerId} not found in this organization`
                    )
                );
            }
        }

        if (body.modelId !== undefined && body.modelId !== null) {
            const [model] = await db
                .select({ orgId: aiProviders.orgId })
                .from(aiModels)
                .innerJoin(
                    aiProviders,
                    eq(aiModels.providerId, aiProviders.providerId)
                )
                .where(eq(aiModels.modelId, body.modelId))
                .limit(1);
            if (!model || model.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `AI model with ID ${body.modelId} not found in this organization`
                    )
                );
            }
        }

        if (body.resourceId !== undefined && body.resourceId !== null) {
            const [resource] = await db
                .select({ orgId: resources.orgId })
                .from(resources)
                .where(eq(resources.resourceId, body.resourceId))
                .limit(1);
            if (!resource || resource.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource with ID ${body.resourceId} not found in this organization`
                    )
                );
            }
        }

        if (
            body.siteResourceId !== undefined &&
            body.siteResourceId !== null
        ) {
            const [siteResource] = await db
                .select({ orgId: siteResources.orgId })
                .from(siteResources)
                .where(eq(siteResources.siteResourceId, body.siteResourceId))
                .limit(1);
            if (!siteResource || siteResource.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Site resource with ID ${body.siteResourceId} not found in this organization`
                    )
                );
            }
        }

        if (body.roleId !== undefined && body.roleId !== null) {
            const [role] = await db
                .select({ orgId: roles.orgId })
                .from(roles)
                .where(eq(roles.roleId, body.roleId))
                .limit(1);
            if (!role || role.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Role with ID ${body.roleId} not found in this organization`
                    )
                );
            }
        }

        if (
            body.virtualApiKeyId !== undefined &&
            body.virtualApiKeyId !== null
        ) {
            const [key] = await db
                .select({ orgId: virtualApiKeys.orgId })
                .from(virtualApiKeys)
                .where(
                    eq(
                        virtualApiKeys.virtualApiKeyId,
                        body.virtualApiKeyId
                    )
                )
                .limit(1);
            if (!key || key.orgId !== orgId) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Virtual API key with ID ${body.virtualApiKeyId} not found in this organization`
                    )
                );
            }
        }

        const scopeCondition =
            nextProviderId !== null
                ? eq(aiBudgets.providerId, nextProviderId)
                : nextModelId !== null
                  ? eq(aiBudgets.modelId, nextModelId)
                  : nextResourceId !== null
                    ? eq(aiBudgets.resourceId, nextResourceId)
                    : nextSiteResourceId !== null
                      ? eq(aiBudgets.siteResourceId, nextSiteResourceId)
                      : nextRoleId !== null
                        ? eq(aiBudgets.roleId, nextRoleId)
                        : nextVirtualApiKeyId !== null
                          ? eq(
                                aiBudgets.virtualApiKeyId,
                                nextVirtualApiKeyId
                            )
                          : and(
                                eq(aiBudgets.orgId, orgId),
                                isNull(aiBudgets.providerId),
                                isNull(aiBudgets.modelId),
                                isNull(aiBudgets.resourceId),
                                isNull(aiBudgets.siteResourceId),
                                isNull(aiBudgets.roleId),
                                isNull(aiBudgets.virtualApiKeyId)
                            );

        const [conflict] = await db
            .select({ budgetId: aiBudgets.budgetId })
            .from(aiBudgets)
            .where(
                and(
                    scopeCondition,
                    eq(aiBudgets.unit, nextUnit),
                    eq(aiBudgets.period, nextPeriod),
                    ne(aiBudgets.budgetId, budgetId)
                )
            )
            .limit(1);
        if (conflict) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    `A ${nextPeriod} ${nextUnit} budget already exists for this scope`
                )
            );
        }

        const updateData: Partial<typeof aiBudgets.$inferInsert> = {
            updatedAt: Date.now()
        };

        if (body.providerId !== undefined) {
            updateData.providerId = body.providerId;
        }
        if (body.modelId !== undefined) {
            updateData.modelId = body.modelId;
        }
        if (body.resourceId !== undefined) {
            updateData.resourceId = body.resourceId;
        }
        if (body.siteResourceId !== undefined) {
            updateData.siteResourceId = body.siteResourceId;
        }
        if (body.roleId !== undefined) {
            updateData.roleId = body.roleId;
        }
        if (body.virtualApiKeyId !== undefined) {
            updateData.virtualApiKeyId = body.virtualApiKeyId;
        }
        if (body.amount !== undefined) {
            updateData.amount = body.amount;
        }
        if (body.unit !== undefined) {
            updateData.unit = body.unit;
        }
        if (body.period !== undefined) {
            updateData.period = body.period;
        }
        if (body.enforcement !== undefined) {
            updateData.enforcement = body.enforcement;
        }
        if (body.enabled !== undefined) {
            updateData.enabled = body.enabled;
        }

        const [budget] = await db
            .update(aiBudgets)
            .set(updateData)
            .where(eq(aiBudgets.budgetId, budgetId))
            .returning();

        return response<CreateOrEditAiBudgetResponse>(res, {
            data: { budget },
            success: true,
            error: false,
            message: "AI budget updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
