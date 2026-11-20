import "@server/extendZod";
import { z } from "zod";

const approvalState = z
    .enum(["approved", "denied", "pending"])
    .nullable()
    .openapi({
        description:
            "Whether the client was approved by an admin. Only set when the owner's role requires device approval."
    });

const clientFields = {
    clientId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the client." }),
    orgId: z.string().openapi({
        description: "ID of the organization the client belongs to."
    }),
    niceId: z.string().openapi({
        description:
            "Human readable ID of the client, unique within the organization."
    }),
    name: z.string().openapi({ description: "Client name." }),
    pubKey: z.string().nullable().openapi({
        description: "WireGuard public key of the client."
    }),
    subnet: z.string().openapi({
        description:
            "Address assigned to the client inside the overlay network."
    }),
    megabytesIn: z.number().nullable().openapi({
        description: "Megabytes received from the client."
    }),
    megabytesOut: z.number().nullable().openapi({
        description: "Megabytes sent to the client."
    }),
    type: z.string().openapi({
        description: "Kind of client, for example olm."
    }),
    online: z.boolean().openapi({
        description: "Whether the client is currently connected."
    }),
    userId: z.string().nullable().openapi({
        description:
            "ID of the user that owns the client. Null for machine clients."
    }),
    approvalState,
    archived: z.boolean().openapi({
        description: "Whether the client is archived and hidden from lists."
    }),
    blocked: z.boolean().openapi({
        description: "Whether the client is blocked from connecting."
    })
};

export const ClientSchema = z.object({
    ...clientFields,
    olmId: z.string().nullable().openapi({
        description: "ID of the Olm agent the client authenticates with."
    }),
    exitNodeId: z.number().int().nullable().openapi({
        description: "ID of the exit node the client connects through."
    }),
    exitNodeSubnet: z.string().nullable().openapi({
        description: "Subnet the exit node allocated to this client."
    }),
    maxConnections: z.number().int().nullable().openapi({
        description: "Maximum number of simultaneous connections, when limited."
    }),
    lastBandwidthUpdate: z.string().nullable().openapi({
        description: "ISO timestamp of the last bandwidth update."
    }),
    lastHolePunch: z.number().int().nullable().openapi({
        description: "Epoch seconds of the last hole punch from the client."
    }),
    lastPing: z.number().int().nullable().openapi({
        description: "Epoch seconds of the last ping from the client."
    })
});

const postureValue = z
    .union([z.boolean(), z.null(), z.literal("-")])
    .optional();

export const ClientPostureSchema = z
    .object({
        biometricsEnabled: postureValue,
        diskEncrypted: postureValue,
        firewallEnabled: postureValue,
        autoUpdatesEnabled: postureValue,
        tpmAvailable: postureValue,
        windowsAntivirusEnabled: postureValue,
        macosSipEnabled: postureValue,
        macosGatekeeperEnabled: postureValue,
        macosFirewallStealthMode: postureValue,
        linuxAppArmorEnabled: postureValue,
        linuxSELinuxEnabled: postureValue
    })
    .openapi({
        description:
            'Device security posture reported by the client. Fields are only present for the client platform. "-" means the value is hidden because the organization is not on a plan that includes posture checks.'
    });

export const ClientFingerprintSchema = z
    .object({
        username: z.string().nullable(),
        hostname: z.string().nullable(),
        platform: z.string().nullable(),
        osVersion: z.string().nullable(),
        kernelVersion: z.string().nullable(),
        arch: z.string().nullable(),
        deviceModel: z.string().nullable(),
        serialNumber: z.string().nullable(),
        firstSeen: z.number().int().nullable().openapi({
            description: "Epoch seconds when the device was first seen."
        }),
        lastSeen: z.number().int().nullable().openapi({
            description: "Epoch seconds when the device was last seen."
        })
    })
    .openapi({
        description: "Hardware and OS details reported by the device."
    });

const clientRoleRef = z.object({
    roleId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the role." }),
    name: z.string().openapi({ description: "Role name." })
});

export const ClientDetailSchema = ClientSchema.extend({
    agent: z
        .string()
        .nullable()
        .openapi({ description: "Name of the agent software." }),
    olmVersion: z
        .string()
        .nullable()
        .openapi({ description: "Version of the Olm agent." }),
    agentVersion: z.string().nullable().openapi({
        description: "Version of the agent software."
    }),
    userEmail: z
        .string()
        .nullable()
        .openapi({ description: "Email of the owning user." }),
    userName: z
        .string()
        .nullable()
        .openapi({ description: "Name of the owning user." }),
    userUsername: z.string().nullable().openapi({
        description: "Username of the owning user."
    }),
    fingerprint: ClientFingerprintSchema.nullable(),
    posture: ClientPostureSchema.nullable(),
    userType: z.string().nullable().openapi({
        description: "Sign-in type of the owning user."
    }),
    idpName: z.string().nullable().openapi({
        description: "Name of the identity provider the owning user belongs to."
    }),
    idpVariant: z.string().nullable().openapi({
        description:
            "Variant of the identity provider (for example oidc flavor)."
    }),
    roles: z.array(clientRoleRef).openapi({
        description:
            "Roles assigned directly to the client. Machine clients only."
    })
});

