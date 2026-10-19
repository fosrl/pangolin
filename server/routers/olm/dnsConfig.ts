import config from "@server/lib/config";

// Mirrors the optional fields on the olm client's TunnelConfig - any field
// present here overrides the value the olm client is otherwise locally
// configured with; an absent field leaves the client's own config alone.
export type OlmDnsConfig = {
    upstreamDns?: string[];
    overrideDns?: boolean;
    tunnelDns?: boolean;
    matchDomains?: string[];
};

export function buildOlmDnsConfig(): OlmDnsConfig | undefined {
    return {
        upstreamDns: undefined,
        overrideDns: undefined,
        tunnelDns: undefined,
        matchDomains: undefined
    };
}
