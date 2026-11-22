import { NextFunction, Response } from "express";
import ErrorResponse from "@server/types/ErrorResponse";
import {
    SESSION_COOKIE_NAME,
    validateSessionToken
} from "@server/auth/sessions/app";

export const stripDuplicateSesions = async (
    req: any,
    res: Response<ErrorResponse>,
    next: NextFunction
) => {
    const cookieHeader: string | undefined = req.headers.cookie;
    if (!cookieHeader) {
        return next();
    }

    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    const sessionCookies = cookies.filter((cookie) =>
        cookie.startsWith(`${SESSION_COOKIE_NAME}=`)
    );

    const validSessions: string[] = [];
    if (sessionCookies.length > 1) {
        for (const cookie of sessionCookies) {
            const cookieValue = cookie.split("=")[1];
            const validationResult = await validateSessionToken(cookieValue);
            if (validationResult.session && validationResult.user) {
                validSessions.push(cookieValue);
            }
        }

        if (validSessions.length > 0) {
            // Only the first valid session should survive. Note this
            // middleware runs before cookieParser(), so req.cookies isn't
            // populated yet here - we can't rely on overwriting it below.
            // If we instead left every *valid* session cookie in the header
            // (only stripping invalid ones), cookieParser() would parse a
            // Cookie header with a repeated session key and silently keep
            // whichever one appears last - not necessarily validSessions[0],
            // and not something we control. So we dedupe the header itself
            // here, keeping only the first valid session cookie and
            // dropping every other session cookie (valid or not).
            const winningSession = validSessions[0];
            let keptWinningSession = false;
            const newCookieHeader = cookies.filter((cookie) => {
                if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
                    const cookieValue = cookie.split("=")[1];
                    if (cookieValue === winningSession && !keptWinningSession) {
                        keptWinningSession = true;
                        return true;
                    }
                    return false;
                }
                return true;
            });
            req.headers.cookie = newCookieHeader.join("; ");
            // Defensive: if middleware ordering ever changes such that
            // req.cookies is already populated by this point, keep it in
            // sync too.
            if (req.cookies) {
                req.cookies[SESSION_COOKIE_NAME] = winningSession;
            }
        }
    }

    return next();
};