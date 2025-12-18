import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    resourceHeaderAuth,
    resourcePassword,
    resourcePincode,
    resources
} from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { build } from "@server/build";

const getResourceAuthInfoSchema = z.strictObject({
    resourceGuid: z.string()
});

export type GetResourceAuthInfoResponse = {
    resourceId: number;
    resourceGuid: string;
    resourceName: string;
    niceId: string;
    password: boolean;
    pincode: boolean;
    headerAuth: boolean;
    sso: boolean;
    blockAccess: boolean;
    url: string;
    whitelist: boolean;
    skipToIdpId: number | null;
    orgId: string;
};

export async function getResourceAuthInfo(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getResourceAuthInfoSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { resourceGuid } = parsedParams.data;

        const isGuidInteger = /^\d+$/.test(resourceGuid);

        const [result] =
            isGuidInteger && build === "saas"
                ? await db
                      .select()
                      .from(resources)
                      .leftJoin(
                          resourcePincode,
                          eq(resourcePincode.resourceId, resources.resourceId)
                      )
                      .leftJoin(
                          resourcePassword,
                          eq(resourcePassword.resourceId, resources.resourceId)
                      )

                      .leftJoin(
                          resourceHeaderAuth,
                          eq(
                              resourceHeaderAuth.resourceId,
                              resources.resourceId
                          )
                      )
                      .where(eq(resources.resourceId, Number(resourceGuid)))
                      .limit(1)
                : await db
                      .select()
                      .from(resources)
                      .leftJoin(
                          resourcePincode,
                          eq(resourcePincode.resourceId, resources.resourceId)
                      )
                      .leftJoin(
                          resourcePassword,
                          eq(resourcePassword.resourceId, resources.resourceId)
                      )
                      .leftJoin(
                          resourceHeaderAuth,
                          eq(
                              resourceHeaderAuth.resourceId,
                              resources.resourceId
                          )
                      )
                      .where(eq(resources.resourceGuid, resourceGuid))
                      .limit(1);

        const resource = result?.resources;
        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        const pincode = result?.resourcePincode;
        const password = result?.resourcePassword;
        const headerAuth = result?.resourceHeaderAuth;

        const url = `${resource.ssl ? "https" : "http"}://${resource.fullDomain}`;

        return response<GetResourceAuthInfoResponse>(res, {
            data: {
                niceId: resource.niceId,
                resourceGuid: resource.resourceGuid,
                resourceId: resource.resourceId,
                resourceName: resource.name,
                password: password !== null,
                pincode: pincode !== null,
                headerAuth: headerAuth !== null,
                sso: resource.sso,
                blockAccess: resource.blockAccess,
                url,
                whitelist: resource.emailWhitelistEnabled,
                skipToIdpId: resource.skipToIdpId,
                orgId: resource.orgId
            },
            success: true,
            error: false,
            message: "Resource auth info retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
