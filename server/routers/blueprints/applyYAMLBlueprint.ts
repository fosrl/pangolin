import { OpenAPITags, registry } from "@server/openApi";
import z from "zod";
import { applyBlueprint } from "@server/lib/blueprints/applyBlueprint";
import { NextFunction, Request, Response } from "express";
import logger from "@server/logger";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromZodError } from "zod-validation-error";
import response from "@server/lib/response";
import { type Blueprint } from "@server/db";
import { parse as parseYaml } from "yaml";
import { ConfigSchema } from "@server/lib/blueprints/types";

const applyBlueprintSchema = z
    .object({
        name: z.string().min(1).max(255),
        blueprint: z
            .string()
            .min(1)
            .superRefine((val, ctx) => {
                try {
                    parseYaml(val);
                } catch (error) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Invalid YAML: ${error instanceof Error ? error.message : "Unknown error"}`
                    });
                }
            })
    })
    .strict();

const applyBlueprintParamsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

export type CreateBlueprintResponse = Blueprint;

registry.registerPath({
    method: "put",
    path: "/org/{orgId}/blueprint",
    description: "Create and apply a YAML blueprint to an organization",
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

export async function applyYAMLBlueprint(
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
                    fromZodError(parsedParams.error)
                )
            );
        }

        const { orgId } = parsedParams.data;

        const parsedBody = applyBlueprintSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedBody.error)
                )
            );
        }

        const { blueprint: contents, name } = parsedBody.data;

        logger.debug(`Received blueprint:`, contents);

        const parsedConfig = parseYaml(contents);
        // apply the validation in advance so that error concerning the format are ruled out first
        const validationResult = ConfigSchema.safeParse(parsedConfig);
        if (!validationResult.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(validationResult.error)
                )
            );
        }

        let blueprint: Blueprint | null = null;

        let error: string | null = null;
        try {
            blueprint = await applyBlueprint({
                orgId,
                name,
                source: "UI",
                configData: parsedConfig
            });
        } catch (err) {
            // We do nothing, the error is thrown for the other APIs & websockets for backwards compatibility
            // for this API, the error is already saved in the blueprint and we don't need to handle it
            logger.error(err);
            if (err instanceof Error) {
                error = err.message;
            }
        }

        if (!blueprint) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    error
                        ? error
                        : "An unknown error occurred while applying the blueprint"
                )
            );
        }

        return response(res, {
            data: blueprint,
            success: true,
            error: false,
            message: "Done",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
