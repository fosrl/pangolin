import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { response } from "@server/lib/response";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { db, users } from "@server/db";
import { eq } from "drizzle-orm";
import {
    createSession,
    generateSessionToken
} from "@server/auth/sessions/app";

const paramsSchema = z.strictObject({
    idpId: z.coerce.number<number>().openapi({
        description:
            "ID of the identity provider the user belongs to. The provided user must have users.idpId equal to this value.",
        example: 1
    })
});

const bodySchema = z.strictObject({
    userId: z.string().nonempty().openapi({
        description:
            "Pangolin user ID of the already-provisioned external IdP user to mint a session for. The user must already exist and have users.idpId equal to idpId.",
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
    path: "/idp/{idpId}/oidc/create-session",
    description:
        "Mint a Pangolin session for an already-provisioned external IdP user, bridging an external IdP session into Pangolin without the interactive browser OIDC flow. This is an impersonation-capable, highly privileged route: it requires a ROOT API key holding the createIdpSession action, and must be enabled with the enable_idp_create_session flag in config.yml (off by default, self-hosted only). The external JWT is never sent. No claim-mapping or autoprovision is performed — the user must already exist and belong to the identity provider.",
    tags: [OpenAPITags.GlobalIdp],
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
                "The user does not belong to the specified identity provider."
        },
        404: {
            description: "No user exists with the given userId."
        }
    }
});

/**
 * Mints a Pangolin user session token for an already-provisioned external
 * identity, bridging an external IdP session into Pangolin without the
 * interactive browser OIDC flow. The caller is trusted via a ROOT API key
 * granted the createIdpSession action; the external JWT is not sent. The user
 * must already exist and belong to the identity provider — no claim-mapping or
 * autoprovision happens here. Minting a session yields the full user identity,
 * which is why this is root-gated rather than org-scoped.
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
        const { idpId } = parsedParams.data;
        const { userId } = parsedBody.data;

        const [existingUser] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!existingUser) {
            return next(createHttpError(HttpCode.NOT_FOUND, "User not found"));
        }

        if (existingUser.idpId !== idpId) {
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "User does not belong to the specified IdP"
                )
            );
        }

        const token = generateSessionToken();
        const sess = await createSession(token, existingUser.userId);

        return response<CreateIdpSessionResponse>(res, {
            data: { token, expiresAt: sess.expiresAt },
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
