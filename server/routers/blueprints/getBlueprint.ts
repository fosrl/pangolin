import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "@server/db";
import { blueprints, orgs } from "@server/db";
import { eq, and } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { BlueprintData } from "./types";

const getBlueprintSchema = z.strictObject({
    blueprintId: z.coerce.number().int().positive(),
    orgId: z.string()
});

async function query(blueprintId: number, orgId: string) {
    // Get the client
    const [blueprint] = await db
        .select({
            blueprintId: blueprints.blueprintId,
            name: blueprints.name,
            source: blueprints.source,
            succeeded: blueprints.succeeded,
            orgId: blueprints.orgId,
            createdAt: blueprints.createdAt,
            message: blueprints.message,
            contents: blueprints.contents
        })
        .from(blueprints)
        .leftJoin(orgs, eq(blueprints.orgId, orgs.orgId))
        .where(
            and(
                eq(blueprints.blueprintId, blueprintId),
                eq(blueprints.orgId, orgId)
            )
        )
        .limit(1);

    if (!blueprint) {
        return null;
    }

    return blueprint;
}

export type GetBlueprintResponse = BlueprintData;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/blueprint/{blueprintId}",
    description: "Get a blueprint by its blueprint ID.",
    tags: [OpenAPITags.Blueprint],
    request: {
        params: getBlueprintSchema
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

export async function getBlueprint(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getBlueprintSchema.safeParse(req.params);
        if (!parsedParams.success) {
            logger.error(
                `Error parsing params: ${fromError(parsedParams.error).toString()}`
            );
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId, blueprintId } = parsedParams.data;

        const blueprint = await query(blueprintId, orgId);

        if (!blueprint) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Client not found")
            );
        }

        return response<GetBlueprintResponse>(res, {
            data: blueprint as BlueprintData,
            success: true,
            error: false,
            message: "Client retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
