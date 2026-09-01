/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { db, HostMeta, sites, users } from "@server/db";
import { hostMeta, licenseKey } from "@server/db";
import logger from "@server/logger";
import NodeCache from "node-cache";
import { validateJWT } from "./licenseJwt";
import { count, eq } from "drizzle-orm";
import moment from "moment";
import { encrypt, decrypt } from "@server/lib/crypto";
import {
    LicenseKeyCache,
    LicenseKeyTier,
    LicenseKeyType,
    LicenseStatus
} from "@server/license/license";
import { setHostMeta } from "@server/lib/hostMeta";

type ActivateLicenseKeyAPIResponse = {
    data: {
        instanceId: string;
    };
    success: boolean;
    error: string;
    message: string;
    status: number;
};

type ValidateLicenseAPIResponse = {
    data: {
        licenseKeys: {
            [key: string]: string;
        };
    };
    success: boolean;
    error: string;
    message: string;
    status: number;
};

type TokenPayload = {
    valid: boolean;
    type: LicenseKeyType;
    tier: LicenseKeyTier;
    quantity: number;
    quantity_2: number;
    terminateAt: string; // ISO
    iat: number; // Issued at
};

export class License {
    private phoneHomeInterval = 6 * 60 * 60; // 6 hours = 6 * 60 * 60 = 21600 seconds
    private serverBaseUrl = "https://api.fossorial.io";
    private validationServerUrl = `${this.serverBaseUrl}/api/v1/license/enterprise/validate`;
    private activationServerUrl = `${this.serverBaseUrl}/api/v1/license/enterprise/activate`;

    private statusCache = new NodeCache();
    private licenseKeyCache = new NodeCache();

    private statusKey = "status";
    private serverSecret!: string;
    private phoneHomeFailureCount = 0;
    private checkInProgress = false;
    private doRecheck = false;

