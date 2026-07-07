import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { resourceRules, resourcePolicyRules, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import {
    isValidCIDR,
    isValidIP,
    isValidUrlGlobPattern
} from "@server/lib/validators";
import { OpenAPITags, registry } from "@server/openApi";
import { isValidRegionId } from "@server/db/regions";

const createResourceRuleSchema = z.strictObject({
    action: z.enum(["ACCEPT", "DROP", "PASS"]),
    match: z.enum(["CIDR", "IP", "PATH", "COUNTRY", "ASN", "REGION"]),
    value: z.string().min(1),
    priority: z.int(),
    enabled: z.boolean().optional()
});

const createResourceRuleParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "put",
    path: "/resource/{resourceId}/rule",
    description: "Create a resource rule.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Rule],
    request: {
        params: createResourceRuleParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourceRuleSchema
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

export async function createResourceRule(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = createResourceRuleSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { action, match, value, priority, enabled } = parsedBody.data;

        const parsedParams = createResourceRuleParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;

        // Verify that the referenced resource exists
        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        if (!["http", "ssh", "rdp", "vnc"].includes(resource.mode)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Cannot create rule for non-http resource"
                )
            );
        }

        if (match === "CIDR") {
            if (!isValidCIDR(value)) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid CIDR provided"
                    )
                );
            }
        } else if (match === "IP") {
            if (!isValidIP(value)) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid IP provided")
                );
            }
        } else if (match === "PATH") {
            if (!isValidUrlGlobPattern(value)) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid URL glob pattern provided"
                    )
                );
            }
        } else if (match === "REGION") {
            if (!isValidRegionId(value)) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Invalid region ID provided"
                    )
                );
            }
        }

        // Create the new resource rule
        const isInlinePolicy =
            resource.resourcePolicyId === null &&
            resource.defaultResourcePolicyId !== null;

        if (isInlinePolicy) {
            const policyId = resource.defaultResourcePolicyId!;
            const [newRule] = await db
                .insert(resourcePolicyRules)
                .values({
                    resourcePolicyId: policyId,
                    action,
                    match,
                    value,
                    priority,
                    enabled
                })
                .returning();

            return response(res, {
                data: newRule,
                success: true,
                error: false,
                message: "Resource rule created successfully",
                status: HttpCode.CREATED
            });
        }

        // Create the new resource rule
        const [newRule] = await db
            .insert(resourceRules)
            .values({
                resourceId,
                action,
                match,
                value,
                priority,
                enabled
            })
            .returning();

        return response(res, {
            data: newRule,
            success: true,
            error: false,
            message: "Resource rule created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
