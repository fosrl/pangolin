import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    orgs,
    userOrgs,
    virtualApiKeyResources,
    virtualApiKeys
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import { createDate, TimeSpan } from "oslo";
import {
    assertManualKeyResourcesInOrg,
    decryptVirtualApiKeyToken,
    replaceVirtualApiKeyResources,
    toPublicVirtualApiKey
} from "@server/lib/virtualApiKey";
import type { CreateOrEditVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";
import { updateVirtualApiKeyBodySchema } from "@server/routers/virtualApiKey/validation";
import {
    resolveVirtualApiKeyEmailRecipients,
    sendVirtualApiKeyEmails
} from "@server/lib/sendVirtualApiKeyEmail";

const paramsSchema = z.strictObject({
    virtualApiKeyId: z.string().nonempty()
});

registry.registerPath({
    method: "post",
    path: "/virtual-api-key/{virtualApiKeyId}",
    description:
        "Update a manual virtual API key metadata and resource assignment.",
    tags: [OpenAPITags.VirtualApiKey],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: updateVirtualApiKeyBodySchema
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

export async function updateVirtualApiKey(
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

        const parsedBody = updateVirtualApiKeyBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { virtualApiKeyId } = parsedParams.data;
        const body = parsedBody.data;

        const [existing] =
            req.virtualApiKey &&
            req.virtualApiKey.virtualApiKeyId === virtualApiKeyId
                ? [req.virtualApiKey]
                : await db
                      .select()
                      .from(virtualApiKeys)
                      .where(
                          eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId)
                      )
                      .limit(1);

        if (!existing || existing.kind !== "manual") {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Virtual API key with ID ${virtualApiKeyId} not found`
                )
            );
        }

        if (body.userId) {
            const [membership] = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, body.userId),
                        eq(userOrgs.orgId, existing.orgId)
                    )
                )
                .limit(1);

            if (!membership) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "User is not a member of this organization"
                    )
                );
            }
        }

        const nextAllResources =
            body.allResources !== undefined
                ? body.allResources
                : existing.allResources;

        let nextResourceIds: number[] | undefined;
        if (nextAllResources) {
            nextResourceIds = [];
        } else if (body.resourceIds !== undefined) {
            nextResourceIds = body.resourceIds;
        }

        if (nextResourceIds !== undefined) {
            const resourceCheck = await assertManualKeyResourcesInOrg({
                allResources: nextAllResources,
                resourceIds: nextResourceIds,
                orgId: existing.orgId
            });
            if (!resourceCheck.ok) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, resourceCheck.message)
                );
            }
        }

        const nextUserId =
            body.userId !== undefined ? body.userId : existing.userId;
        const emailRecipients = await resolveVirtualApiKeyEmailRecipients({
            sendEmail: body.sendEmail,
            sendToAttributedUser: body.sendToAttributedUser,
            userId: nextUserId,
            emails: body.emails
        });
        if (!emailRecipients.ok) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, emailRecipients.message)
            );
        }

        const updates: Partial<typeof virtualApiKeys.$inferInsert> = {};

        if (body.name !== undefined) {
            updates.name = body.name;
        }
        if (body.description !== undefined) {
            updates.description = body.description;
        }
        if (body.userId !== undefined) {
            updates.userId = body.userId;
        }
        if (body.allResources !== undefined) {
            updates.allResources = body.allResources;
        }
        if (body.validForSeconds !== undefined) {
            updates.expiresAt =
                body.validForSeconds === null
                    ? null
                    : createDate(
                          new TimeSpan(body.validForSeconds, "s")
                      ).getTime();
        }

        const updated = await db.transaction(async (trx) => {
            let row = existing;

            if (Object.keys(updates).length > 0) {
                const [updatedRow] = await trx
                    .update(virtualApiKeys)
                    .set(updates)
                    .where(eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId))
                    .returning();
                row = updatedRow;
            }

            if (nextResourceIds !== undefined) {
                await replaceVirtualApiKeyResources(
                    trx,
                    virtualApiKeyId,
                    nextResourceIds
                );
            }

            return row;
        });

        if (emailRecipients.recipients.length > 0) {
            const [org] = await db
                .select()
                .from(orgs)
                .where(eq(orgs.orgId, existing.orgId))
                .limit(1);

            await sendVirtualApiKeyEmails({
                recipients: emailRecipients.recipients,
                orgName: org?.name || existing.orgId,
                orgId: existing.orgId,
                keyName: updated.name,
                virtualApiKeyId: updated.virtualApiKeyId,
                secret: decryptVirtualApiKeyToken(updated.token),
                allResources: updated.allResources
            });
        }

        const resourceRows = await db
            .select({ resourceId: virtualApiKeyResources.resourceId })
            .from(virtualApiKeyResources)
            .where(eq(virtualApiKeyResources.virtualApiKeyId, virtualApiKeyId));

        return response<CreateOrEditVirtualApiKeyResponse>(res, {
            data: {
                virtualApiKey: {
                    ...toPublicVirtualApiKey(updated),
                    resourceIds: resourceRows.map((row) => row.resourceId)
                }
            },
            success: true,
            error: false,
            message: "Virtual API key updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
