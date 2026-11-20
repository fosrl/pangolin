export type LicenseSupport = "community" | "email" | "priority";

export type GeneratedLicenseKey = {
    instanceName: string | null;
    licenseKey: string;
    expiresAt: string;
    isValid: boolean;
    createdAt: string;
    tier: string;
    type: string;
    users: number;
    sites: number;
    machines: number;
    // Add-ons and support the key has now (changes that lower them wait for
    // renewal)
    highAvailability: boolean;
    support: LicenseSupport;
    // The Stripe subscription that pays for the key; null for free keys.
    subscription: LicenseKeySubscription | null;
};

export type LicenseKeySubscription = {
    status: string;
    // Set to end (at period end via the dashboard, or on a date via the
    // Stripe portal / Dashboard)
    cancelAtPeriodEnd: boolean;
    // ISO date the subscription renews, or ends when it is set to cancel
    currentPeriodEnd: string;
    // Quantities can be changed from the dashboard (self-hosted Business
    // licenses that are active and not set to cancel)
    editable: boolean;
    // Machine clients that come free with the license
    includedMachineClients: number;
    // What the subscription renews with, when it differs from what the key
    // allows now (a reduction that takes effect at renewal); null otherwise
    renewsWith: LicenseQuantities | null;
};

// What a license can be changed to
export type LicenseQuantities = {
    users: number;
    sites: number;
    machineClients: number;
    highAvailability: boolean;
    support: LicenseSupport;
};

export type PreviewLicenseUpdateResponse = {
    // Charged now for the rest of the current period (cents). Reductions are
    // never credited: they take effect at renewal.
    amountDue: number;
    // ISO renewal date when anything goes down (it applies then); null when
    // nothing goes down
    reductionsApplyAt: string | null;
    // What the license costs per billing period after the change (cents)
    newTotal: number;
    // Billing period of the license; fixed when it was bought
    interval: "year" | "month";
    currency: string;
};

export type UpdateLicenseResponse = GeneratedLicenseKey;

export type ListGeneratedLicenseKeysResponse = GeneratedLicenseKey[];

export type NewLicenseKey = {
    licenseKey: {
        id: number;
        instanceName: string | null;
        instanceId: string;
        licenseKey: string;
        tier: string;
        type: string;
        quantity: number;
        quantity_2: number;
        quantity_3: number;
        isValid: boolean;
        updatedAt: string;
        createdAt: string;
        expiresAt: string;
        orgId: string;
    };
};

export type GenerateNewLicenseResponse = NewLicenseKey;
