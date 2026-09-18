import { z } from "zod";
import { isValidDomain } from "@server/lib/validators";
import { build } from "@server/build";

export const redirectNiceIdSchema = z
    .string()
    .min(1)
    .max(255)
    .regex(
        /^[a-zA-Z0-9-]+$/,
        "niceId can only contain letters, numbers, and dashes"
    );

export const redirectPathMatchTypeSchema = z.enum(["exact", "prefix", "regex"]);

export const redirectRewritePathTypeSchema = z.enum([
    "exact",
    "prefix",
    "regex",
    "stripPrefix"
]);

export const redirectMatchPathSchema = z.string().nonempty();

export function isValidRegex(pattern: string): boolean {
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

/**
 * A regex match path is fed straight to `new RegExp` when building routes,
 * so reject patterns that would throw there.
 */
export function isValidMatchPath(
    matchPath: string | null | undefined,
    pathMatchType: string | null | undefined
): boolean {
    return (
        pathMatchType !== "regex" || !matchPath || isValidRegex(matchPath)
    );
}

export const redirectRewritePathSchema = z.string().nonempty();

// Same range as target priorities; 100 means "let the system order it".
export const redirectPrioritySchema = z.int().min(1).max(1000);

/**
 * A destination is `scheme://host[:port]` with no path, query or fragment;
 * the request path (after any rewrite) is appended to it by badger.
 */
export function isValidDestinationHost(value: string): boolean {
    const match = /^https?:\/\/([^/:?#]+)(:\d{1,5})?$/.exec(value);
    return match !== null && isValidDomain(match[1]);
}

export const redirectDestinationHostSchema = z
    .string()
    .nonempty()
    .refine(isValidDestinationHost, {
        message: "Invalid destination, expected scheme://host such as https://example.com"
    });

/**
 * The cloud only serves HTTPS, so a domain-attached redirect may not opt out
 * of TLS there. Resource-attached redirects inherit the resource's ssl
 * setting and never carry their own.
 */
export function isAllowedSsl(ssl: boolean | undefined): boolean {
    return build !== "saas" || ssl !== false;
}
