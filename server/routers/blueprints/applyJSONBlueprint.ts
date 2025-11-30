import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { applyBlueprint } from "@server/lib/blueprints/applyBlueprint";

const applyBlueprintSchema = z
    .object({
        blueprint: z.string()
    })
    .strict();

const applyBlueprintParamsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/blueprint",
    description: "Apply a base64 encoded JSON blueprint to an organization",
    tags: [OpenAPITags.Org, OpenAPITags.Blueprint],
    request: {
        params: applyBlueprintParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: applyBlueprintSchema
                }
            }
        }
    },
    responses: {}
});

export async function applyJSONBlueprint(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = applyBlueprintParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        const parsedBody = applyBlueprintSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { blueprint } = parsedBody.data;

        if (!blueprint) {
            logger.warn("No blueprint provided");
            return;
        }

        logger.debug(`Received blueprint: ${blueprint}`);

        try {
            // first base64 decode the blueprint
            const decoded = Buffer.from(blueprint, "base64").toString("utf-8");
            // then parse the json
            const blueprintParsed = JSON.parse(decoded);

            // Update the blueprint in the database
            await applyBlueprint({
                orgId,
                configData: blueprintParsed,
                source: "API"
            });
        } catch (error) {
            logger.error(`Failed to update database from config: ${error}`);
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Failed to update database from config: ${error}`
                )
            );
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Blueprint applied successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
