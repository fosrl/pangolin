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
};

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
