import z from "zod";

export type PolicyAuthMethodId =
    | "pincode"
    | "passcode"
    | "email"
    | "headerAuth";

export const setPasswordSchema = z.object({
    password: z.string().min(4).max(100)
});

export const setPincodeSchema = z.object({
    pincode: z.string().length(6)
});

export const setHeaderAuthSchema = z.object({
    user: z.string().min(4).max(100),
    password: z.string().min(4).max(100),
    extendedCompatibility: z.boolean()
});
