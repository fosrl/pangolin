import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { clients } from "@server/db";

export const ClientSchema = createSelectSchema(clients, {
    approvalState: z
        .enum(["approved", "denied", "pending"])
        .nullable()
        .openapi({
            description:
                "Whether the client was approved by an admin. Only set when the owner's role requires device approval."
        }),
    archived: (s) =>
        s.openapi({
            description: "Whether the client is archived and hidden from lists."
        }),
    blocked: (s) =>
        s.openapi({
            description: "Whether the client is blocked from connecting."
        }),
    clientId: (s) => s.openapi({ description: "Numeric ID of the client." }),
    exitNodeId: (s) =>
        s.openapi({
            description: "ID of the exit node the client connects through."
        }),
    exitNodeSubnet: (s) =>
        s.openapi({
            description: "Subnet the exit node allocated to this client."
        }),
    lastBandwidthUpdate: (s) =>
        s.openapi({
            description: "ISO timestamp of the last bandwidth update."
        }),
    lastHolePunch: (s) =>
        s.openapi({
            description: "Epoch seconds of the last hole punch from the client."
        }),
    lastPing: (s) =>
        s.openapi({
            description: "Epoch seconds of the last ping from the client."
        }),
    maxConnections: (s) =>
        s.openapi({
            description:
                "Maximum number of simultaneous connections, when limited."
        }),
    megabytesIn: (s) =>
        s.openapi({ description: "Megabytes received from the client." }),
    megabytesOut: (s) =>
        s.openapi({ description: "Megabytes sent to the client." }),
    name: (s) => s.openapi({ description: "Client name." }),
    niceId: (s) =>
        s.openapi({
            description:
                "Human readable ID of the client, unique within the organization."
        }),
    olmId: (s) =>
        s.openapi({
            description: "ID of the Olm agent the client authenticates with."
        }),
    online: (s) =>
        s.openapi({
            description: "Whether the client is currently connected."
        }),
    orgId: (s) =>
        s.openapi({
            description: "ID of the organization the client belongs to."
        }),
    pubKey: (s) =>
        s.openapi({ description: "WireGuard public key of the client." }),
    subnet: (s) =>
        s.openapi({
            description:
                "Address assigned to the client inside the overlay network."
        }),
    type: (s) => s.openapi({ description: "Kind of client, for example olm." }),
    userId: (s) =>
        s.openapi({
            description:
                "ID of the user that owns the client. Null for machine clients."
        })
});

export const ClientSummarySchema = ClientSchema.pick({
    clientId: true,
    name: true,
    subnet: true
});
