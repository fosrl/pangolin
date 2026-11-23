import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { siteResources } from "@server/db";

export const SiteResourceSchema = createSelectSchema(siteResources, {
    alias: (s) =>
        s.openapi({
            description:
                "Internal DNS alias clients can use to reach the resource."
        }),
    aliasAddress: (s) =>
        s.openapi({ description: "Virtual IP address assigned to the alias." }),
    authDaemonMode: z.enum(["site", "remote", "native"]).nullable().openapi({
        description:
            "Where the SSH auth daemon runs: on the site, on a remote host, or natively on the target. Only used by ssh mode."
    }),
    authDaemonPort: (s) =>
        s.openapi({
            description:
                "Port the SSH auth daemon listens on. Only used by ssh mode."
        }),
    defaultNetworkId: (s) =>
        s.openapi({
            description:
                "ID of the network that was created for this private resource by default."
        }),
    destination: (s) =>
        s.openapi({ description: "Destination IP address, CIDR or hostname." }),
    destinationPort: (s) =>
        s.openapi({
            description: "Port on the destination that traffic is forwarded to."
        }),
    disableIcmp: (s) =>
        s.openapi({
            description:
                "Whether ICMP (ping) traffic to the resource is blocked."
        }),
    domainId: (s) =>
        s.openapi({ description: "ID of the domain used for http mode." }),
    enabled: (s) =>
        s.openapi({
            description:
                "Whether the resource is currently reachable by clients."
        }),
    fullDomain: (s) =>
        s.openapi({ description: "Full domain name used for http mode." }),
    mode: z
        .enum(["host", "cidr", "http", "ssh", "inference", "gateway"])
        .openapi({
            description:
                "How the resource is exposed: a single host, a CIDR range, an HTTP(S) destination, SSH, an AI inference endpoint, or a gateway."
        }),
    name: (s) => s.openapi({ description: "Display name." }),
    networkId: (s) =>
        s.openapi({
            description:
                "ID of the network the private resource is attached to, which determines the sites that can serve it."
        }),
    niceId: (s) =>
        s.openapi({
            description:
                "Human readable identifier, unique within the organization."
        }),
    orgId: (s) =>
        s.openapi({
            description:
                "ID of the organization that owns the private resource."
        }),
    pamMode: z.enum(["passthrough", "push"]).nullable().openapi({
        description: "How SSH authentication is handled. Only used by ssh mode."
    }),
    proxyPort: (s) =>
        s.openapi({
            description:
                "Port clients connect to on the resource, when applicable."
        }),
    requiresExitNodeConnection: (s) =>
        s.openapi({
            description:
                "Whether traffic to this resource has to be relayed through an exit node."
        }),
    scheme: z.enum(["http", "https"]).nullable().openapi({
        description:
            "Protocol used to reach the destination. Only set for http mode."
    }),
    siteResourceId: (s) =>
        s.openapi({ description: "Numeric ID of the private resource." }),
    ssl: (s) =>
        s.openapi({
            description: "Whether SSL is enabled. Only used by http mode."
        }),
    status: z.enum(["pending", "approved"]).nullable().openapi({
        description:
            "Approval state of the resource. Resources created by a site waiting for approval are pending."
    }),
    subdomain: (s) =>
        s.openapi({ description: "Subdomain used for http mode." }),
    tcpPortRangeString: (s) =>
        s.openapi({
            description:
                'Allowed TCP ports as a comma separated list of ports and ranges, e.g. "80,443,8000-9000". "*" allows all ports.'
        }),
    udpPortRangeString: (s) =>
        s.openapi({
            description:
                'Allowed UDP ports as a comma separated list of ports and ranges. "*" allows all ports.'
        })
});

export const PrivateResourceIdParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive().openapi({
        description: "Numeric ID of the private resource."
    })
});
