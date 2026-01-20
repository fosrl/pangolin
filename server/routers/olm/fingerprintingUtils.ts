import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { currentFingerprint, db, fingerprintSnapshots, Olm } from "@server/db";
import { calculateCutoffTimestamp } from "@server/lib/cleanupLogs";
import { desc, eq, lt } from "drizzle-orm";

function fingerprintSnapshotHash(fingerprint: any, postures: any): string {
    const canonical = {
        username: fingerprint.username ?? null,
        hostname: fingerprint.hostname ?? null,
        platform: fingerprint.platform ?? null,
        osVersion: fingerprint.osVersion ?? null,
        kernelVersion: fingerprint.kernelVersion ?? null,
        arch: fingerprint.arch ?? null,
        deviceModel: fingerprint.deviceModel ?? null,
        serialNumber: fingerprint.serialNumber ?? null,
        platformFingerprint: fingerprint.platformFingerprint ?? null,

        biometricsEnabled: postures.biometricsEnabled ?? false,
        diskEncrypted: postures.diskEncrypted ?? false,
        firewallEnabled: postures.firewallEnabled ?? false,
        autoUpdatesEnabled: postures.autoUpdatesEnabled ?? false,
        tpmAvailable: postures.tpmAvailable ?? false,

        windowsDefenderEnabled: postures.windowsDefenderEnabled ?? false,

        macosSipEnabled: postures.macosSipEnabled ?? false,
        macosGatekeeperEnabled: postures.macosGatekeeperEnabled ?? false,
        macosFirewallStealthMode: postures.macosFirewallStealthMode ?? false,

        linuxAppArmorEnabled: postures.linuxAppArmorEnabled ?? false,
        linuxSELinuxEnabled: postures.linuxSELinuxEnabled ?? false
    };

    return encodeHexLowerCase(
        sha256(new TextEncoder().encode(JSON.stringify(canonical)))
    );
}

