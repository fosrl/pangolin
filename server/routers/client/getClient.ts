import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, idp, idpOidcConfig, olms, users } from "@server/db";
import { clients, currentFingerprint } from "@server/db";
import { and, eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import stoi from "@server/lib/stoi";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { getUserDeviceName } from "@server/db/names";
import { build } from "@server/build";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

const getClientSchema = z.strictObject({
    clientId: z
        .string()
        .optional()
        .transform(stoi)
        .pipe(z.int().positive().optional())
        .optional(),
    niceId: z.string().optional(),
    orgId: z.string().optional()
});

async function query(clientId?: number, niceId?: string, orgId?: string) {
    if (clientId) {
        const [res] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .leftJoin(olms, eq(clients.clientId, olms.clientId))
            .leftJoin(
                currentFingerprint,
                eq(olms.olmId, currentFingerprint.olmId)
            )
            .leftJoin(users, eq(clients.userId, users.userId))
            .limit(1);
        return res;
    } else if (niceId && orgId) {
        const [res] = await db
            .select()
            .from(clients)
            .where(and(eq(clients.niceId, niceId), eq(clients.orgId, orgId)))
            .leftJoin(olms, eq(clients.clientId, olms.clientId))
            .leftJoin(
                currentFingerprint,
                eq(olms.olmId, currentFingerprint.olmId)
            )
            .leftJoin(users, eq(clients.userId, users.userId))
            .limit(1);
        return res;
    }
}

type PostureData = {
    biometricsEnabled?: boolean | null | "-";
    diskEncrypted?: boolean | null | "-";
    firewallEnabled?: boolean | null | "-";
    autoUpdatesEnabled?: boolean | null | "-";
    tpmAvailable?: boolean | null | "-";
    windowsAntivirusEnabled?: boolean | null | "-";
    macosSipEnabled?: boolean | null | "-";
    macosGatekeeperEnabled?: boolean | null | "-";
    macosFirewallStealthMode?: boolean | null | "-";
    linuxAppArmorEnabled?: boolean | null | "-";
    linuxSELinuxEnabled?: boolean | null | "-";
};

function maskPostureDataWithPlaceholder(posture: PostureData): PostureData {
    const masked: PostureData = {};
    for (const key of Object.keys(posture) as (keyof PostureData)[]) {
        if (posture[key] !== undefined && posture[key] !== null) {
            (masked as Record<keyof PostureData, "-">)[key] = "-";
        }
    }
    return masked;
}

function getPlatformPostureData(
    platform: string | null | undefined,
    fingerprint: typeof currentFingerprint.$inferSelect | null
): PostureData | null {
    if (!fingerprint) return null;

    const normalizedPlatform = platform?.toLowerCase() || "unknown";
    const posture: PostureData = {};

    // Windows: Hard drive encryption, Firewall, Auto updates, TPM availability, Windows Antivirus status
    if (normalizedPlatform === "windows") {
        if (
            fingerprint.diskEncrypted !== null &&
            fingerprint.diskEncrypted !== undefined
        ) {
            posture.diskEncrypted = fingerprint.diskEncrypted;
        }
        if (
            fingerprint.firewallEnabled !== null &&
            fingerprint.firewallEnabled !== undefined
        ) {
            posture.firewallEnabled = fingerprint.firewallEnabled;
        }
        if (
            fingerprint.tpmAvailable !== null &&
            fingerprint.tpmAvailable !== undefined
        ) {
            posture.tpmAvailable = fingerprint.tpmAvailable;
        }
        if (
            fingerprint.windowsAntivirusEnabled !== null &&
            fingerprint.windowsAntivirusEnabled !== undefined
        ) {
            posture.windowsAntivirusEnabled =
                fingerprint.windowsAntivirusEnabled;
        }
    }
    // macOS: Hard drive encryption, Biometric configuration, Firewall, System Integrity Protection (SIP), Gatekeeper, Firewall stealth mode
    else if (normalizedPlatform === "macos") {
        if (
            fingerprint.diskEncrypted !== null &&
            fingerprint.diskEncrypted !== undefined
        ) {
            posture.diskEncrypted = fingerprint.diskEncrypted;
        }
        if (
            fingerprint.biometricsEnabled !== null &&
            fingerprint.biometricsEnabled !== undefined
        ) {
            posture.biometricsEnabled = fingerprint.biometricsEnabled;
        }
        if (
            fingerprint.firewallEnabled !== null &&
            fingerprint.firewallEnabled !== undefined
        ) {
            posture.firewallEnabled = fingerprint.firewallEnabled;
        }
        if (
            fingerprint.macosSipEnabled !== null &&
            fingerprint.macosSipEnabled !== undefined
        ) {
            posture.macosSipEnabled = fingerprint.macosSipEnabled;
        }
        if (
            fingerprint.macosGatekeeperEnabled !== null &&
            fingerprint.macosGatekeeperEnabled !== undefined
        ) {
            posture.macosGatekeeperEnabled = fingerprint.macosGatekeeperEnabled;
        }
        if (
            fingerprint.macosFirewallStealthMode !== null &&
            fingerprint.macosFirewallStealthMode !== undefined
        ) {
            posture.macosFirewallStealthMode =
                fingerprint.macosFirewallStealthMode;
        }
        if (
            fingerprint.autoUpdatesEnabled !== null &&
            fingerprint.autoUpdatesEnabled !== undefined
        ) {
            posture.autoUpdatesEnabled = fingerprint.autoUpdatesEnabled;
        }
    }
    // Linux: Hard drive encryption, Firewall, AppArmor, SELinux, TPM availability
    else if (normalizedPlatform === "linux") {
        if (
            fingerprint.diskEncrypted !== null &&
            fingerprint.diskEncrypted !== undefined
        ) {
            posture.diskEncrypted = fingerprint.diskEncrypted;
        }
        if (
            fingerprint.firewallEnabled !== null &&
            fingerprint.firewallEnabled !== undefined
        ) {
            posture.firewallEnabled = fingerprint.firewallEnabled;
        }
        if (
            fingerprint.linuxAppArmorEnabled !== null &&
            fingerprint.linuxAppArmorEnabled !== undefined
        ) {
            posture.linuxAppArmorEnabled = fingerprint.linuxAppArmorEnabled;
        }
        if (
            fingerprint.linuxSELinuxEnabled !== null &&
            fingerprint.linuxSELinuxEnabled !== undefined
        ) {
            posture.linuxSELinuxEnabled = fingerprint.linuxSELinuxEnabled;
        }
        if (
            fingerprint.tpmAvailable !== null &&
            fingerprint.tpmAvailable !== undefined
        ) {
            posture.tpmAvailable = fingerprint.tpmAvailable;
        }
    }
    // iOS: Biometric configuration
    else if (normalizedPlatform === "ios") {
        // none supported yet
    }
    // Android: Screen lock, Biometric configuration, Hard drive encryption
    else if (normalizedPlatform === "android") {
        if (
            fingerprint.diskEncrypted !== null &&
            fingerprint.diskEncrypted !== undefined
        ) {
            posture.diskEncrypted = fingerprint.diskEncrypted;
        }
    }

    // Only return if we have at least one posture field
    return Object.keys(posture).length > 0 ? posture : null;
}

export type GetClientResponse = NonNullable<
    Awaited<ReturnType<typeof query>>
>["clients"] & {
    olmId: string | null;
    agent: string | null;
    olmVersion: string | null;
    userEmail: string | null;
    userName: string | null;
    userUsername: string | null;
    fingerprint: {
        username: string | null;
        hostname: string | null;
        platform: string | null;
        osVersion: string | null;
        kernelVersion: string | null;
        arch: string | null;
        deviceModel: string | null;
        serialNumber: string | null;
        firstSeen: number | null;
        lastSeen: number | null;
    } | null;
    posture: PostureData | null;
    userType: string | null;
    idpName: string | null;
    idpVariant: string | null;
};

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/client/{niceId}",
    description:
        "Get a client by orgId and niceId. NiceId is a readable ID for the site and unique on a per org basis.",
    tags: [OpenAPITags.Client],
    request: {
        params: z.object({
            orgId: z.string(),
            niceId: z.string()
        })
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

registry.registerPath({
    method: "get",
    path: "/client/{clientId}",
    description: "Get a client by its client ID.",
    tags: [OpenAPITags.Client],
    request: {
        params: z.object({
            clientId: z.number()
        })
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

export async function getClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getClientSchema.safeParse(req.params);
        if (!parsedParams.success) {
            logger.error(
                `Error parsing params: ${fromError(parsedParams.error).toString()}`
            );
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { clientId, niceId, orgId } = parsedParams.data;

        const client = await query(clientId, niceId, orgId);

        if (!client) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Client not found")
            );
        }

        const isUserDevice = client.user !== null && client.user !== undefined;

        // Replace name with device name if OLM exists
        let clientName = client.clients.name;
        if (client.olms && isUserDevice) {
            const model = client.currentFingerprint?.deviceModel || null;
            clientName = getUserDeviceName(model, client.clients.name);
        }

        // Build fingerprint data if available
        const fingerprintData = client.currentFingerprint
            ? {
                  username: client.currentFingerprint.username || null,
                  hostname: client.currentFingerprint.hostname || null,
                  platform: client.currentFingerprint.platform || null,
                  osVersion: client.currentFingerprint.osVersion || null,
                  kernelVersion:
                      client.currentFingerprint.kernelVersion || null,
                  arch: client.currentFingerprint.arch || null,
                  deviceModel: client.currentFingerprint.deviceModel || null,
                  serialNumber: client.currentFingerprint.serialNumber || null,
                  firstSeen: client.currentFingerprint.firstSeen || null,
                  lastSeen: client.currentFingerprint.lastSeen || null
              }
            : null;

        // Build posture data if available (platform-specific)
        // Licensed: real values; not licensed: same keys but values set to "-"
        const rawPosture = getPlatformPostureData(
            client.currentFingerprint?.platform || null,
            client.currentFingerprint
        );
        const isOrgLicensed = await isLicensedOrSubscribed(
            client.clients.orgId,
            tierMatrix.devicePosture
        );
        const postureData: PostureData | null = rawPosture
            ? isOrgLicensed
                ? rawPosture
                : maskPostureDataWithPlaceholder(rawPosture)
            : null;

        let userType: string | null = null;
        let idpName: string | null = null;
        let idpVariant: string | null = null;

        if (client.clients.userId) {
            const [idpRow] = await db
                .select({
                    userType: users.type,
                    idpName: idp.name,
                    idpVariant: idpOidcConfig.variant
                })
                .from(users)
                .leftJoin(idp, eq(users.idpId, idp.idpId))
                .leftJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
                .where(eq(users.userId, client.clients.userId))
                .limit(1);

            if (idpRow) {
                userType = idpRow.userType;
                idpName = idpRow.idpName;
                idpVariant = idpRow.idpVariant;
            }
        }

        const data: GetClientResponse = {
            ...client.clients,
            name: clientName,
            olmId: client.olms ? client.olms.olmId : null,
            agent: client.olms?.agent || null,
            olmVersion: client.olms?.version || null,
            userEmail: client.user?.email ?? null,
            userName: client.user?.name ?? null,
            userUsername: client.user?.username ?? null,
            fingerprint: fingerprintData,
            posture: postureData,
            userType,
            idpName,
            idpVariant
        };

        return response<GetClientResponse>(res, {
            data,
            success: true,
            error: false,
            message: "Client retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
