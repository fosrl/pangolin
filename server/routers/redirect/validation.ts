import { z } from "zod";

export const redirectNiceIdSchema = z
    .string()
    .min(1)
    .max(255)
    .regex(
        /^[a-zA-Z0-9-]+$/,
        "niceId can only contain letters, numbers, and dashes"
    );

export const redirectSourcePathSchema = z
    .string()
    .nonempty()
    .regex(/^\//, "sourcePath must start with a /")
    .default("/*");
