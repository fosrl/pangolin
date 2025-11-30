import { db, hostMeta, HostMeta } from "@server/db";
import { setHostMeta } from "@server/lib/hostMeta";

const keyTypes = ["host"] as const;
export type LicenseKeyType = (typeof keyTypes)[number];

const keyTiers = ["personal", "enterprise"] as const;
export type LicenseKeyTier = (typeof keyTiers)[number];

export type LicenseStatus = {
    isHostLicensed: boolean; // Are there any license keys?
    isLicenseValid: boolean; // Is the license key valid?
    hostId: string; // Host ID
    tier?: LicenseKeyTier;
};

export type LicenseKeyCache = {
    licenseKey: string;
    licenseKeyEncrypted: string;
    valid: boolean;
    iat?: Date;
    type?: LicenseKeyType;
    tier?: LicenseKeyTier;
    terminateAt?: Date;
};

export class License {
    private serverSecret!: string;

    constructor(private hostMeta: HostMeta) {}

    public async check(): Promise<LicenseStatus> {
        return {
            hostId: this.hostMeta.hostMetaId,
            isHostLicensed: false,
            isLicenseValid: false
        };
    }

    public setServerSecret(secret: string) {
        this.serverSecret = secret;
    }

    public async isUnlocked() {
        return false;
    }
}

await setHostMeta();

const [info] = await db.select().from(hostMeta).limit(1);

if (!info) {
    throw new Error("Host information not found");
}

export const license = new License(info);

export default license;
