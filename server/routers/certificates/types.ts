import type { Domain } from "@server/db";

export type GetCertificateResponse = {
    certId: number;
    domain: string;
    domainId: string;
    wildcard: boolean;
    domainType: Domain["type"];
    status: string; // pending, requested, valid, expired, failed
    expiresAt: string | null;
    lastRenewalAttempt: Date | null;
    createdAt: number;
    updatedAt: number;
    errorMessage?: string | null;
    renewalCount: number;
};

export type GetBatchedCertificateResponse = Record<
    string,
    GetCertificateResponse | null
>;
