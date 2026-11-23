import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { sites } from "@server/db";

export const SiteSchema = createSelectSchema(sites, {
    address: (s) =>
        s.openapi({
            description:
                "Address assigned to the site inside the overlay network."
        }),
    autoUpdateEnabled: (s) =>
        s.openapi({
            description: "Whether the site agent updates itself automatically."
        }),
    autoUpdateOverrideOrg: (s) =>
        s.openapi({
            description:
                "Whether this site's auto update setting overrides the organization-wide one."
        }),
    dockerSocketEnabled: (s) =>
        s.openapi({
            description:
                "Whether the dashboard may discover containers through the site's Docker socket."
        }),
    endpoint: (s) =>
        s.openapi({ description: "Last known public endpoint of the site." }),
    exitNodeId: (s) =>
        s.openapi({
            description: "ID of the exit node the site connects through."
        }),
    exitNodeSubnet: (s) =>
        s.openapi({
            description: "Subnet the exit node allocated to this site."
        }),
    lastBandwidthUpdate: (s) =>
        s.openapi({
            description: "ISO timestamp of the last bandwidth update."
        }),
    lastHolePunch: (s) =>
        s.openapi({
            description: "Epoch seconds of the last hole punch from the site."
        }),
    lastPing: (s) =>
        s.openapi({
            description: "Epoch seconds of the last ping from the site."
        }),
    listenPort: (s) =>
        s.openapi({ description: "WireGuard listen port of the site." }),
    localEndpoints: (s) =>
        s.openapi({
            description:
                "Local network endpoints reported by the site, as JSON."
        }),
    megabytesIn: (s) =>
        s.openapi({ description: "Megabytes received from the site." }),
    megabytesOut: (s) =>
        s.openapi({ description: "Megabytes sent to the site." }),
    name: (s) => s.openapi({ description: "Site name." }),
    niceId: (s) =>
        s.openapi({
            description:
                "Human readable ID of the site, unique within the organization."
        }),
    online: (s) =>
        s.openapi({ description: "Whether the site is currently connected." }),
    orgId: (s) =>
        s.openapi({
            description: "ID of the organization the site belongs to."
        }),
    pubKey: (s) =>
        s.openapi({ description: "Legacy WireGuard public key of the site." }),
    publicKey: (s) =>
        s.openapi({ description: "WireGuard public key of the site." }),
    siteId: (s) => s.openapi({ description: "Numeric ID of the site." }),
    status: z.enum(["approved", "pending"]).nullable().openapi({
        description:
            "Approval state. Sites provisioned with approval required stay pending until approved."
    }),
    type: (s) =>
        s.openapi({
            description:
                "Kind of site connector: newt (a Newt tunnel agent), wireguard, or local."
        })
});
