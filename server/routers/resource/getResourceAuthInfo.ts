import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    resourcePolicies,
    resourcePolicyHeaderAuth,
    resourcePolicyPassword,
    resourcePolicyPincode,
    resourcePincode,
    resourcePassword,
    resourceHeaderAuth,
    resources
} from "@server/db";
import { eq } from "drizzle-orm";
import { alias } from "@server/db";
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
    headerAuthExtendedCompatibility: boolean;
    sso: boolean;
    blockAccess: boolean;
    url: string;
    wildcard: boolean;
    fullDomain: string | null;
    whitelist: boolean;
    skipToIdpId: number | null;
    orgId: string;
    postAuthPath: string | null;
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

        const sharedPolicy = alias(resourcePolicies, "sharedPolicy");
        const defaultPolicy = alias(resourcePolicies, "defaultPolicy");
        const sharedPolicyPincode = alias(
            resourcePolicyPincode,
            "sharedPolicyPincode"
        );
        const defaultPolicyPincode = alias(
            resourcePolicyPincode,
            "defaultPolicyPincode"
        );
        const sharedPolicyPassword = alias(
            resourcePolicyPassword,
            "sharedPolicyPassword"
        );
        const defaultPolicyPassword = alias(
            resourcePolicyPassword,
            "defaultPolicyPassword"
        );
        const sharedPolicyHeaderAuth = alias(
            resourcePolicyHeaderAuth,
            "sharedPolicyHeaderAuth"
        );
        const defaultPolicyHeaderAuth = alias(
            resourcePolicyHeaderAuth,
            "defaultPolicyHeaderAuth"
        );

        const buildQuery = (whereClause: ReturnType<typeof eq>) =>
            db
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
                    eq(resourceHeaderAuth.resourceId, resources.resourceId)
                )
                .leftJoin(
                    sharedPolicy,
                    eq(
                        sharedPolicy.resourcePolicyId,
                        resources.resourcePolicyId
                    )
                )
                .leftJoin(
                    sharedPolicyPincode,
                    eq(
                        sharedPolicyPincode.resourcePolicyId,
                        sharedPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    sharedPolicyPassword,
                    eq(
                        sharedPolicyPassword.resourcePolicyId,
                        sharedPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    sharedPolicyHeaderAuth,
                    eq(
                        sharedPolicyHeaderAuth.resourcePolicyId,
                        sharedPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicy,
                    eq(
                        defaultPolicy.resourcePolicyId,
                        resources.defaultResourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicyPincode,
                    eq(
                        defaultPolicyPincode.resourcePolicyId,
                        defaultPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicyPassword,
                    eq(
                        defaultPolicyPassword.resourcePolicyId,
                        defaultPolicy.resourcePolicyId
                    )
                )
                .leftJoin(
                    defaultPolicyHeaderAuth,
                    eq(
                        defaultPolicyHeaderAuth.resourcePolicyId,
                        defaultPolicy.resourcePolicyId
                    )
                )
                .where(whereClause)
                .limit(1);

        const [result] =
            isGuidInteger && build === "saas"
                ? await buildQuery(
                      eq(resources.resourceId, Number(resourceGuid))
                  )
                : await buildQuery(eq(resources.resourceGuid, resourceGuid));

        const resource = result?.resources;
        if (!resource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Resource not found")
            );
        }

        // If a shared (custom) policy is assigned to the resource, use ONLY
        // its values — do not fall back to the default policy. The default
        // policy is only consulted when no shared policy is assigned at all.
        const hasSharedPolicy = result.sharedPolicy !== null;

        const effectivePolicyPincode = hasSharedPolicy
            ? result.sharedPolicyPincode
            : (result.defaultPolicyPincode ?? null);
        const effectivePolicyPassword = hasSharedPolicy
            ? result.sharedPolicyPassword
            : (result.defaultPolicyPassword ?? null);
        const effectivePolicyHeaderAuth = hasSharedPolicy
            ? result.sharedPolicyHeaderAuth
            : (result.defaultPolicyHeaderAuth ?? null);

        const effectivePolicy = hasSharedPolicy
            ? result.sharedPolicy
            : result.defaultPolicy;

        const pincode = effectivePolicyPincode ?? result.resourcePincode;
        const password = effectivePolicyPassword ?? result.resourcePassword;
        const headerAuth =
            effectivePolicyHeaderAuth ?? result.resourceHeaderAuth;

        const url = resource.fullDomain
            ? `${resource.ssl ? "https" : "http"}://${resource.fullDomain}`
            : null;

        return response<GetResourceAuthInfoResponse>(res, {
            data: {
                niceId: resource.niceId,
                resourceGuid: resource.resourceGuid,
                resourceId: resource.resourceId,
                resourceName: resource.name,
                password: password !== null,
                pincode: pincode !== null,
                headerAuth: headerAuth !== null,
                headerAuthExtendedCompatibility:
                    effectivePolicyHeaderAuth?.extendedCompatibility ?? false,
                sso: effectivePolicy?.sso ?? false,
                blockAccess: resource.blockAccess,
                url: url ?? "",
                wildcard: resource.wildcard ?? false,
                fullDomain: resource.fullDomain,
                whitelist: effectivePolicy?.emailWhitelistEnabled ?? false,
                skipToIdpId: effectivePolicy?.idpId ?? resource.skipToIdpId,
                orgId: resource.orgId,
                postAuthPath: resource.postAuthPath ?? null
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