export async function handleFingerprintInsertion(
    olm: Olm,
    fingerprint: any,
    postures: any
) {
    if (
        !olm?.olmId ||
        !fingerprint ||
        !postures ||
        Object.keys(fingerprint).length === 0 ||
        Object.keys(postures).length === 0
    ) {
        return;
    }

    const now = Math.floor(Date.now() / 1000);
    const hash = fingerprintSnapshotHash(fingerprint, postures);

    const [current] = await db
        .select()
        .from(currentFingerprint)
        .where(eq(currentFingerprint.olmId, olm.olmId))
        .limit(1);

    if (!current) {
        const [inserted] = await db
            .insert(currentFingerprint)
            .values({
                olmId: olm.olmId,
                firstSeen: now,
                lastSeen: now,
                lastCollectedAt: now,

                // fingerprint
                username: fingerprint.username,
                hostname: fingerprint.hostname,
                platform: fingerprint.platform,
                osVersion: fingerprint.osVersion,
                kernelVersion: fingerprint.kernelVersion,
                arch: fingerprint.arch,
                deviceModel: fingerprint.deviceModel,
                serialNumber: fingerprint.serialNumber,
                platformFingerprint: fingerprint.platformFingerprint,

                biometricsEnabled: postures.biometricsEnabled,
                diskEncrypted: postures.diskEncrypted,
                firewallEnabled: postures.firewallEnabled,
                autoUpdatesEnabled: postures.autoUpdatesEnabled,
                tpmAvailable: postures.tpmAvailable,

                windowsDefenderEnabled: postures.windowsDefenderEnabled,

                macosSipEnabled: postures.macosSipEnabled,
                macosGatekeeperEnabled: postures.macosGatekeeperEnabled,
                macosFirewallStealthMode: postures.macosFirewallStealthMode,

                linuxAppArmorEnabled: postures.linuxAppArmorEnabled,
                linuxSELinuxEnabled: postures.linuxSELinuxEnabled
            })
            .returning();

        await db.insert(fingerprintSnapshots).values({
            fingerprintId: inserted.fingerprintId,

            username: fingerprint.username,
            hostname: fingerprint.hostname,
            platform: fingerprint.platform,
            osVersion: fingerprint.osVersion,
            kernelVersion: fingerprint.kernelVersion,
            arch: fingerprint.arch,
            deviceModel: fingerprint.deviceModel,
            serialNumber: fingerprint.serialNumber,
            platformFingerprint: fingerprint.platformFingerprint,

            biometricsEnabled: postures.biometricsEnabled,
            diskEncrypted: postures.diskEncrypted,
            firewallEnabled: postures.firewallEnabled,
            autoUpdatesEnabled: postures.autoUpdatesEnabled,
            tpmAvailable: postures.tpmAvailable,

            windowsDefenderEnabled: postures.windowsDefenderEnabled,

            macosSipEnabled: postures.macosSipEnabled,
            macosGatekeeperEnabled: postures.macosGatekeeperEnabled,
            macosFirewallStealthMode: postures.macosFirewallStealthMode,

            linuxAppArmorEnabled: postures.linuxAppArmorEnabled,
            linuxSELinuxEnabled: postures.linuxSELinuxEnabled,

            hash,
            collectedAt: now
        });

        return;
    }

    const [latestSnapshot] = await db
        .select({ hash: fingerprintSnapshots.hash })
        .from(fingerprintSnapshots)
        .where(eq(fingerprintSnapshots.fingerprintId, current.fingerprintId))
        .orderBy(desc(fingerprintSnapshots.collectedAt))
        .limit(1);

    const changed = !latestSnapshot || latestSnapshot.hash !== hash;

    if (changed) {
        await db.insert(fingerprintSnapshots).values({
            fingerprintId: current.fingerprintId,

            username: fingerprint.username,
            hostname: fingerprint.hostname,
            platform: fingerprint.platform,
            osVersion: fingerprint.osVersion,
            kernelVersion: fingerprint.kernelVersion,
            arch: fingerprint.arch,
            deviceModel: fingerprint.deviceModel,
            serialNumber: fingerprint.serialNumber,
            platformFingerprint: fingerprint.platformFingerprint,

            biometricsEnabled: postures.biometricsEnabled,
            diskEncrypted: postures.diskEncrypted,
            firewallEnabled: postures.firewallEnabled,
            autoUpdatesEnabled: postures.autoUpdatesEnabled,
            tpmAvailable: postures.tpmAvailable,

            windowsDefenderEnabled: postures.windowsDefenderEnabled,

            macosSipEnabled: postures.macosSipEnabled,
            macosGatekeeperEnabled: postures.macosGatekeeperEnabled,
            macosFirewallStealthMode: postures.macosFirewallStealthMode,

            linuxAppArmorEnabled: postures.linuxAppArmorEnabled,
            linuxSELinuxEnabled: postures.linuxSELinuxEnabled,

            hash,
            collectedAt: now
        });

        await db
            .update(currentFingerprint)
            .set({
                lastSeen: now,
                lastCollectedAt: now,

                username: fingerprint.username,
                hostname: fingerprint.hostname,
                platform: fingerprint.platform,
                osVersion: fingerprint.osVersion,
                kernelVersion: fingerprint.kernelVersion,
                arch: fingerprint.arch,
                deviceModel: fingerprint.deviceModel,
                serialNumber: fingerprint.serialNumber,
                platformFingerprint: fingerprint.platformFingerprint,

                biometricsEnabled: postures.biometricsEnabled,
                diskEncrypted: postures.diskEncrypted,
                firewallEnabled: postures.firewallEnabled,
                autoUpdatesEnabled: postures.autoUpdatesEnabled,
                tpmAvailable: postures.tpmAvailable,

                windowsDefenderEnabled: postures.windowsDefenderEnabled,

                macosSipEnabled: postures.macosSipEnabled,
                macosGatekeeperEnabled: postures.macosGatekeeperEnabled,
                macosFirewallStealthMode: postures.macosFirewallStealthMode,

                linuxAppArmorEnabled: postures.linuxAppArmorEnabled,
                linuxSELinuxEnabled: postures.linuxSELinuxEnabled
            })
            .where(eq(currentFingerprint.fingerprintId, current.fingerprintId));
    } else {
        await db
            .update(currentFingerprint)
            .set({ lastSeen: now })
            .where(eq(currentFingerprint.fingerprintId, current.fingerprintId));
    }
}

export async function cleanUpOldFingerprintSnapshots(retentionDays: number) {
    const cutoff = calculateCutoffTimestamp(retentionDays);

    await db
        .delete(fingerprintSnapshots)
        .where(lt(fingerprintSnapshots.collectedAt, cutoff));
}
