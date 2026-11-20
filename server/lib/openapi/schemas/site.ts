import "@server/extendZod";
import { z } from "zod";

export const SiteSchema = z.object({
    siteId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the site." }),
    orgId: z.string().openapi({
        description: "ID of the organization the site belongs to."
    }),
    niceId: z.string().openapi({
        description:
            "Human readable ID of the site, unique within the organization."
    }),
    name: z.string().openapi({ description: "Site name." }),
    type: z.string().openapi({
        description:
            "Kind of site connector: newt (a Newt tunnel agent), wireguard, or local."
    }),
    online: z.boolean().openapi({
        description: "Whether the site is currently connected."
    }),
    status: z.enum(["approved", "pending"]).nullable().openapi({
        description:
            "Approval state. Sites provisioned with approval required stay pending until approved."
    }),
    address: z.string().nullable().openapi({
        description: "Address assigned to the site inside the overlay network."
    }),
    exitNodeId: z.number().int().nullable().openapi({
        description: "ID of the exit node the site connects through."
    }),
    exitNodeSubnet: z.string().nullable().openapi({
        description: "Subnet the exit node allocated to this site."
    }),
    endpoint: z.string().nullable().openapi({
        description: "Last known public endpoint of the site."
    }),
    listenPort: z.number().int().nullable().openapi({
        description: "WireGuard listen port of the site."
    }),
    localEndpoints: z.string().nullable().openapi({
        description: "Local network endpoints reported by the site, as JSON."
    }),
    pubKey: z.string().nullable().openapi({
        description: "Legacy WireGuard public key of the site."
    }),
    publicKey: z.string().nullable().openapi({
        description: "WireGuard public key of the site."
    }),
    megabytesIn: z.number().nullable().openapi({
        description: "Megabytes received from the site."
    }),
    megabytesOut: z.number().nullable().openapi({
        description: "Megabytes sent to the site."
    }),
    lastBandwidthUpdate: z.string().nullable().openapi({
        description: "ISO timestamp of the last bandwidth update."
    }),
    lastHolePunch: z.number().int().nullable().openapi({
        description: "Epoch seconds of the last hole punch from the site."
    }),
    lastPing: z.number().int().nullable().openapi({
        description: "Epoch seconds of the last ping from the site."
    }),
    dockerSocketEnabled: z.boolean().openapi({
        description:
            "Whether the dashboard may discover containers through the site's Docker socket."
    }),
    autoUpdateEnabled: z.boolean().openapi({
        description: "Whether the site agent updates itself automatically."
    }),
    autoUpdateOverrideOrg: z.boolean().openapi({
        description:
            "Whether this site's auto update setting overrides the organization-wide one."
    })
});

export const SiteWithNewtSchema = SiteSchema.extend({
    newtId: z.string().nullable().openapi({
        description: "ID of the Newt agent connected to this site."
    }),
    newtVersion: z.string().nullable().openapi({
        description: "Version of the Newt agent."
    }),
    agent: z.string().nullable().openapi({
        description: "Name of the agent software."
    }),
    agentVersion: z.string().nullable().openapi({
        description: "Version of the agent software."
    }),
    countryCode: z.string().nullable().openapi({
        description:
            "Two letter country code resolved from the site's endpoint IP."
    })
});

export const SiteCreatedSchema = SiteSchema.extend({
    newtId: z.string().optional().openapi({
        description:
            "ID the Newt agent uses to authenticate. Only for newt sites."
    }),
    secret: z.string().optional().openapi({
        description:
            "Secret the Newt agent uses to authenticate. Only returned once, when the site is created."
    })
});

export const SiteListItemSchema = z.object({
    siteId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the site." }),
    niceId: z.string().openapi({
        description:
            "Human readable ID of the site, unique within the organization."
    }),
    name: z.string().openapi({ description: "Site name." }),
    pubKey: z.string().nullable().openapi({
        description: "Legacy WireGuard public key of the site."
    }),
    subnet: z.string().nullable().openapi({
        description: "Subnet the exit node allocated to this site."
    }),
    megabytesIn: z.number().nullable().openapi({
        description: "Megabytes received from the site."
    }),
    megabytesOut: z.number().nullable().openapi({
        description: "Megabytes sent to the site."
    }),
    orgName: z.string().nullable().openapi({
        description: "Name of the organization the site belongs to."
    }),
    type: z.string().openapi({
        description:
            "Kind of site connector: newt (a Newt tunnel agent), wireguard, or local."
    }),
    online: z.boolean().optional().openapi({
        description:
            "Whether the site is currently connected. Not set for local sites."
    }),
    address: z.string().nullable().openapi({
        description: "Address assigned to the site inside the overlay network."
    }),
    newtVersion: z.string().nullable().openapi({
        description: "Version of the Newt agent."
    }),
    agent: z.string().nullable().openapi({
        description: "Name of the agent software."
    }),
    agentVersion: z.string().nullable().openapi({
        description: "Version of the agent software."
    }),
    exitNodeId: z.number().int().nullable().openapi({
        description: "ID of the exit node the site connects through."
    }),
    exitNodeName: z.string().nullable().openapi({
        description: "Name of the exit node the site connects through."
    }),
    exitNodeEndpoint: z.string().nullable().openapi({
        description: "Endpoint of the exit node the site connects through."
    }),
    remoteExitNodeId: z.string().nullable().openapi({
        description:
            "ID of the remote exit node, when the site connects through one."
    }),
    resourceCount: z.number().int().openapi({
        description:
            "Number of public and private resources served by the site."
    }),
    status: z.enum(["approved", "pending"]).nullable().openapi({
        description:
            "Approval state. Sites provisioned with approval required stay pending until approved."
    }),
    newtUpdateAvailable: z.boolean().optional().openapi({
        description: "Whether a newer Newt version is available."
    }),
    labels: z
        .array(
            z.object({
                labelId: z.number().int().openapi({
                    description: "Numeric ID of the label."
                }),
                name: z.string().openapi({ description: "Label name." }),
                color: z.string().openapi({ description: "Label color." })
            })
        )
        .optional()
        .openapi({ description: "Labels attached to the site." })
});
