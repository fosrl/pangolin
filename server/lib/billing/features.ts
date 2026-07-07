export enum LimitId {
    USERS = "users",
    SITES = "sites",
    EGRESS_DATA_MB = "egressDataMb",
    DOMAINS = "domains",
    REMOTE_EXIT_NODES = "remoteExitNodes",
    ORGANIZATIONS = "organizations",
    PUBLIC_RESOURCES = "publicResources",
    PRIVATE_RESOURCES = "privateResources",
    MACHINE_CLIENTS = "machineClients",
    TIER1 = "tier1"
}

export async function getFeatureDisplayName(
    featureId: LimitId
): Promise<string> {
    switch (featureId) {
        case LimitId.USERS:
            return "Users";
        case LimitId.SITES:
            return "Sites";
        case LimitId.EGRESS_DATA_MB:
            return "Egress Data (MB)";
        case LimitId.DOMAINS:
            return "Domains";
        case LimitId.REMOTE_EXIT_NODES:
            return "Remote Exit Nodes";
        case LimitId.ORGANIZATIONS:
            return "Organizations";
        case LimitId.PUBLIC_RESOURCES:
            return "Public Resources";
        case LimitId.PRIVATE_RESOURCES:
            return "Private Resources";
        case LimitId.MACHINE_CLIENTS:
            return "Machine Clients";
        case LimitId.TIER1:
            return "Home Lab";
        default:
            return featureId;
    }
}

// this is from the old system
export const FeatureMeterIds: Partial<Record<LimitId, string>> = {
    // right now we are not charging for any data
    // [FeatureId.EGRESS_DATA_MB]: "mtr_61Srreh9eWrExDSCe41D3Ee2Ir7Wm5YW"
};

export const FeatureMeterIdsSandbox: Partial<Record<LimitId, string>> = {
    // [FeatureId.EGRESS_DATA_MB]: "mtr_test_61Snh2a2m6qome5Kv41DCpkOb237B3dQ"
};

export function getFeatureMeterId(featureId: LimitId): string | undefined {
    if (
        process.env.ENVIRONMENT == "prod" &&
        process.env.SANDBOX_MODE !== "true"
    ) {
        return FeatureMeterIds[featureId];
    } else {
        return FeatureMeterIdsSandbox[featureId];
    }
}

export function getFeatureIdByMetricId(metricId: string): LimitId | undefined {
    return (Object.entries(FeatureMeterIds) as [LimitId, string][]).find(
        ([_, v]) => v === metricId
    )?.[0];
}

export type FeaturePriceSet = Partial<Record<LimitId, string>>;

export const tier1FeaturePriceSet: FeaturePriceSet = {
    [LimitId.TIER1]: "price_1SzVE3D3Ee2Ir7Wm6wT5Dl3G"
};

export const tier1FeaturePriceSetSandbox: FeaturePriceSet = {
    [LimitId.TIER1]: "price_1SxgpPDCpkOb237Bfo4rIsoT"
};

export function getTier1FeaturePriceSet(): FeaturePriceSet {
    if (
        process.env.ENVIRONMENT == "prod" &&
        process.env.SANDBOX_MODE !== "true"
    ) {
        return tier1FeaturePriceSet;
    } else {
        return tier1FeaturePriceSetSandbox;
    }
}

export const tier2FeaturePriceSet: FeaturePriceSet = {
    [LimitId.USERS]: "price_1SzVCcD3Ee2Ir7Wmn6U3KvPN"
};

export const tier2FeaturePriceSetSandbox: FeaturePriceSet = {
    [LimitId.USERS]: "price_1SxaEHDCpkOb237BD9lBkPiR"
};

export function getTier2FeaturePriceSet(): FeaturePriceSet {
    if (
        process.env.ENVIRONMENT == "prod" &&
        process.env.SANDBOX_MODE !== "true"
    ) {
        return tier2FeaturePriceSet;
    } else {
        return tier2FeaturePriceSetSandbox;
    }
}

export const tier3FeaturePriceSet: FeaturePriceSet = {
    [LimitId.USERS]: "price_1SzVDKD3Ee2Ir7WmPtOKNusv"
};

export const tier3FeaturePriceSetSandbox: FeaturePriceSet = {
    [LimitId.USERS]: "price_1SxaEODCpkOb237BiXdCBSfs"
};

export function getTier3FeaturePriceSet(): FeaturePriceSet {
    if (
        process.env.ENVIRONMENT == "prod" &&
        process.env.SANDBOX_MODE !== "true"
    ) {
        return tier3FeaturePriceSet;
    } else {
        return tier3FeaturePriceSetSandbox;
    }
}

export function getFeatureIdByPriceId(priceId: string): LimitId | undefined {
    // Check all feature price sets
    const allPriceSets = [
        getTier1FeaturePriceSet(),
        getTier2FeaturePriceSet(),
        getTier3FeaturePriceSet()
    ];

    for (const priceSet of allPriceSets) {
        const entry = (Object.entries(priceSet) as [LimitId, string][]).find(
            ([_, price]) => price === priceId
        );
        if (entry) {
            return entry[0];
        }
    }

    return undefined;
}
