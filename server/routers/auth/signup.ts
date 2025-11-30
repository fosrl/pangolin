import { NextFunction, Request, Response } from "express";
import { db, users } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import response from "@server/lib/response";
import { SqliteError } from "better-sqlite3";
import { sendEmailVerificationCode } from "../../auth/sendEmailVerificationCode";
import { eq, and } from "drizzle-orm";
import moment from "moment";
import {
    createSession,
    generateId,
    generateSessionToken,
    serializeSessionCookie
} from "@server/auth/sessions/app";
import config from "@server/lib/config";
import logger from "@server/logger";
import { hashPassword } from "@server/auth/password";
import { checkValidInvite } from "@server/auth/checkValidInvite";
import { passwordSchema } from "@server/auth/passwordSchema";
import { UserType } from "@server/types/UserTypes";
import { createUserAccountOrg } from "@server/lib/createUserAccountOrg";
import { build } from "@server/build";
import resend, { AudienceIds, moveEmailToAudience } from "#dynamic/lib/resend";

export const signupBodySchema = z.object({
    email: z.string().toLowerCase().email(),
    password: passwordSchema,
    inviteToken: z.string().optional(),
    inviteId: z.string().optional(),
    termsAcceptedTimestamp: z.string().nullable().optional(),
    marketingEmailConsent: z.boolean().optional()
});

export type SignUpBody = z.infer<typeof signupBodySchema>;

export type SignUpResponse = {
    emailVerificationRequired?: boolean;
};

export async function signup(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = signupBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { email, password, inviteToken, inviteId, termsAcceptedTimestamp, marketingEmailConsent } =
        parsedBody.data;

    const passwordHash = await hashPassword(password);
    const userId = generateId(15);

    if (config.getRawConfig().flags?.disable_signup_without_invite) {
        if (!inviteToken || !inviteId) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Signup blocked without invite. Email: ${email}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Signups are disabled without an invite code"
                )
            );
        }

        const { error, existingInvite } = await checkValidInvite({
            token: inviteToken,
            inviteId
        });

        if (error) {
            return next(createHttpError(HttpCode.BAD_REQUEST, error));
        }

        if (!existingInvite) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invite does not exist")
            );
        }

        if (existingInvite.email !== email) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `User attempted to use an invite for another user. Email: ${email}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invite is not for this user"
                )
            );
        }
    }

    try {
        const existing = await db
            .select()
            .from(users)
            .where(
                and(eq(users.email, email), eq(users.type, UserType.Internal))
            );

        if (existing && existing.length > 0) {
            if (!config.getRawConfig().flags?.require_email_verification) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "A user with that email address already exists"
                    )
                );
            }

            const user = existing[0];

            // If the user is already verified, we don't want to create a new user
            if (user.emailVerified) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "A user with that email address already exists"
                    )
                );
            }

            const dateCreated = moment(user.dateCreated);
            const now = moment();
            const diff = now.diff(dateCreated, "hours");

            if (diff < 2) {
                // If the user was created less than 2 hours ago, we don't want to create a new user
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "A user with that email address already exists"
                    )
                );
                // return response<SignUpResponse>(res, {
                //     data: {
                //         emailVerificationRequired: true
                //     },
                //     success: true,
                //     error: false,
                //     message: `A user with that email address already exists. We sent an email to ${email} with a verification code.`,
                //     status: HttpCode.OK
                // });
            } else {
                // If the user was created more than 2 hours ago, we want to delete the old user and create a new one
                await db.delete(users).where(eq(users.userId, user.userId));
            }
        }

        if (build === "saas" && !termsAcceptedTimestamp) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "You must accept the terms of service and privacy policy"
                )
            );
        }

        await db.insert(users).values({
            userId: userId,
            type: UserType.Internal,
            username: email,
            email: email,
            passwordHash,
            dateCreated: moment().toISOString(),
            termsAcceptedTimestamp: termsAcceptedTimestamp || null,
            termsVersion: "1",
            lastPasswordChange: new Date().getTime()
        });

        // give the user their default permissions:
        // await db.insert(userActions).values({
        //     userId: userId,
        //     actionId: ActionsEnum.createOrg,
        //     orgId: null,
        // });

        if (build == "saas") {
            const { success, error, org } = await createUserAccountOrg(
                userId,
                email
            );
            if (!success) {
                if (error) {
                    return next(
                        createHttpError(HttpCode.INTERNAL_SERVER_ERROR, error)
                    );
                }
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Failed to create user account and organization"
                    )
                );
            }
        }

        const token = generateSessionToken();
        const sess = await createSession(token, userId);
        const isSecure = req.protocol === "https";
        const cookie = serializeSessionCookie(
            token,
            isSecure,
            new Date(sess.expiresAt)
        );
        res.appendHeader("Set-Cookie", cookie);
        if (build == "saas" && marketingEmailConsent) {
            logger.debug(`User ${email} opted in to marketing emails during signup.`);
            moveEmailToAudience(email, AudienceIds.SignUps);
        }

        if (config.getRawConfig().flags?.require_email_verification) {
            sendEmailVerificationCode(email, userId);

            return response<SignUpResponse>(res, {
                data: {
                    emailVerificationRequired: true
                },
                success: true,
                error: false,
                message: `User created successfully. We sent an email to ${email} with a verification code.`,
                status: HttpCode.OK
            });
        }

        return response<SignUpResponse>(res, {
            data: {},
            success: true,
            error: false,
            message: "User created successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        if (e instanceof SqliteError && e.code === "SQLITE_CONSTRAINT_UNIQUE") {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Account already exists with that email. Email: ${email}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "A user with that email address already exists"
                )
            );
        } else {
            logger.error(e);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Failed to create user"
                )
            );
        }
    }
}
