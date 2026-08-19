"use server";

import { cookies, headers } from "next/headers";
import { Locale, defaultLocale, locales } from "@/i18n/config";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";

// In this example the locale is read from a cookie. You could alternatively
// also read it from a database, backend service, or any other source.
const COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

function matchLocaleFromAcceptLanguage(
    acceptLang: string | null | undefined
): Locale | null {
    if (!acceptLang) return null;

    const parsedLanguages = acceptLang
        .split(",")
        .map((langStr, index) => {
            const [rawTag, ...params] = langStr.trim().split(";");
            const tag = rawTag.trim();
            let q = 1.0;
            for (const param of params) {
                const [key, val] = param.trim().split("=");
                if (key === "q" && val) {
                    const parsedQ = parseFloat(val);
                    if (!isNaN(parsedQ)) {
                        q = parsedQ;
                    }
                }
            }
            return { tag, q, index };
        })
        .filter((item) => item.tag.length > 0 && item.q > 0)
        .sort((a, b) => b.q - a.q || a.index - b.index);

    for (const { tag } of parsedLanguages) {
        const exactMatch = locales.find(
            (locale: Locale) => locale.toLowerCase() === tag.toLowerCase()
        );
        if (exactMatch) {
            return exactMatch;
        }

        const baseTag = tag.split("-")[0].toLowerCase();
        const prefixMatch = locales.find(
            (locale: Locale) => locale.split("-")[0].toLowerCase() === baseTag
        );
        if (prefixMatch) {
            return prefixMatch;
        }
    }

    return null;
}

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

    const matchedLocale = matchLocaleFromAcceptLanguage(acceptLang);
    if (matchedLocale) {
        return matchedLocale;
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