    private publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx9RKc8cw+G8r7h/xeozF
FNkRDggQfYO6Ae+EWHGujZ9WYAZ10spLh9F/zoLhhr3XhsjpoRXwMfgNuO5HstWf
CYM20I0l7EUUMWEyWd4tZLd+5XQ4jY5xWOCWyFJAGQSp7flcRmxdfde+l+xg9eKl
apbY84aVp09/GqM96hCS+CsQZrhohu/aOqYVB/eAhF01qsbmiZ7Y3WtdhTldveYt
h4mZWGmjf8d/aEgePf/tk1gp0BUxf+Ae5yqoAqU+6aiFbjJ7q1kgxc18PWFGfE9y
zSk+OZk887N5ThQ52154+oOUCMMR2Y3t5OH1hVZod51vuY2u5LsQXsf+87PwB91y
LQIDAQAB
-----END PUBLIC KEY-----`;

    constructor(private hostMeta: HostMeta) {
        setInterval(async () => {
            this.doRecheck = true;
            await this.check();
            this.doRecheck = false;
        }, 1000 * this.phoneHomeInterval);
    }

    public listKeys(): LicenseKeyCache[] {
        const keys = this.licenseKeyCache.keys();
        return keys.map((key) => {
            return this.licenseKeyCache.get<LicenseKeyCache>(key)!;
        });
    }

    public setServerSecret(secret: string) {
        this.serverSecret = secret;
    }

    public async forceRecheck() {
        this.phoneHomeFailureCount = 0;

        // Force a fresh check without discarding the last known good cache
        // up front — check() only replaces the cache once it has a fresh
        // result, so a failed recheck (e.g. a transient server error) won't
        // leave listKeys()/status looking empty in the meantime.
        this.doRecheck = true;
        try {
            return await this.check();
        } finally {
            this.doRecheck = false;
        }
    }

    public async isUnlocked(): Promise<boolean> {
        const status = await this.check();
        if (status.isHostLicensed) {
            if (status.isLicenseValid) {
                return true;
            }
        }
        return false;
    }

    public async check(): Promise<LicenseStatus> {
        // If a check is already in progress, return the last known status
        if (this.checkInProgress) {
            logger.debug(
                "License check already in progress, returning last known status"
            );
            const lastStatus = this.statusCache.get(this.statusKey) as
                | LicenseStatus
                | undefined;
            if (lastStatus) {
                return lastStatus;
            }
            // If no cached status exists, return default status
            return {
                hostId: this.hostMeta.hostMetaId,
                isHostLicensed: true,
                isLicenseValid: false
            };
        }

        // Count used sites and users for license comparison
        const [siteCountRes] = await db.select({ value: count() }).from(sites);
        const [userCountRes] = await db.select({ value: count() }).from(users);

        const status: LicenseStatus = {
            hostId: this.hostMeta.hostMetaId,
            isHostLicensed: true,
            isLicenseValid: false,
            usedSites: siteCountRes?.value ?? 0,
            usedUsers: userCountRes?.value ?? 0
        };

        this.checkInProgress = true;

        try {
            if (!this.doRecheck && this.statusCache.has(this.statusKey)) {
                const res = this.statusCache.get("status") as LicenseStatus;
                res.usedSites = status.usedSites;
                res.usedUsers = status.usedUsers;
                return res;
            }
            logger.debug("Checking license status...");
            // Build new cache in temporary Map before invalidating old cache
            const newCache = new Map<string, LicenseKeyCache>();

            const allKeysRes = await db.select().from(licenseKey);

            if (allKeysRes.length === 0) {
                status.isHostLicensed = false;
                // Invalidate all and set new cache (empty)
                this.licenseKeyCache.flushAll();
                this.statusCache.set(this.statusKey, status);
                return status;
            }

            let foundHostKey = false;
            // Keys that fully decrypted, to phone home with. A row that
            // fails to decrypt (e.g. stored under a different server
            // secret) is marked invalid below but excluded here, so it
            // can't take down validation for every other key in the batch.
            const keys: { licenseKey: string; instanceId: string }[] = [];
            // Validate stored license keys
            for (const key of allKeysRes) {
                try {
                    // Decrypt the license key, token, and instance ID
                    const decryptedKey = decrypt(
                        key.licenseKeyId,
                        this.serverSecret
                    );
                    const decryptedToken = decrypt(
                        key.token,
                        this.serverSecret
                    );
                    const decryptedInstanceId = decrypt(
                        key.instanceId,
                        this.serverSecret
                    );

                    const payload = validateJWT<TokenPayload>(
                        decryptedToken,
                        this.publicKey
                    );

                    newCache.set(decryptedKey, {
                        licenseKey: decryptedKey,
                        licenseKeyEncrypted: key.licenseKeyId,
                        valid: payload.valid,
                        type: payload.type,
                        tier: payload.tier,
                        iat: new Date(payload.iat * 1000),
                        terminateAt: new Date(payload.terminateAt),
                        quantity: payload.quantity,
                        quantity_2: payload.quantity_2
                    });

                    if (payload.type === "host") {
                        foundHostKey = true;
                    }

                    keys.push({
                        licenseKey: decryptedKey,
                        instanceId: decryptedInstanceId
                    });
                } catch (e) {
                    logger.error(
                        `Error validating license key: ${key.licenseKeyId}`
                    );
                    logger.error(e);

                    newCache.set(key.licenseKeyId, {
                        licenseKey: key.licenseKeyId,
                        licenseKeyEncrypted: key.licenseKeyId,
                        valid: false
                    });
                }
            }

            if (!foundHostKey && allKeysRes.length) {
                logger.debug("No host license key found");
                status.isHostLicensed = false;
            }

            let apiResponse: ValidateLicenseAPIResponse | undefined;
            if (keys.length > 0) {
                try {
                    // Phone home to validate license keys
                    apiResponse = await this.phoneHome(keys, false);

                    if (!apiResponse?.success) {
                        throw new Error(apiResponse?.error);
                    }
                    // Reset failure count on success
                    this.phoneHomeFailureCount = 0;
                } catch (e) {
                    this.phoneHomeFailureCount++;
                    if (this.phoneHomeFailureCount === 1) {
                        // First failure: fail silently
                        logger.error(
                            "Error communicating with license server:"
                        );
                        logger.error(e);
                        logger.error(
                            `Allowing failure. Will retry one more time at next run interval.`
                        );
                        // Fall back to last known good status if we have
                        // one cached; otherwise return the freshly built
                        // status (with defaults) rather than undefined.
                        const lastKnownStatus = this.statusCache.get(
                            this.statusKey
                        ) as LicenseStatus | undefined;
                        return lastKnownStatus ?? status;
                    } else {
                        // Subsequent failures: fail abruptly
                        throw e;
                    }
                }
            }

            // Check and update all license keys with server response
            for (const key of keys) {
                try {
                    const cached = newCache.get(key.licenseKey)!;
                    const licenseKeyRes =
                        apiResponse?.data?.licenseKeys[key.licenseKey];

                    if (!apiResponse || !licenseKeyRes) {
                        logger.debug(
                            `No response from server for license key: ${key.licenseKey}`
                        );
                        if (cached.iat) {
                            const exp = moment(cached.iat)
                                .add(7, "days")
                                .toDate();
                            if (exp > new Date()) {
                                logger.debug(
                                    `Using cached license key: ${key.licenseKey}, valid ${cached.valid}`
                                );
                                continue;
                            }
                        }

                        logger.debug(
                            `Can't trust license key: ${key.licenseKey}`
                        );
                        cached.valid = false;
                        newCache.set(key.licenseKey, cached);
                        continue;
                    }

                    const payload = validateJWT<TokenPayload>(
                        licenseKeyRes,
                        this.publicKey
                    );
                    cached.valid = payload.valid;
                    cached.type = payload.type;
                    cached.tier = payload.tier;
                    cached.iat = new Date(payload.iat * 1000);
                    cached.terminateAt = new Date(payload.terminateAt);
                    cached.quantity = payload.quantity;
                    cached.quantity_2 = payload.quantity_2;

                    // Encrypt the updated token before storing
                    const encryptedKey = encrypt(
                        key.licenseKey,
                        this.serverSecret
                    );
                    const encryptedToken = encrypt(
                        licenseKeyRes,
                        this.serverSecret
                    );

                    await db
                        .update(licenseKey)
                        .set({
                            token: encryptedToken
                        })
                        .where(eq(licenseKey.licenseKeyId, encryptedKey));

                    newCache.set(key.licenseKey, cached);
                } catch (e) {
                    logger.error(`Error validating license key: ${key}`);
                    logger.error(e);
                }
            }

            // Compute host status: quantity = users, quantity_2 = sites
            for (const key of keys) {
                const cached = newCache.get(key.licenseKey)!;

                if (cached.type === "host") {
                    status.isLicenseValid = cached.valid;
                    status.tier = cached.tier;
                }

                if (!cached.valid) {
                    continue;
                }

                // Only consider quantity if defined and >= 0 (quantity = users, quantity_2 = sites)
                if (cached.quantity_2 !== undefined && cached.quantity_2 >= 0) {
                    status.maxSites =
                        (status.maxSites ?? 0) + cached.quantity_2;
                }
                if (cached.quantity !== undefined && cached.quantity >= 0) {
                    status.maxUsers = (status.maxUsers ?? 0) + cached.quantity;
                }
            }

            // Invalidate license if over user or site limits
            if (
                (status.maxSites !== undefined &&
                    (status.usedSites ?? 0) > status.maxSites) ||
                (status.maxUsers !== undefined &&
                    (status.usedUsers ?? 0) > status.maxUsers)
            ) {
                status.isLicenseValid = false;
            }

            // Invalidate old cache and set new cache
            this.licenseKeyCache.flushAll();
            for (const [key, value] of newCache.entries()) {
                this.licenseKeyCache.set<LicenseKeyCache>(key, value);
            }
        } catch (error) {
            logger.error("Error checking license status:");
            logger.error(error);
        } finally {
            this.checkInProgress = false;
        }

        this.statusCache.set(this.statusKey, status);
        return status;
    }

    public async activateLicenseKey(key: string) {
        // Encrypt the license key before storing
        const encryptedKey = encrypt(key, this.serverSecret);

        const [existingKey] = await db
            .select()
            .from(licenseKey)
            .where(eq(licenseKey.licenseKeyId, encryptedKey))
            .limit(1);

        if (existingKey) {
            throw new Error("License key already exists");
        }

        let instanceId: string | undefined;
        try {
            // Call activate
            const apiResponse = await fetch(this.activationServerUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    licenseKey: key,
                    instanceName: this.hostMeta.hostMetaId
                })
            });

            const data = await apiResponse.json();

            if (!data.success) {
                throw new Error(`${data.message || data.error}`);
            }

            const response = data as ActivateLicenseKeyAPIResponse;

            if (!response.data) {
                throw new Error("No response from server");
            }

            if (!response.data.instanceId) {
                throw new Error("No instance ID in response");
            }

            logger.debug("Activated license key, instance ID:", {
                instanceId: response.data.instanceId
            });

            instanceId = response.data.instanceId;
        } catch (error) {
            throw Error(`Error activating license key: ${error}`);
        }

        // Phone home to validate license key
        const keys = [
            {
                licenseKey: key,
                instanceId: instanceId!
            }
        ];

        let validateResponse: ValidateLicenseAPIResponse;
        try {
            validateResponse = await this.phoneHome(keys, false);

            if (!validateResponse) {
                throw new Error("No response from server");
            }

            if (!validateResponse.success) {
                throw new Error(validateResponse.error);
            }

            // Validate the license key
            const licenseKeyRes = validateResponse.data.licenseKeys[key];
            if (!licenseKeyRes) {
                throw new Error("Invalid license key");
            }

            const payload = validateJWT<TokenPayload>(
                licenseKeyRes,
                this.publicKey
            );

            if (!payload.valid) {
                throw new Error("Invalid license key");
            }

            const encryptedToken = encrypt(licenseKeyRes, this.serverSecret);
            // Encrypt the instanceId before storing
            const encryptedInstanceId = encrypt(instanceId!, this.serverSecret);

            // Store the license key in the database
            await db.insert(licenseKey).values({
                licenseKeyId: encryptedKey,
                token: encryptedToken,
                instanceId: encryptedInstanceId
            });
        } catch (error) {
            throw Error(`Error validating license key: ${error}`);
        }

        // Invalidate the cache and re-compute the status
        return await this.forceRecheck();
    }

    private async phoneHome(
        keys: {
            licenseKey: string;
            instanceId: string;
        }[],
        doDecrypt = true
    ): Promise<ValidateLicenseAPIResponse> {
        // Decrypt the instanceIds before sending to the server
        const decryptedKeys = keys.map((key) => ({
            licenseKey: key.licenseKey,
            instanceId:
                key.instanceId && doDecrypt
                    ? decrypt(key.instanceId, this.serverSecret)
                    : key.instanceId
        }));

        const maxAttempts = 10;
        const initialRetryDelay = 1 * 1000; // 1 seconds
        const exponentialFactor = 1.2;

        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await fetch(this.validationServerUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        licenseKeys: decryptedKeys,
                        instanceName: this.hostMeta.hostMetaId
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                return data as ValidateLicenseAPIResponse;
            } catch (error) {
                lastError =
                    error instanceof Error ? error : new Error(String(error));

                if (attempt < maxAttempts) {
                    // Calculate exponential backoff delay
                    const retryDelay = Math.floor(
                        initialRetryDelay *
                            Math.pow(exponentialFactor, attempt - 1)
                    );

                    logger.debug(
                        `License validation request failed (attempt ${attempt}/${maxAttempts}), retrying in ${retryDelay} ms...`
                    );
                    await new Promise((resolve) =>
                        setTimeout(resolve, retryDelay)
                    );
                } else {
                    logger.error(
                        `License validation request failed after ${maxAttempts} attempts`
                    );
                    throw lastError;
                }
            }
        }

        throw lastError || new Error("License validation request failed");
    }
}

await setHostMeta();

const [info] = await db.select().from(hostMeta).limit(1);

if (!info) {
    throw new Error("Host information not found");
}

export const license = new License(info);

export default license;
