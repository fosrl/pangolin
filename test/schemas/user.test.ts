import { describe, it, expect } from "vitest";
import { z } from "zod";

// We test the schemas by re-creating them from the source definitions
// since the actual imports pull in DB dependencies. This tests the schema
// logic independently.

// From inviteUser.ts - the inviteUserBodySchema
const inviteUserBodySchema = z
    .strictObject({
        email: z.email().toLowerCase(),
        roleIds: z.array(z.number().int().positive()).min(1).optional(),
        roleId: z.number().int().positive().optional(),
        validHours: z.number().gt(0).lte(168),
        sendEmail: z.boolean().optional(),
        regenerate: z.boolean().optional()
    })
    .refine(
        (d) => (d.roleIds != null && d.roleIds.length > 0) || d.roleId != null,
        { message: "roleIds or roleId is required", path: ["roleIds"] }
    )
    .transform((data) => ({
        email: data.email,
        validHours: data.validHours,
        sendEmail: data.sendEmail,
        regenerate: data.regenerate,
        roleIds: [
            ...new Set(
                data.roleIds && data.roleIds.length > 0
                    ? data.roleIds
                    : [data.roleId!]
            )
        ]
    }));

// From acceptInvite.ts
const acceptInviteBodySchema = z.strictObject({
    token: z.string(),
    inviteId: z.string()
});

// From createOrgUser.ts
const createOrgUserBodySchema = z
    .strictObject({
        email: z.string().email().toLowerCase().optional(),
        username: z.string().nonempty().toLowerCase(),
        name: z.string().optional(),
        type: z.enum(["internal", "oidc"]).optional(),
        idpId: z.number().optional(),
        roleIds: z.array(z.number().int().positive()).min(1).optional(),
        roleId: z.number().int().positive().optional()
    })
    .refine(
        (d) =>
            (d.roleIds != null && d.roleIds.length > 0) || d.roleId != null,
        { message: "roleIds or roleId is required", path: ["roleIds"] }
    )
    .transform((data) => ({
        email: data.email,
        username: data.username,
        name: data.name,
        type: data.type,
        idpId: data.idpId,
        roleIds: [
            ...new Set(
                data.roleIds && data.roleIds.length > 0
                    ? data.roleIds
                    : [data.roleId!]
            )
        ]
    }));

describe("User Schemas", () => {
    // ─── Invite User Schema ─────────────────────────────────────────────
    describe("inviteUserBodySchema", () => {
        it("accepts valid body with roleId", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "invitee@example.com",
                roleId: 1,
                validHours: 24
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.roleIds).toEqual([1]);
            }
        });

        it("accepts valid body with roleIds", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "invitee@example.com",
                roleIds: [1, 2, 3],
                validHours: 48
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.roleIds).toEqual([1, 2, 3]);
            }
        });

        it("deduplicates roleIds", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "invitee@example.com",
                roleIds: [1, 1, 2, 2],
                validHours: 24
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.roleIds).toEqual([1, 2]);
            }
        });

        it("lowercases email", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "User@Example.COM",
                roleId: 1,
                validHours: 24
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.email).toBe("user@example.com");
            }
        });

        it("rejects email without @ symbol", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "not-an-email",
                roleId: 1,
                validHours: 24
            });
            expect(result.success).toBe(false);
        });

        it("requires at least one of roleId or roleIds", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                validHours: 24
            });
            expect(result.success).toBe(false);
        });

        it("rejects empty roleIds array", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleIds: [],
                validHours: 24
            });
            expect(result.success).toBe(false);
        });

        it("rejects validHours = 0", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: 1,
                validHours: 0
            });
            expect(result.success).toBe(false);
        });

        it("rejects validHours > 168 (1 week)", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: 1,
                validHours: 169
            });
            expect(result.success).toBe(false);
        });

        it("accepts validHours = 168 (max boundary)", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: 1,
                validHours: 168
            });
            expect(result.success).toBe(true);
        });

        it("accepts sendEmail flag", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: 1,
                validHours: 24,
                sendEmail: true
            });
            expect(result.success).toBe(true);
        });

        it("accepts regenerate flag", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: 1,
                validHours: 24,
                regenerate: true
            });
            expect(result.success).toBe(true);
        });

        it("rejects negative roleId", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: -1,
                validHours: 24
            });
            expect(result.success).toBe(false);
        });

        it("rejects non-integer roleId", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: 1.5,
                validHours: 24
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = inviteUserBodySchema.safeParse({
                email: "user@example.com",
                roleId: 1,
                validHours: 24,
                extraField: "nope"
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── Accept Invite Schema ───────────────────────────────────────────
    describe("acceptInviteBodySchema", () => {
        it("accepts valid body", () => {
            const result = acceptInviteBodySchema.safeParse({
                token: "abc123",
                inviteId: "invite-1"
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing token", () => {
            const result = acceptInviteBodySchema.safeParse({
                inviteId: "invite-1"
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing inviteId", () => {
            const result = acceptInviteBodySchema.safeParse({
                token: "abc123"
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = acceptInviteBodySchema.safeParse({
                token: "abc123",
                inviteId: "invite-1",
                extra: "nope"
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── Create Org User Schema ─────────────────────────────────────────
    describe("createOrgUserBodySchema", () => {
        it("accepts valid OIDC user with roleId", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "john.doe",
                type: "oidc",
                idpId: 1,
                roleId: 1
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.roleIds).toEqual([1]);
            }
        });

        it("accepts valid body with roleIds array", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "john.doe",
                type: "oidc",
                idpId: 1,
                roleIds: [1, 2]
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.roleIds).toEqual([1, 2]);
            }
        });

        it("lowercases username", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "JohnDoe",
                roleId: 1
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.username).toBe("johndoe");
            }
        });

        it("lowercases email", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "johndoe",
                email: "JohnDoe@Example.COM",
                roleId: 1
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.email).toBe("johndoe@example.com");
            }
        });

        it("requires at least one of roleId or roleIds", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "johndoe"
            });
            expect(result.success).toBe(false);
        });

        it("rejects empty username", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "",
                roleId: 1
            });
            expect(result.success).toBe(false);
        });

        it("accepts optional name", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "johndoe",
                name: "John Doe",
                roleId: 1
            });
            expect(result.success).toBe(true);
        });

        it("accepts type enum values", () => {
            expect(
                createOrgUserBodySchema.safeParse({
                    username: "a",
                    type: "internal",
                    roleId: 1
                }).success
            ).toBe(true);
            expect(
                createOrgUserBodySchema.safeParse({
                    username: "a",
                    type: "oidc",
                    roleId: 1
                }).success
            ).toBe(true);
        });

        it("rejects invalid type", () => {
            const result = createOrgUserBodySchema.safeParse({
                username: "a",
                type: "ldap",
                roleId: 1
            });
            expect(result.success).toBe(false);
        });
    });
});
