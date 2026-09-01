import { db, resources, siteResources } from "@server/db";
import { listEffectiveAllowModels } from "@server/lib/aiInferenceResource";
import { response } from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";

const publicParamsSchema = z.strictObject({
    orgId: z.string().min(1),
    resourceId: z.coerce.number().int().positive()
});

const siteParamsSchema = z.strictObject({
    orgId: z.string().min(1),
    siteResourceId: z.coerce.number().int().positive()
});

export type ListLauncherAiModelsResponse = {
    models: Awaited<ReturnType<typeof listEffectiveAllowModels>>;
};

export async function listLauncherPublicAiModels(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const orgId = req.userOrgId;
        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        const parsed = publicParamsSchema.safeParse(req.params);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        const { resourceId } = parsed.data;

        const [resource] = await db
            .select({
                resourceId: resources.resourceId,
                mode: resources.mode
            })
            .from(resources)
            .where(
                and(
                    eq(resources.resourceId, resourceId),
                    eq(resources.orgId, orgId)
                )
            )
            .limit(1);

        if (!resource || resource.mode !== "inference") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "AI models are only available for inference resources"
                )
            );
        }

        const models = await listEffectiveAllowModels({ resourceId });
        return response<ListLauncherAiModelsResponse>(res, {
            data: { models },
            success: true,
            error: false,
            message: "Launcher AI models retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error listing launcher AI models:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}

export async function listLauncherSiteAiModels(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const orgId = req.userOrgId;
        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        const parsed = siteParamsSchema.safeParse(req.params);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsed.error)
                )
            );
        }

        const { siteResourceId } = parsed.data;

        const siteResource =
            req.siteResource ??
            (
                await db
                    .select({
                        siteResourceId: siteResources.siteResourceId,
                        mode: siteResources.mode,
                        orgId: siteResources.orgId
                    })
                    .from(siteResources)
                    .where(
                        and(
                            eq(siteResources.siteResourceId, siteResourceId),
                            eq(siteResources.orgId, orgId)
                        )
                    )
                    .limit(1)
            )[0];

        if (
            !siteResource ||
            siteResource.orgId !== orgId ||
            siteResource.mode !== "inference"
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "AI models are only available for inference resources"
                )
            );
        }

        const models = await listEffectiveAllowModels({ siteResourceId });
        return response<ListLauncherAiModelsResponse>(res, {
            data: { models },
            success: true,
            error: false,
            message: "Launcher AI models retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        console.error("Error listing launcher AI models:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Internal server error"
            )
        );
    }
}
