import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, blueprints, orgs } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { sql, eq, desc } from "drizzle-orm";
import logger from "@server/logger";
import { fromZodError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { BlueprintData } from "./types";

const listBluePrintsParamsSchema = z
    .object({
        orgId: z.string()
    })
    .strict();

const listBluePrintsSchema = z
    .object({
        limit: z
            .string()
            .optional()
            .default("1000")
            .transform(Number)
            .pipe(z.number().int().nonnegative()),
        offset: z
            .string()
            .optional()
            .default("0")
            .transform(Number)
            .pipe(z.number().int().nonnegative())
    })
    .strict();

async function queryBlueprints(orgId: string, limit: number, offset: number) {
    const res = await db
        .select({
            blueprintId: blueprints.blueprintId,
            name: blueprints.name,
            source: blueprints.source,
            succeeded: blueprints.succeeded,
            orgId: blueprints.orgId,
            createdAt: blueprints.createdAt
        })
        .from(blueprints)
        .leftJoin(orgs, eq(blueprints.orgId, orgs.orgId))
        .where(eq(blueprints.orgId, orgId))
        .orderBy(desc(blueprints.createdAt))
        .limit(limit)
        .offset(offset);
    return res;
}

export type ListBlueprintsResponse = {
    blueprints: NonNullable<
        Pick<
            BlueprintData,
            | "blueprintId"
            | "name"
            | "source"
            | "succeeded"
            | "orgId"
            | "createdAt"
        >[]
    >;
    pagination: { total: number; limit: number; offset: number };
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/blueprints",
    description: "List all blueprints for a organization.",
    tags: [OpenAPITags.Org, OpenAPITags.Blueprint],
    request: {
        params: z.object({
            orgId: z.string()
        }),
        query: listBluePrintsSchema
    },
    responses: {}
});

export async function listBlueprints(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listBluePrintsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedQuery.error)
                )
            );
        }
        const { limit, offset } = parsedQuery.data;

        const parsedParams = listBluePrintsParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromZodError(parsedParams.error)
                )
            );
        }

        const { orgId } = parsedParams.data;

        const blueprintsList = await queryBlueprints(
            orgId.toString(),
            limit,
            offset
        );

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(blueprints);

        return response<ListBlueprintsResponse>(res, {
            data: {
                blueprints:
                    blueprintsList as ListBlueprintsResponse["blueprints"],
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Blueprints retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
