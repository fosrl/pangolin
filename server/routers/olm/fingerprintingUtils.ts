import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { currentFingerprint, db, fingerprintSnapshots, Olm } from "@server/db";
import { desc, eq } from "drizzle-orm";

function fingerprintHash(fp: any): string {
    const canonical = {
        username: fp.username ?? null,
        hostname: fp.hostname ?? null,
        platform: fp.platform ?? null,
        osVersion: fp.osVersion ?? null,
        kernelVersion: fp.kernelVersion ?? null,
        arch: fp.arch ?? null,
        deviceModel: fp.deviceModel ?? null,
        serialNumber: fp.serialNumber ?? null,
        platformFingerprint: fp.platformFingerprint ?? null
    };

    return encodeHexLowerCase(
        sha256(new TextEncoder().encode(JSON.stringify(canonical)))
    );
}

export async function handleFingerprintInsertion(olm: Olm, fingerprint: any) {
    if (!fingerprint || !olm.olmId || Object.keys(fingerprint).length < 1) {
        return;
    }

    const hash = fingerprintHash(fingerprint);

    const now = Math.floor(Date.now() / 1000);

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

                username: fingerprint.username,
                hostname: fingerprint.hostname,
                platform: fingerprint.platform,
                osVersion: fingerprint.osVersion,
                kernelVersion: fingerprint.kernelVersion,
                arch: fingerprint.arch,
                deviceModel: fingerprint.deviceModel,
                serialNumber: fingerprint.serialNumber,
                platformFingerprint: fingerprint.platformFingerprint
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

            hash,
            collectedAt: now
        });

        return;
    }

    // Get most recent snapshot hash
    const [latestSnapshot] = await db
        .select({ hash: fingerprintSnapshots.hash })
        .from(fingerprintSnapshots)
        .where(eq(fingerprintSnapshots.fingerprintId, current.fingerprintId))
        .orderBy(desc(fingerprintSnapshots.collectedAt))
        .limit(1);

    const changed = !latestSnapshot || latestSnapshot.hash !== hash;

    if (changed) {
        // Insert snapshot if it has changed
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

            hash,
            collectedAt: now
        });

        // Update current fingerprint fully
        await db
            .update(currentFingerprint)
            .set({
                lastSeen: now,

                username: fingerprint.username,
                hostname: fingerprint.hostname,
                platform: fingerprint.platform,
                osVersion: fingerprint.osVersion,
                kernelVersion: fingerprint.kernelVersion,
                arch: fingerprint.arch,
                deviceModel: fingerprint.deviceModel,
                serialNumber: fingerprint.serialNumber,
                platformFingerprint: fingerprint.platformFingerprint
            })
            .where(eq(currentFingerprint.fingerprintId, current.fingerprintId));
    } else {
        // No change, so only bump lastSeen
        await db
            .update(currentFingerprint)
            .set({ lastSeen: now })
            .where(eq(currentFingerprint.fingerprintId, current.fingerprintId));
    }
}
