import { build } from "@server/build";
import { Env } from "./types/env";

// Custom records are only served by Pangolin's own nameservers, so they only
// apply to NS-delegated domains on deployments running Pangolin DNS
export function supportsCustomDnsRecords(
    env: Env,
    domainType: string | null
): boolean {
    return (
        build !== "oss" &&
        env.flags.usePangolinDns &&
        !env.flags.disableEnterpriseFeatures &&
        domainType === "ns"
    );
}
