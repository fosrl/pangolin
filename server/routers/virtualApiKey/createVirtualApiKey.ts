import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, orgs, userOrgs, virtualApiKeys } from "@server/db";
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
    encryptVirtualApiKeyToken,
    mintVirtualApiKeySecret,
    replaceVirtualApiKeyResources,
    toPublicVirtualApiKey
} from "@server/lib/virtualApiKey";
import type { CreateOrEditVirtualApiKeyResponse } from "@server/routers/virtualApiKey/types";
import { createVirtualApiKeyBodySchema } from "@server/routers/virtualApiKey/validation";
import {
    resolveVirtualApiKeyEmailRecipients,
    sendVirtualApiKeyEmails
} from "@server/lib/sendVirtualApiKeyEmail";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/virtual-api-key",
    description: "Create a manual virtual API key for an organization.",
    tags: [OpenAPITags.VirtualApiKey],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createVirtualApiKeyBodySchema
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

export async function createVirtualApiKey(
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

        const parsedBody = createVirtualApiKeyBodySchema.safeParse(req.body);
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
            name,
            description,
            userId,
            allResources,
            resourceIds,
            validForSeconds,
            sendEmail: doEmail,
            sendToAttributedUser,
            emails
        } = parsedBody.data;

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        if (userId) {
            const [membership] = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId))
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

        const assignedResourceIds = allResources ? [] : (resourceIds ?? []);
        const resourceCheck = await assertManualKeyResourcesInOrg({
            allResources,
            resourceIds: assignedResourceIds,
            orgId
        });
        if (!resourceCheck.ok) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, resourceCheck.message)
            );
        }

        const emailRecipients = await resolveVirtualApiKeyEmailRecipients({
            sendEmail: doEmail,
            sendToAttributedUser,
            userId,
            emails
        });
        if (!emailRecipients.ok) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, emailRecipients.message)
            );
        }

        const minted = mintVirtualApiKeySecret();
        const expiresAt = validForSeconds
            ? createDate(new TimeSpan(validForSeconds, "s")).getTime()
            : null;
        const now = Date.now();

        const created = await db.transaction(async (trx) => {
            const [row] = await trx
                .insert(virtualApiKeys)
                .values({
                    virtualApiKeyId: minted.virtualApiKeyId,
                    orgId,
                    kind: "manual",
                    userId: userId ?? null,
                    name,
                    description: description ?? null,
                    token: encryptVirtualApiKeyToken(minted.secret),
                    lastChars: minted.lastChars,
                    allResources,
                    expiresAt,
                    lastUsedAt: null,
                    createdAt: now,
                    createdByUserId: req.user?.userId ?? null
                })
                .returning();

            await replaceVirtualApiKeyResources(
                trx,
                row.virtualApiKeyId,
                assignedResourceIds
            );

            return row;
        });

        if (emailRecipients.recipients.length > 0) {
            const [org] = await db
                .select()
                .from(orgs)
                .where(eq(orgs.orgId, orgId))
                .limit(1);

            await sendVirtualApiKeyEmails({
                recipients: emailRecipients.recipients,
                orgName: org?.name || orgId,
                orgId,
                keyName: created.name,
                virtualApiKeyId: created.virtualApiKeyId,
                secret: minted.secret,
                allResources: created.allResources
            });
        }

        return response<CreateOrEditVirtualApiKeyResponse>(res, {
            data: {
                virtualApiKey: {
                    ...toPublicVirtualApiKey(created, { includeSecret: true }),
                    resourceIds: assignedResourceIds
                }
            },
            success: true,
            error: false,
            message: "Virtual API key created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
