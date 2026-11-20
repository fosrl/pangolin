import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import {
    createApiSuccessResponses,
    Assert,
    Equals
} from "@server/lib/openapi/createApiResponseSchema";
import { generatePublicResourceBlueprintYaml } from "@server/lib/blueprints/exportResourceBlueprint";

const exportResourceBlueprintSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

export type ExportResourceBlueprintResponse = {
    name: string;
    contents: string;
};

const ExportResourceBlueprintResponseDataSchema = z.object({
    name: z.string().openapi({
        description: "Suggested name for the blueprint (the resource nice ID)."
    }),
    contents: z.string().openapi({
        description: "Blueprint YAML that recreates this resource."
    })
});

type _ExportResourceBlueprintResponseDataSchemaCheck = Assert<
    Equals<
        z.infer<typeof ExportResourceBlueprintResponseDataSchema>,
        ExportResourceBlueprintResponse
    >
>;

registry.registerPath({
    method: "get",
    path: "/resource/{resourceId}/blueprint",
    description:
        "Generate a blueprint YAML snippet that recreates this resource.",
    tags: [OpenAPITags.PublicResource, OpenAPITags.Blueprint],
    request: {
        params: exportResourceBlueprintSchema
    },
    responses: createApiSuccessResponses(
        ExportResourceBlueprintResponseDataSchema
    )
});

export async function exportResourceBlueprint(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = exportResourceBlueprintSchema.safeParse(
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

        const [resource] = await db
            .select({ niceId: resources.niceId })
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        const { niceId, contents } =
            await generatePublicResourceBlueprintYaml(resourceId);

        return response<ExportResourceBlueprintResponse>(res, {
            data: { name: niceId, contents },
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
