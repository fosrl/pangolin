import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Resource Schemas (from createResource.ts) ────────────────────────

const createResourceParamsSchema = z.strictObject({
    orgId: z.string()
});

const createHttpResourceSchema = z.strictObject({
    name: z.string().min(1).max(255),
    subdomain: z.string().nullable().optional(),
    http: z.boolean(),
    protocol: z.enum(["tcp", "udp"]),
    domainId: z.string(),
    stickySession: z.boolean().optional(),
    postAuthPath: z.string().nullable().optional()
});

const createRawResourceSchema = z.strictObject({
    name: z.string().min(1).max(255),
    http: z.boolean(),
    protocol: z.enum(["tcp", "udp"]),
    proxyPort: z.number().int().min(1).max(65535)
});

// ─── Org Schemas (from createOrg.ts) ──────────────────────────────────

const validOrgIdRegex = /^[a-z0-9_]+(-[a-z0-9_]+)*$/;

const createOrgSchema = z.strictObject({
    orgId: z
        .string()
        .min(1, "Organization ID is required")
        .max(32, "Organization ID must be at most 32 characters")
        .refine((val) => validOrgIdRegex.test(val), {
            message:
                "Organization ID must contain only lowercase letters, numbers, underscores, and single hyphens"
        }),
    name: z.string().min(1).max(255),
    subnet: z.union([z.cidrv4()]),
    utilitySubnet: z.union([z.cidrv4()])
});

// ─── Site Schemas (from createSite.ts) ────────────────────────────────

const createSiteSchema = z.strictObject({
    name: z.string().min(1).max(255),
    exitNodeId: z.number().int().positive().optional(),
    pubKey: z.string().optional(),
    subnet: z.string().optional(),
    newtId: z.string().optional(),
    secret: z.string().optional(),
    address: z.string().optional(),
    type: z.enum(["newt", "wireguard", "local"])
});

// ─── Role Schemas (from createRole.ts) ────────────────────────────────

const createRoleSchema = z.strictObject({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    requireDeviceApproval: z.boolean().optional(),
    allowSsh: z.boolean().optional(),
    sshSudoMode: z.enum(["none", "full", "commands"]).optional(),
    sshSudoCommands: z.array(z.string()).optional(),
    sshCreateHomeDir: z.boolean().optional(),
    sshUnixGroups: z.array(z.string()).optional()
});

describe("Resource Schemas", () => {
    describe("createResourceParamsSchema", () => {
        it("accepts valid orgId", () => {
            expect(createResourceParamsSchema.safeParse({ orgId: "my-org" }).success).toBe(true);
        });

        it("rejects missing orgId", () => {
            expect(createResourceParamsSchema.safeParse({}).success).toBe(false);
        });
    });

    describe("createHttpResourceSchema", () => {
        it("accepts valid HTTP resource", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "My App",
                http: true,
                protocol: "tcp",
                domainId: "domain-1"
            });
            expect(result.success).toBe(true);
        });

        it("accepts optional subdomain", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "My App",
                http: true,
                protocol: "tcp",
                domainId: "domain-1",
                subdomain: "app"
            });
            expect(result.success).toBe(true);
        });

        it("accepts null subdomain", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "My App",
                http: true,
                protocol: "tcp",
                domainId: "domain-1",
                subdomain: null
            });
            expect(result.success).toBe(true);
        });

        it("accepts optional stickySession", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "My App",
                http: true,
                protocol: "tcp",
                domainId: "domain-1",
                stickySession: true
            });
            expect(result.success).toBe(true);
        });

        it("accepts postAuthPath", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "My App",
                http: true,
                protocol: "tcp",
                domainId: "domain-1",
                postAuthPath: "/dashboard"
            });
            expect(result.success).toBe(true);
        });

        it("rejects empty name", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "",
                http: true,
                protocol: "tcp",
                domainId: "domain-1"
            });
            expect(result.success).toBe(false);
        });

        it("rejects name over 255 chars", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "A".repeat(256),
                http: true,
                protocol: "tcp",
                domainId: "domain-1"
            });
            expect(result.success).toBe(false);
        });

        it("rejects invalid protocol", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "My App",
                http: true,
                protocol: "icmp",
                domainId: "domain-1"
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing domainId", () => {
            const result = createHttpResourceSchema.safeParse({
                name: "My App",
                http: true,
                protocol: "tcp"
            });
            expect(result.success).toBe(false);
        });
    });

    describe("createRawResourceSchema", () => {
        it("accepts valid raw resource", () => {
            const result = createRawResourceSchema.safeParse({
                name: "Raw Service",
                http: false,
                protocol: "tcp",
                proxyPort: 8080
            });
            expect(result.success).toBe(true);
        });

        it("rejects port = 0", () => {
            const result = createRawResourceSchema.safeParse({
                name: "Raw Service",
                http: false,
                protocol: "tcp",
                proxyPort: 0
            });
            expect(result.success).toBe(false);
        });

        it("rejects port > 65535", () => {
            const result = createRawResourceSchema.safeParse({
                name: "Raw Service",
                http: false,
                protocol: "tcp",
                proxyPort: 65536
            });
            expect(result.success).toBe(false);
        });

        it("accepts boundary ports 1 and 65535", () => {
            expect(
                createRawResourceSchema.safeParse({
                    name: "A",
                    http: false,
                    protocol: "tcp",
                    proxyPort: 1
                }).success
            ).toBe(true);
            expect(
                createRawResourceSchema.safeParse({
                    name: "A",
                    http: false,
                    protocol: "udp",
                    proxyPort: 65535
                }).success
            ).toBe(true);
        });

        it("rejects non-integer port", () => {
            const result = createRawResourceSchema.safeParse({
                name: "A",
                http: false,
                protocol: "tcp",
                proxyPort: 80.5
            });
            expect(result.success).toBe(false);
        });
    });
});

