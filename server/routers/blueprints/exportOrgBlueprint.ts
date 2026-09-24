import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { generateOrgBlueprintYaml } from "@server/lib/blueprints/exportResourceBlueprint";

const exportOrgBlueprintSchema = z.strictObject({
    orgId: z.string()
});

export type ExportOrgBlueprintResponse = {
    name: string;
    contents: string;
    resourceCount: number;
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/blueprints/export",
    description:
        "Generate a blueprint YAML that recreates all public and private resources in the organization.",
    tags: [OpenAPITags.Blueprint],
    request: {
        params: exportOrgBlueprintSchema
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

export async function exportOrgBlueprint(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = exportOrgBlueprintSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        const { contents, resourceCount } =
            await generateOrgBlueprintYaml(orgId);

        return response<ExportOrgBlueprintResponse>(res, {
            data: { name: `${orgId}-blueprint`, contents, resourceCount },
            success: true,
            error: false,
            message: "Blueprint generated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                error instanceof Error ? error.message : "An error occurred"
            )
        );
    }
}
