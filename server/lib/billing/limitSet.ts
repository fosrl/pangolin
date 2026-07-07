import { LimitId } from "./features";

export type LimitSet = Partial<{
    [key in LimitId]: {
        value: number | null; // null indicates no limit
        description?: string;
    };
}>;

export const freeLimitSet: LimitSet = {
    [LimitId.SITES]: { value: 5, description: "Basic limit" },
    [LimitId.USERS]: { value: 5, description: "Basic limit" },
    [LimitId.DOMAINS]: { value: 5, description: "Basic limit" },
    [LimitId.REMOTE_EXIT_NODES]: { value: 1, description: "Basic limit" },
    [LimitId.ORGANIZATIONS]: { value: 1, description: "Basic limit" },
    [LimitId.PUBLIC_RESOURCES]: { value: 15, description: "Basic limit" },
    [LimitId.PRIVATE_RESOURCES]: { value: 15, description: "Basic limit" },
    [LimitId.MACHINE_CLIENTS]: { value: 5, description: "Basic limit" }
};

export const tier1LimitSet: LimitSet = {
    [LimitId.USERS]: { value: 7, description: "Home limit" },
    [LimitId.SITES]: { value: 10, description: "Home limit" },
    [LimitId.DOMAINS]: { value: 10, description: "Home limit" },
    [LimitId.REMOTE_EXIT_NODES]: { value: 1, description: "Home limit" },
    [LimitId.ORGANIZATIONS]: { value: 1, description: "Home limit" },
    [LimitId.PUBLIC_RESOURCES]: { value: 30, description: "Home limit" },
    [LimitId.PRIVATE_RESOURCES]: { value: 30, description: "Home limit" },
    [LimitId.MACHINE_CLIENTS]: { value: 10, description: "Home limit" }
};

export const tier2LimitSet: LimitSet = {
    [LimitId.USERS]: {
        value: 50,
        description: "Team limit"
    },
    [LimitId.SITES]: {
        value: 50,
        description: "Team limit"
    },
    [LimitId.DOMAINS]: {
        value: 50,
        description: "Team limit"
    },
    [LimitId.REMOTE_EXIT_NODES]: {
        value: 3,
        description: "Team limit"
    },
    [LimitId.ORGANIZATIONS]: {
        value: 1,
        description: "Team limit"
    },
    [LimitId.PUBLIC_RESOURCES]: { value: 150, description: "Team limit" },
    [LimitId.PRIVATE_RESOURCES]: { value: 150, description: "Team limit" },
    [LimitId.MACHINE_CLIENTS]: { value: 25, description: "Team limit" }
};

export const tier3LimitSet: LimitSet = {
    [LimitId.USERS]: {
        value: 250,
        description: "Business limit"
    },
    [LimitId.SITES]: {
        value: 250,
        description: "Business limit"
    },
    [LimitId.DOMAINS]: {
        value: 100,
        description: "Business limit"
    },
    [LimitId.REMOTE_EXIT_NODES]: {
        value: 20,
        description: "Business limit"
    },
    [LimitId.ORGANIZATIONS]: {
        value: 5,
        description: "Business limit"
    },
    [LimitId.PUBLIC_RESOURCES]: { value: 750, description: "Business limit" },
    [LimitId.PRIVATE_RESOURCES]: { value: 750, description: "Business limit" },
    [LimitId.MACHINE_CLIENTS]: { value: 100, description: "Business limit" }
};
