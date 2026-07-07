import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { resourcePolicies, apiKeyOrg } from "@server/db";
import { eq, and } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";

export async function verifyApiKeyResourcePolicyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const apiKey = req.apiKey;
    const resourcePolicyId =
        req.params.resourcePolicyId ||
        req.body.resourcePolicyId ||
        req.query.resourcePolicyId;

    if (!apiKey) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
        );
    }

    try {
        // Retrieve the resource policy
        const [policy] = await db
            .select()
            .from(resourcePolicies)
            .where(eq(resourcePolicies.resourcePolicyId, resourcePolicyId))
            .limit(1);

        if (!policy) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource policy with ID ${resourcePolicyId} not found`
                )
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any resource policy in any org
            return next();
        }

        if (!policy.orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Resource policy with ID ${resourcePolicyId} does not have an organization ID`
                )
            );
        }

        // Verify that the API key is linked to the resource policy's organization
        if (!req.apiKeyOrg) {
            const apiKeyOrgResult = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, policy.orgId)
                    )
                )
                .limit(1);

            if (apiKeyOrgResult.length > 0) {
                req.apiKeyOrg = apiKeyOrgResult[0];
            }
        }

        if (!req.apiKeyOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to this organization"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying resource policy access"
            )
        );
    }
}
