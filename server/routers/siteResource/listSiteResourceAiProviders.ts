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
import { AiProviderAttachmentSchema } from "@server/routers/aiProvider/types";
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import { listSiteResourceAiProviders as listAttachments } from "@server/lib/aiInferenceResource";

const listSiteResourceAiProvidersParamsSchema = z.strictObject({
    siteResourceId: z.coerce.number().int().positive()
});

export type ListSiteResourceAiProvidersResponse = z.infer<
    typeof ListSiteResourceAiProvidersResponseDataSchema
>;

const ListSiteResourceAiProvidersResponseDataSchema = z.object({
    providers: z.array(AiProviderAttachmentSchema)
});

registry.registerPath({
    method: "get",
    path: "/site-resource/{siteResourceId}/ai-providers",
    description:
        "List AI providers attached to an inference site resource, including each attachment's accessMode.",
    tags: [OpenAPITags.PrivateResource],
    request: {
        params: listSiteResourceAiProvidersParamsSchema
    },
    responses: createApiSuccessResponses(
        ListSiteResourceAiProvidersResponseDataSchema
    )
});

export async function listSiteResourceAiProviders(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = listSiteResourceAiProvidersParamsSchema.safeParse(
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
            .select()
            .from(siteResources)
            .where(eq(siteResources.siteResourceId, siteResourceId))
            .limit(1);

        if (!siteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        const providers = await listAttachments(siteResourceId);

        return response<ListSiteResourceAiProvidersResponse>(res, {
            data: { providers },
            success: true,
            error: false,
            message: "Site resource AI providers retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
