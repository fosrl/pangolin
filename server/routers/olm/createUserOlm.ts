import { NextFunction, Request, Response } from "express";
import { db, olms, primaryDb } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { z } from "zod";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import moment from "moment";
import { generateId } from "@server/auth/sessions/app";
import { fromError } from "zod-validation-error";
import { hashPassword } from "@server/auth/password";
import { OpenAPITags, registry } from "@server/openApi";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";

const bodySchema = z
    .object({
        name: z.string().min(1).max(255)
    })
    .strict();

const paramsSchema = z.object({
    userId: z.string()
});

export type CreateOlmBody = z.infer<typeof bodySchema>;

export type CreateOlmResponse = {
    olmId: string;
    secret: string;
};

// registry.registerPath({
//     method: "put",
//     path: "/user/{userId}/olm",
//     description: "Create a new olm for a user.",
//     tags: [OpenAPITags.User, OpenAPITags.Client],
//     request: {
//         body: {
//             content: {
//                 "application/json": {
//                     schema: bodySchema
//                 }
//             }
//         },
//         params: paramsSchema
//     },
// responses: {
// 200: {
// description: "Successful response",
// content: {
// "application/json": {
// schema: z.object({
// data: z.record(z.string(), z.any()).nullable(),
// success: z.boolean(),
// error: z.boolean(),
// message: z.string(),
// status: z.number()
// })
// }
// }
// }
// }
// });

export async function createUserOlm(
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

        const { name } = parsedBody.data;

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { userId } = parsedParams.data;

        const olmId = generateId(15);
        const secret = generateId(48);

        const secretHash = await hashPassword(secret);

        await db.insert(olms).values({
            olmId: olmId,
            userId,
            name,
            secretHash,
            dateCreated: moment().toISOString()
        });

        calculateUserClientsForOrgs(userId).catch((e) => {
            console.error(
                "Error calculating user clients after creating olm:",
                e
            );
        });

        return response<CreateOlmResponse>(res, {
            data: {
                olmId,
                secret
            },
            success: true,
            error: false,
            message: "Olm created successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        console.error(e);

        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create olm"
            )
        );
    }
}
