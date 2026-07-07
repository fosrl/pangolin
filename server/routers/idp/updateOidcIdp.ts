import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { idp, idpOidcConfig } from "@server/db";
import { eq } from "drizzle-orm";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";

const paramsSchema = z
    .object({
        idpId: z.coerce.number<number>()
    })
    .strict();

const bodySchema = z.strictObject({
    name: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    authUrl: z.string().optional(),
    tokenUrl: z.string().optional(),
    identifierPath: z.string().optional(),
    emailPath: z.string().optional(),
    namePath: z.string().optional(),
    scopes: z.string().optional(),
    autoProvision: z.boolean().optional(),
    defaultRoleMapping: z.string().optional(),
    defaultOrgMapping: z.string().optional(),
    tags: z.string().optional(),
    variant: z.enum(["oidc", "google", "azure"]).optional()
});

export type UpdateIdpResponse = {
    idpId: number;
};
const UpdateIdpResponseDataSchema = z.object({
    idpId: z.number()
});


registry.registerPath({
    method: "post",
    path: "/idp/{idpId}/oidc",
    description: "Update an OIDC IdP.",
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
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(UpdateIdpResponseDataSchema)
                }
            }
        }
    }
});

export async function updateOidcIdp(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
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

        const { idpId } = parsedParams.data;
        const {
            clientId,
            clientSecret,
            authUrl,
            tokenUrl,
            scopes,
            identifierPath,
            emailPath,
            namePath,
            name,
            autoProvision,
            defaultRoleMapping,
            defaultOrgMapping,
            tags,
            variant
        } = parsedBody.data;

        if (process.env.IDENTITY_PROVIDER_MODE === "org") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Global IdP creation is not allowed in the current identity provider mode. Set app.identity_provider_mode to 'global' in the private configuration to enable this feature."
                )
            );
        }

        // Check if IDP exists and is of type OIDC
        const [existingIdp] = await db
            .select()
            .from(idp)
            .where(eq(idp.idpId, idpId));

        if (!existingIdp) {
            return next(createHttpError(HttpCode.NOT_FOUND, "IdP not found"));
        }

        if (existingIdp.type !== "oidc") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "IdP is not an OIDC provider"
                )
            );
        }

        const key = config.getRawConfig().server.secret!;
        const encryptedSecret = clientSecret
            ? encrypt(clientSecret, key)
            : undefined;
        const encryptedClientId = clientId ? encrypt(clientId, key) : undefined;

        await db.transaction(async (trx) => {
            const idpData = {
                name,
                autoProvision,
                defaultRoleMapping,
                defaultOrgMapping,
                tags
            };

            // only update if at least one key is not undefined
            let keysToUpdate = Object.keys(idpData).filter(
                (key) => idpData[key as keyof typeof idpData] !== undefined
            );

            if (keysToUpdate.length > 0) {
                await trx.update(idp).set(idpData).where(eq(idp.idpId, idpId));
            }

            const configData = {
                clientId: encryptedClientId,
                clientSecret: encryptedSecret,
                authUrl,
                tokenUrl,
                scopes,
                identifierPath,
                emailPath,
                namePath,
                variant
            };

            keysToUpdate = Object.keys(configData).filter(
                (key) =>
                    configData[key as keyof typeof configData] !== undefined
            );

            if (keysToUpdate.length > 0) {
                // Update OIDC config
                await trx
                    .update(idpOidcConfig)
                    .set(configData)
                    .where(eq(idpOidcConfig.idpId, idpId));
            }
        });

        return response<UpdateIdpResponse>(res, {
            data: {
                idpId
            },
            success: true,
            error: false,
            message: "IdP updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