const clientLabels = z
    .array(
        z.object({
            labelId: z
                .number()
                .int()
                .openapi({ description: "Numeric ID of the label." }),
            name: z.string().openapi({ description: "Label name." }),
            color: z.string().openapi({ description: "Label color." })
        })
    )
    .optional()
    .openapi({ description: "Labels attached to the client." });

export const ClientListItemSchema = z.object({
    ...clientFields,
    orgName: z.string().nullable().openapi({
        description: "Name of the organization the client belongs to."
    }),
    olmVersion: z
        .string()
        .nullable()
        .openapi({ description: "Version of the Olm agent." }),
    username: z
        .string()
        .nullable()
        .openapi({ description: "Username of the owning user." }),
    userEmail: z
        .string()
        .nullable()
        .openapi({ description: "Email of the owning user." }),
    agent: z
        .string()
        .nullable()
        .openapi({ description: "Name of the agent software." }),
    agentVersion: z.string().nullable().openapi({
        description: "Version of the agent software."
    }),
    olmArchived: z.boolean().nullable().openapi({
        description: "Whether the client's Olm agent is archived."
    }),
    sites: z
        .array(
            z.object({
                siteId: z
                    .number()
                    .int()
                    .openapi({ description: "Numeric ID of the site." }),
                siteName: z
                    .string()
                    .nullable()
                    .openapi({ description: "Site name." }),
                siteNiceId: z.string().nullable().openapi({
                    description: "Human readable ID of the site."
                })
            })
        )
        .openapi({ description: "Sites the client can currently reach." }),
    olmUpdateAvailable: z.boolean().optional().openapi({
        description: "Whether a newer Olm version is available."
    }),
    labels: clientLabels,
    roles: z.array(clientRoleRef).openapi({
        description: "Roles assigned directly to the client."
    })
});

export const UserDeviceListItemSchema = z.object({
    ...clientFields,
    orgName: z.string().nullable().openapi({
        description: "Name of the organization the device belongs to."
    }),
    olmVersion: z
        .string()
        .nullable()
        .openapi({ description: "Version of the Olm agent." }),
    username: z
        .string()
        .nullable()
        .openapi({ description: "Username of the owning user." }),
    userEmail: z
        .string()
        .nullable()
        .openapi({ description: "Email of the owning user." }),
    userType: z.string().nullable().openapi({
        description: "Sign-in type of the owning user."
    }),
    idpName: z.string().nullable().openapi({
        description: "Name of the identity provider the owning user belongs to."
    }),
    idpVariant: z.string().nullable().openapi({
        description: "Variant of the identity provider."
    }),
    agent: z
        .string()
        .nullable()
        .openapi({ description: "Name of the agent software." }),
    agentVersion: z.string().nullable().openapi({
        description: "Version of the agent software."
    }),
    olmArchived: z.boolean().nullable().openapi({
        description: "Whether the device's Olm agent is archived."
    }),
    deviceModel: z
        .string()
        .nullable()
        .openapi({ description: "Device model." }),
    fingerprintPlatform: z
        .string()
        .nullable()
        .openapi({ description: "Operating system platform." }),
    fingerprintOsVersion: z
        .string()
        .nullable()
        .openapi({ description: "Operating system version." }),
    fingerprintKernelVersion: z
        .string()
        .nullable()
        .openapi({ description: "Kernel version." }),
    fingerprintArch: z
        .string()
        .nullable()
        .openapi({ description: "CPU architecture." }),
    fingerprintSerialNumber: z
        .string()
        .nullable()
        .openapi({ description: "Device serial number." }),
    fingerprintUsername: z.string().nullable().openapi({
        description: "OS username the client runs as."
    }),
    fingerprintHostname: z
        .string()
        .nullable()
        .openapi({ description: "Device hostname." }),
    firstSeen: z.number().int().nullable().openapi({
        description: "Epoch seconds when the device was first seen."
    }),
    lastSeen: z.number().int().nullable().openapi({
        description: "Epoch seconds when the device was last seen."
    }),
    olmUpdateAvailable: z.boolean().optional().openapi({
        description: "Whether a newer Olm version is available."
    })
});
