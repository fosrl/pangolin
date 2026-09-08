import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { response } from "@server/lib/response";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { createSessionForIdpUser } from "@server/auth/sessions/createSessionForIdpUser";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty().openapi({
        description:
            "ID of the organization that owns both the identity provider and the API key making this call.",
        example: "myorg"
    }),
    idpId: z.coerce.number<number>().openapi({
        description:
            "ID of the identity provider the user belongs to. Must be owned by the organization in orgId.",
        example: 1
    })
});

const bodySchema = z.strictObject({
    userId: z.string().nonempty().openapi({
        description:
            "Pangolin user ID of the already-provisioned external IdP user to mint a session for. The user must already exist, have users.idpId equal to idpId, and hold a membership in the organization.",
        example: "abc123def456"
    })
});

export type CreateIdpSessionResponse = {
    token: string;
    expiresAt: number;
};

const CreateIdpSessionResponseDataSchema = z.object({
    token: z.string().openapi({
        description:
            "Pangolin user session token. Present it as the session cookie to act as the user.",
        example: "s_a1b2c3d4e5f6..."
    }),
    expiresAt: z.number().openapi({
        description: "Session expiry as a Unix timestamp in milliseconds.",
        example: 1790000000000
    })
});

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/idp/{idpId}/oidc/exchange-token",
    description:
        "Mint a Pangolin session for an already-provisioned external IdP user, bridging an external IdP session into Pangolin without the interactive browser OIDC flow. The caller is trusted via an org-scoped API key holding the createIdpSession action; the external JWT is never sent. No claim-mapping or autoprovision is performed — the user must already exist and be a member of the organization.",
    tags: [OpenAPITags.OrgIdp],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        201: {
            description:
                "Session created. Returns a Pangolin session token and its expiry.",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        CreateIdpSessionResponseDataSchema
                    )
                }
            }
        },
        400: {
            description: "Invalid path parameters or request body."
        },
        401: {
            description:
                "The user does not belong to the specified identity provider, or is not a member of the specified organization."
        },
        404: {
            description: "No user exists with the given userId."
        }
    }
});

/**
 * Mints a Pangolin user session token for an already-authenticated external
 * identity, bridging an external IdP session into Pangolin without the
 * interactive browser OIDC flow. The caller is trusted via an org-scoped API
 * key granted the createIdpSession action; the external JWT is not sent. The
 * user must already be provisioned into the org — no claim-mapping or
 * autoprovision happens here.
 */
export async function createIdpSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedParams = paramsSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    try {
        const { orgId, idpId } = parsedParams.data;
        const { userId } = parsedBody.data;

        const { token, expiresAt } = await createSessionForIdpUser(userId, {
            orgId,
            idpId
        });

        return response<CreateIdpSessionResponse>(res, {
            data: { token, expiresAt },
            success: true,
            error: false,
            message: "Session created successfully",
            status: HttpCode.CREATED
        });
    } catch (e) {
        if (createHttpError.isHttpError(e)) {
            return next(e);
        }
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create IdP session"
            )
        );
    }
}