describe("Organization Schemas", () => {
    describe("createOrgSchema", () => {
        it("accepts valid org", () => {
            const result = createOrgSchema.safeParse({
                orgId: "my_org",
                name: "My Organization",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(true);
        });

        it("accepts orgId with hyphens", () => {
            const result = createOrgSchema.safeParse({
                orgId: "my-org-123",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(true);
        });

        it("accepts orgId with underscores", () => {
            const result = createOrgSchema.safeParse({
                orgId: "my_org_123",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(true);
        });

        it("rejects orgId with uppercase", () => {
            const result = createOrgSchema.safeParse({
                orgId: "MyOrg",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(false);
        });

        it("rejects orgId with leading hyphen", () => {
            const result = createOrgSchema.safeParse({
                orgId: "-my-org",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(false);
        });

        it("rejects orgId with trailing hyphen", () => {
            const result = createOrgSchema.safeParse({
                orgId: "my-org-",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(false);
        });

        it("rejects orgId with consecutive hyphens", () => {
            const result = createOrgSchema.safeParse({
                orgId: "my--org",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(false);
        });

        it("rejects orgId over 32 chars", () => {
            const result = createOrgSchema.safeParse({
                orgId: "a".repeat(33),
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(false);
        });

        it("rejects invalid CIDR subnet", () => {
            const result = createOrgSchema.safeParse({
                orgId: "myorg",
                name: "Test",
                subnet: "not-a-cidr",
                utilitySubnet: "100.90.0.0/16"
            });
            expect(result.success).toBe(false);
        });

        it("rejects invalid utilitySubnet CIDR", () => {
            const result = createOrgSchema.safeParse({
                orgId: "myorg",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "invalid"
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = createOrgSchema.safeParse({
                orgId: "myorg",
                name: "Test",
                subnet: "10.0.0.0/16",
                utilitySubnet: "100.90.0.0/16",
                extra: "nope"
            });
            expect(result.success).toBe(false);
        });
    });
});

describe("Site Schemas", () => {
    describe("createSiteSchema", () => {
        it("accepts valid newt site", () => {
            const result = createSiteSchema.safeParse({
                name: "Office Site",
                type: "newt",
                newtId: "newt-1",
                secret: "secret-123"
            });
            expect(result.success).toBe(true);
        });

        it("accepts valid wireguard site", () => {
            const result = createSiteSchema.safeParse({
                name: "Remote Site",
                type: "wireguard",
                exitNodeId: 1,
                pubKey: "abc123publickey",
                subnet: "10.0.1.0/24"
            });
            expect(result.success).toBe(true);
        });

        it("accepts valid local site", () => {
            const result = createSiteSchema.safeParse({
                name: "Local Site",
                type: "local"
            });
            expect(result.success).toBe(true);
        });

        it("rejects invalid type", () => {
            const result = createSiteSchema.safeParse({
                name: "Bad Site",
                type: "invalid-type"
            });
            expect(result.success).toBe(false);
        });

        it("rejects empty name", () => {
            const result = createSiteSchema.safeParse({
                name: "",
                type: "newt"
            });
            expect(result.success).toBe(false);
        });

        it("rejects name over 255 chars", () => {
            const result = createSiteSchema.safeParse({
                name: "A".repeat(256),
                type: "newt"
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = createSiteSchema.safeParse({
                name: "Test",
                type: "newt",
                extra: "nope"
            });
            expect(result.success).toBe(false);
        });
    });
});

describe("Role Schemas", () => {
    describe("createRoleSchema", () => {
        it("accepts minimal role", () => {
            const result = createRoleSchema.safeParse({
                name: "Editor"
            });
            expect(result.success).toBe(true);
        });

        it("accepts role with all SSH fields", () => {
            const result = createRoleSchema.safeParse({
                name: "DevOps",
                description: "Full SSH access",
                requireDeviceApproval: true,
                allowSsh: true,
                sshSudoMode: "full",
                sshCreateHomeDir: true,
                sshUnixGroups: ["docker", "sudo"]
            });
            expect(result.success).toBe(true);
        });

        it("accepts sshSudoMode enum values", () => {
            for (const mode of ["none", "full", "commands"]) {
                expect(
                    createRoleSchema.safeParse({ name: "R", sshSudoMode: mode })
                        .success
                ).toBe(true);
            }
        });

        it("rejects invalid sshSudoMode", () => {
            expect(
                createRoleSchema.safeParse({
                    name: "R",
                    sshSudoMode: "partial"
                }).success
            ).toBe(false);
        });

        it("rejects empty name", () => {
            expect(createRoleSchema.safeParse({ name: "" }).success).toBe(
                false
            );
        });

        it("rejects name over 255 chars", () => {
            expect(
                createRoleSchema.safeParse({ name: "A".repeat(256) }).success
            ).toBe(false);
        });

        it("accepts sshSudoCommands as string array", () => {
            const result = createRoleSchema.safeParse({
                name: "Limited",
                sshSudoCommands: ["apt update", "systemctl restart nginx"]
            });
            expect(result.success).toBe(true);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = createRoleSchema.safeParse({
                name: "Test",
                extra: "nope"
            });
            expect(result.success).toBe(false);
        });
    });
});
