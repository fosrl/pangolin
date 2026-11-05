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
import { idp, idpOidcConfig, idpOrg, orgs } from "@server/db";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";

const paramsSchema = z.strictObject({});

const bodySchema = z.strictObject({
    name: z.string().nonempty(),
    clientId: z.string().nonempty(),
    clientSecret: z.string().nonempty(),
    authUrl: z.url(),
    tokenUrl: z.url(),
    identifierPath: z.string().nonempty(),
    emailPath: z.string().optional(),
    namePath: z.string().optional(),
    scopes: z.string().nonempty(),
    autoProvision: z.boolean().optional(),
    tags: z.string().optional(),
    variant: z.enum(["oidc", "google", "azure"]).optional().default("oidc")
});

export type CreateIdpResponse = {
    idpId: number;
    redirectUrl: string;
};
const CreateIdpResponseDataSchema = z.object({
    idpId: z.number(),
    redirectUrl: z.string()
});


registry.registerPath({
    method: "put",
    path: "/idp/oidc",
    description: "Create an OIDC IdP.",
    tags: [OpenAPITags.GlobalIdp],
    request: {
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
                    schema: createApiResponseSchema(CreateIdpResponseDataSchema)
                }
            }
        }
    }
});

export async function createOidcIdp(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

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
            tags,
            variant
        } = parsedBody.data;

        if (
            process.env.IDENTITY_PROVIDER_MODE === "org"
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Global IdP creation is not allowed in the current identity provider mode. Set app.identity_provider_mode to 'global' in the private configuration to enable this feature."
                )
            );
        }

        const key = config.getRawConfig().server.secret!;

        const encryptedSecret = encrypt(clientSecret, key);
        const encryptedClientId = encrypt(clientId, key);

        let idpId: number | undefined;
        await db.transaction(async (trx) => {
            const [idpRes] = await trx
                .insert(idp)
                .values({
                    name,
                    autoProvision,
                    type: "oidc",
                    tags,
                    defaultOrgMapping: `'{{orgId}}'`,
                    defaultRoleMapping: `'Member'`
                })
                .returning();

            idpId = idpRes.idpId;

            await trx.insert(idpOidcConfig).values({
                idpId: idpRes.idpId,
                clientId: encryptedClientId,
                clientSecret: encryptedSecret,
                authUrl,
                tokenUrl,
                scopes,
                identifierPath,
                emailPath,
                namePath,
                variant
            });
        });

        const redirectUrl = await generateOidcRedirectUrl(idpId as number);

        return response<CreateIdpResponse>(res, {
            data: {
                idpId: idpId as number,
                redirectUrl
            },
            success: true,
            error: false,
            message: "Idp created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
