import { z } from "zod";
import { isValidDomain } from "@server/lib/validators";

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

export const redirectDestinationDomainSchema = z
    .string()
    .nonempty()
    .refine(isValidDomain, {
        message: "Invalid domain"
    });
