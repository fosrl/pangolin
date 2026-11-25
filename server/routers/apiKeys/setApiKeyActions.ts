import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { actions, apiKeyActions, roleActions, userActions } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { eq, and, inArray } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { callerIsOrgAdmin } from "@server/lib/callerIsOrgAdmin";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

// Actions a user may hand to an API key: those from their roles in the org
// and any granted to them directly
async function getUserActionIds(
    userId: string,
    orgId: string,
    roleIds: number[] | undefined
): Promise<Set<string>> {
    const userRoleIds = roleIds ?? (await getUserOrgRoleIds(userId, orgId));

    const fromRoles =
        userRoleIds.length > 0
            ? await db
                  .select({ actionId: roleActions.actionId })
                  .from(roleActions)
                  .where(
                      and(
                          inArray(roleActions.roleId, userRoleIds),
                          eq(roleActions.orgId, orgId)
                      )
                  )
            : [];

    const direct = await db
        .select({ actionId: userActions.actionId })
        .from(userActions)
        .where(
            and(eq(userActions.userId, userId), eq(userActions.orgId, orgId))
        );

    return new Set([...fromRoles, ...direct].map((a) => a.actionId));
}

const bodySchema = z.strictObject({
    actionIds: z
        .tuple([z.string()], z.string())
        .transform((v) => Array.from(new Set(v)))
});

const paramsSchema = z.object({
    apiKeyId: z.string().nonempty()
});

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/api-key/{apiKeyId}/actions",
    description:
        "Set actions for an API key. This will replace any existing actions.",
    tags: [OpenAPITags.ApiKey],
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
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function setApiKeyActions(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { actionIds: newActionIds } = parsedBody.data;

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { apiKeyId } = parsedParams.data;

        const actionsExist = await db
            .select()
            .from(actions)
            .where(inArray(actions.actionId, newActionIds));

        if (actionsExist.length !== newActionIds.length) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "One or more actions do not exist"
                )
            );
        }

        // Only a user acting inside an org can be limited here. Root API keys
        // and the server admin route are unrestricted.
        const callerUserId = req.apiKey ? undefined : req.user?.userId;
        const callerOrgId = req.userOrgId;
        const restrictToCallerActions =
            callerUserId !== undefined &&
            callerOrgId !== undefined &&
            !(await callerIsOrgAdmin(req, callerOrgId));
        const callerActionIds = restrictToCallerActions
            ? await getUserActionIds(
                  callerUserId!,
                  callerOrgId!,
                  req.userOrgRoleIds
              )
            : null;

        let notPossessed: string[] = [];

        await db.transaction(async (trx) => {
            const existingActions = await trx
                .select()
                .from(apiKeyActions)
                .where(eq(apiKeyActions.apiKeyId, apiKeyId));

            const existingActionIds = existingActions.map((a) => a.actionId);

            const actionIdsToAdd = newActionIds.filter(
                (id) => !existingActionIds.includes(id)
            );
            const actionIdsToRemove = existingActionIds.filter(
                (id) => !newActionIds.includes(id)
            );

            // Granting an action the caller does not hold would let them
            // escalate through the key
            if (callerActionIds) {
                notPossessed = actionIdsToAdd.filter(
                    (id) => !callerActionIds.has(id)
                );
                if (notPossessed.length > 0) {
                    return;
                }
            }

            if (actionIdsToRemove.length > 0) {
                await trx
                    .delete(apiKeyActions)
                    .where(
                        and(
                            eq(apiKeyActions.apiKeyId, apiKeyId),
                            inArray(apiKeyActions.actionId, actionIdsToRemove)
                        )
                    );
            }

            if (actionIdsToAdd.length > 0) {
                const insertValues = actionIdsToAdd.map((actionId) => ({
                    apiKeyId,
                    actionId
                }));
                await trx.insert(apiKeyActions).values(insertValues);
            }
        });

        if (notPossessed.length > 0) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    `Cannot grant actions you do not hold: ${notPossessed.join(", ")}`
                )
            );
        }

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "API key actions updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
