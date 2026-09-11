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

export const redirectMatchPathSchema = z.string().nonempty().default("*");

export const redirectRewritePathSchema = z.string().nonempty();

export const redirectDestinationDomainSchema = z
    .string()
    .nonempty()
    .refine(isValidDomain, {
        message: "Invalid domain"
    });
