import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, siteResources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import { generatePrivateResourceBlueprintYaml } from "@server/lib/blueprints/exportResourceBlueprint";

const exportSiteResourceBlueprintSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

export type ExportSiteResourceBlueprintResponse = z.infer<
    typeof ExportSiteResourceBlueprintResponseDataSchema
>;

const ExportSiteResourceBlueprintResponseDataSchema = z.object({
    name: z.string().openapi({
        description: "Suggested name for the blueprint (the resource nice ID)."
    }),
    contents: z.string().openapi({
        description: "Blueprint YAML that recreates this private resource."
    })
});

registry.registerPath({
    method: "get",
    path: "/site-resource/{siteResourceId}/blueprint",
    description:
        "Generate a blueprint YAML snippet that recreates this site resource.",
    tags: [OpenAPITags.PrivateResource, OpenAPITags.Blueprint],
    request: {
        params: exportSiteResourceBlueprintSchema
    },
    responses: createApiSuccessResponses(
        ExportSiteResourceBlueprintResponseDataSchema
    )
});

export async function exportSiteResourceBlueprint(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = exportSiteResourceBlueprintSchema.safeParse(
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

        const { siteResourceId } = parsedParams.data;

        const [siteResource] = await db
            .select({ niceId: siteResources.niceId })
            .from(siteResources)
            .where(eq(siteResources.siteResourceId, siteResourceId))
            .limit(1);

        if (!siteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        const { niceId, contents } =
            await generatePrivateResourceBlueprintYaml(siteResourceId);

        return response<ExportSiteResourceBlueprintResponse>(res, {
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
