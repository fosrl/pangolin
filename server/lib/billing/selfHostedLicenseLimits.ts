// What the dashboard lets a buyer change a self-hosted Business license to.
// Mirrors SELF_HOSTED_CALCULATOR in landing-v5/lib/marketing/content/pricing.ts:
// the same minimums and maximums (larger deployments get a custom quote), and
// the yearly price for adding a machine clients line to a subscription that
// has none. Existing lines keep the price they were bought at.
//
// Loaded by both the server and the dashboard.
export const SELF_HOSTED_LIMITS = {
    users: { min: 25, max: 250 },
    sites: { min: 25, max: 500 },
    machineClients: { min: 25, max: 500 },
    perMachineClientUsd: 6,
    // Email and priority support need more users than this
    supportAboveUsers: 25
} as const;
