import "@server/extendZod";
import { z } from "zod";
import type { SiteResource } from "@server/db";
import type { Assert, Equals } from "../createApiResponseSchema";

// Docs-only params for the /private-resource/{resourceId}/... paths. The
// Express routes and handlers still call this param `siteResourceId`.
export const PrivateResourceIdParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive().openapi({
        description: "Numeric ID of the private resource."
    })
});

export const SiteResourceSchema = z.object({
    siteResourceId: z.number().int().openapi({
        description: "Numeric ID of the private resource."
    }),
    orgId: z.string().openapi({
        description: "ID of the organization that owns the private resource."
    }),
    networkId: z.number().int().nullable().openapi({
        description:
            "ID of the network the private resource is attached to, which determines the sites that can serve it."
    }),
    defaultNetworkId: z.number().int().nullable().openapi({
        description:
            "ID of the network that was created for this private resource by default."
    }),
    requiresExitNodeConnection: z.boolean().openapi({
        description:
            "Whether traffic to this resource has to be relayed through an exit node."
    }),
    niceId: z.string().openapi({
        description:
            "Human readable identifier, unique within the organization."
    }),
    name: z.string().openapi({ description: "Display name." }),
    ssl: z.boolean().openapi({
        description: "Whether SSL is enabled. Only used by http mode."
    }),
    mode: z
        .enum(["host", "cidr", "http", "ssh", "inference", "gateway"])
        .openapi({
            description:
                "How the resource is exposed: a single host, a CIDR range, an HTTP(S) destination, SSH, an AI inference endpoint, or a gateway."
        }),
    scheme: z.enum(["http", "https"]).nullable().openapi({
        description:
            "Protocol used to reach the destination. Only set for http mode."
    }),
    proxyPort: z.number().int().nullable().openapi({
        description: "Port clients connect to on the resource, when applicable."
    }),
    destinationPort: z.number().int().nullable().openapi({
        description: "Port on the destination that traffic is forwarded to."
    }),
    destination: z.string().nullable().openapi({
        description: "Destination IP address, CIDR or hostname."
    }),
    enabled: z.boolean().openapi({
        description: "Whether the resource is currently reachable by clients."
    }),
    alias: z.string().nullable().openapi({
        description: "Internal DNS alias clients can use to reach the resource."
    }),
    aliasAddress: z.string().nullable().openapi({
        description: "Virtual IP address assigned to the alias."
    }),
    tcpPortRangeString: z.string().openapi({
        description:
            'Allowed TCP ports as a comma separated list of ports and ranges, e.g. "80,443,8000-9000". "*" allows all ports.'
    }),
    udpPortRangeString: z.string().openapi({
        description:
            'Allowed UDP ports as a comma separated list of ports and ranges. "*" allows all ports.'
    }),
    disableIcmp: z.boolean().openapi({
        description: "Whether ICMP (ping) traffic to the resource is blocked."
    }),
    authDaemonPort: z.number().int().nullable().openapi({
        description:
            "Port the SSH auth daemon listens on. Only used by ssh mode."
    }),
    pamMode: z.enum(["passthrough", "push"]).nullable().openapi({
        description: "How SSH authentication is handled. Only used by ssh mode."
    }),
    authDaemonMode: z.enum(["site", "remote", "native"]).nullable().openapi({
        description:
            "Where the SSH auth daemon runs: on the site, on a remote host, or natively on the target. Only used by ssh mode."
    }),
    domainId: z.string().nullable().openapi({
        description: "ID of the domain used for http mode."
    }),
    subdomain: z.string().nullable().openapi({
        description: "Subdomain used for http mode."
    }),
    fullDomain: z.string().nullable().openapi({
        description: "Full domain name used for http mode."
    }),
    status: z.enum(["pending", "approved"]).nullable().openapi({
        description:
            "Approval state of the resource. Resources created by a site waiting for approval are pending."
    })
});

type _SiteResourceCheck = Assert<
    Equals<z.infer<typeof SiteResourceSchema>, SiteResource>
>;

export const SiteResourceLabelSchema = z.object({
    labelId: z
        .number()
        .int()
        .openapi({ description: "Numeric ID of the label." }),
    name: z.string().openapi({ description: "Label name." }),
    color: z.string().openapi({ description: "Label color." })
});

export const SiteResourceWithSitesSchema = SiteResourceSchema.extend({
    siteIds: z.array(z.number().int()).openapi({
        description:
            "IDs of the sites that can serve this resource. Parallel to siteNames, siteNiceIds, siteAddresses and siteOnlines."
    }),
    siteNames: z
        .array(z.string())
        .openapi({ description: "Names of the sites." }),
    siteNiceIds: z.array(z.string()).openapi({
        description: "Nice IDs of the sites."
    }),
    siteAddresses: z.array(z.string().nullable()).openapi({
        description: "Overlay addresses of the sites."
    }),
    siteOnlines: z.array(z.boolean()).openapi({
        description: "Whether each site is currently online."
    }),
    labels: z.array(SiteResourceLabelSchema).optional().openapi({
        description: "Labels attached to the resource."
    })
});
