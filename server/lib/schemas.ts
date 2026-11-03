import { z } from "zod";

/**
 * Validates a wildcard subdomain passed as the leftmost component of a full domain.
 *
 * The value represents everything to the left of the base domain, so when combined
 * with e.g. "example.com" it must produce a valid SSL-style wildcard hostname.
 *
 * Valid:
 *   "*"          → *.example.com
 *   "*.level1"   → *.level1.example.com
 *
 * Invalid:
 *   "*example"          → *example.com (no dot after *)
 *   "level2.*.level1"   → wildcard not in leftmost position
 *   "*.level1.*"        → multiple wildcards
 */
export const wildcardSubdomainSchema = z
    .string()
    .refine(
        (val) => {
            // Must start with "*."; the remainder (if any) must be valid hostname labels.
            // A bare "*" is also valid (becomes *.baseDomain directly).
            if (val === "*") return true;
            if (!val.startsWith("*.")) return false;
            const rest = val.slice(2); // everything after "*."
            // rest must not be empty, must not contain another "*",
            // and every label must be a valid hostname label.
            if (!rest || rest.includes("*")) return false;
            const labelRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
            return rest.split(".").every((label) => labelRegex.test(label));
        },
        {
            message:
                'Invalid wildcard subdomain. The wildcard "*" must be the leftmost label followed by a dot and valid hostname labels (e.g. "*" or "*.level1"). Patterns like "*example", "level2.*.level1", or multiple wildcards are not supported.'
        }
    );

export const subdomainSchema = z
    .string()
    .regex(
        /^(?!:\/\/)([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
        "Invalid subdomain format"
    )
    .min(1, "Subdomain must be at least 1 character long")
    .transform((val) => val.toLowerCase());

export const tlsNameSchema = z
    .string()
    .regex(
        /^(?!:\/\/)([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$|^$/,
        "Invalid subdomain format"
    )
    .transform((val) => val.toLowerCase());

export const privateNamespaceSubdomainSchema = z
    .string()
    .regex(
        /^[a-zA-Z0-9-]+$/,
        "Namespace subdomain can only contain letters, numbers, and hyphens"
    )
    .min(1, "Namespace subdomain must be at least 1 character long")
    .max(32, "Namespace subdomain must be at most 32 characters long")
    .transform((val) => val.toLowerCase());

/**
 * A path matched by a Traefik router (target path, redirect match path).
 * Backticks and control characters are never valid in a URL path and are
 * rejected so the value can't break out of its literal in the router rule.
 */
export const routePathSchema = z
    .string()
    .refine((val) => !/[`\u0000-\u001f\u007f]/.test(val), {
        message: "Path cannot contain backticks or control characters"
    });
