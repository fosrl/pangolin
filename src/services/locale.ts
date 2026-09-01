"use server";

import { cookies, headers } from "next/headers";
import { Locale, defaultLocale, locales } from "@/i18n/config";
import { detectLocale } from "@/i18n/detectLocale";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";

// In this example the locale is read from a cookie. You could alternatively
// also read it from a database, backend service, or any other source.
const COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

export async function getUserLocale(): Promise<Locale> {
    const cookieLocale = (await cookies()).get(COOKIE_NAME)?.value;

    if (cookieLocale && locales.includes(cookieLocale as Locale)) {
        return cookieLocale as Locale;
    }

    // No cookie found - try to restore from user's saved locale in DB
    try {
        const res = await internal.get("/user", await authCookieHeader());
        const userLocale = res.data?.data?.locale;
        if (userLocale && locales.includes(userLocale as Locale)) {
            // Try to cache in a cookie so subsequent requests skip the API
            // call. cookies().set() is only permitted in Server Actions and
            // Route Handlers - not during rendering - so we isolate it so
            // that a write failure doesn't prevent the locale from being
            // returned for the current request.
            try {
                (await cookies()).set(COOKIE_NAME, userLocale, {
                    maxAge: COOKIE_MAX_AGE,
                    path: "/",
                    sameSite: "lax"
                });
            } catch {
                // Cannot set cookies in this context (e.g. during rendering);
                // the correct locale is still returned below.
            }
            return userLocale as Locale;
        }
    } catch {
        // User not logged in or API unavailable - fall through
    }

    const headerList = await headers();
    const acceptLang = headerList.get("accept-language");

    if (acceptLang) {
        const matched = detectLocale(acceptLang);
        if (matched) {
            return matched;
        }
    }

    return defaultLocale;
}

export async function setUserLocale(locale: Locale) {
    (await cookies()).set(COOKIE_NAME, locale, {
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "lax"
    });
}
