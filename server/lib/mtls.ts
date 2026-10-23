import {
    alias,
    db,
    resourceMtlsCertificates,
    resourcePolicies,
    resourcePolicyMtlsCertificates,
    resources,
    type Resource,
    type Transaction
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import {
    and,
    asc,
    count,
    eq,
    inArray,
    sql,
    type AnyColumn,
    type SQL
} from "drizzle-orm";
import createHttpError from "http-errors";
import {
    MAX_MTLS_CERTIFICATES_PER_RESOURCE,
    parseCaCertificates,
    type ParsedCaCertificate
} from "./mtlsCertificate";
import { MTLS_RESOURCE_MODES } from "./mtlsModes";

type DbOrTrx = Transaction | typeof db;

/**
 * Like the other auth methods (pincode, whitelist, ...), mTLS can be set on a
 * resource policy or on the resource itself. The resource-level settings only
 * matter alongside a shared policy; without one the resource's auth lives on
 * its inline (default) policy.
 */
export type MtlsOwner =
    | { type: "resource"; resourceId: number }
    | { type: "policy"; resourcePolicyId: number };

export type MtlsCertificateInfo = {
    mtlsCertificateId: number;
    name: string | null;
    subject: string | null;
    issuer: string | null;
    serialNumber: string | null;
    fingerprint: string | null;
    notBefore: number | null;
    notAfter: number | null;
    createdAt: number;
};

type MtlsCertificateRow = MtlsCertificateInfo & { certificate: string };

/**
 * Where resource-scoped mTLS writes go, mirroring setResourcePincode: the
 * inline policy when no shared policy is assigned, otherwise the resource.
 */
export function getResourceMtlsOwner(
    resource: Pick<
        Resource,
        "resourceId" | "resourcePolicyId" | "defaultResourcePolicyId"
    >
): MtlsOwner {
    if (
        resource.resourcePolicyId === null &&
        resource.defaultResourcePolicyId !== null
    ) {
        return {
            type: "policy",
            resourcePolicyId: resource.defaultResourcePolicyId
        };
    }
    return { type: "resource", resourceId: resource.resourceId };
}

function certificateColumns(
    table:
        typeof resourceMtlsCertificates | typeof resourcePolicyMtlsCertificates
) {
    return {
        mtlsCertificateId: table.mtlsCertificateId,
        name: table.name,
        certificate: table.certificate,
        subject: table.subject,
        issuer: table.issuer,
        serialNumber: table.serialNumber,
        fingerprint: table.fingerprint,
        notBefore: table.notBefore,
        notAfter: table.notAfter,
        createdAt: table.createdAt
    };
}

function toInfo({ certificate: _, ...info }: MtlsCertificateRow) {
    return info;
}

async function selectCertificates(
    owner: MtlsOwner,
    trx: DbOrTrx
): Promise<MtlsCertificateRow[]> {
    if (owner.type === "resource") {
        return trx
            .select(certificateColumns(resourceMtlsCertificates))
            .from(resourceMtlsCertificates)
            .where(eq(resourceMtlsCertificates.resourceId, owner.resourceId))
            .orderBy(asc(resourceMtlsCertificates.mtlsCertificateId));
    }
    return trx
        .select(certificateColumns(resourcePolicyMtlsCertificates))
        .from(resourcePolicyMtlsCertificates)
        .where(
            eq(
                resourcePolicyMtlsCertificates.resourcePolicyId,
                owner.resourcePolicyId
            )
        )
        .orderBy(asc(resourcePolicyMtlsCertificates.mtlsCertificateId));
}

async function insertCertificates(
    owner: MtlsOwner,
    certs: (ParsedCaCertificate & { name: string | null })[],
    trx: DbOrTrx
): Promise<MtlsCertificateInfo[]> {
    if (certs.length === 0) return [];
    const createdAt = Date.now();
    if (owner.type === "resource") {
        const rows = await trx
            .insert(resourceMtlsCertificates)
            .values(
                certs.map((c) => ({
                    ...c,
                    resourceId: owner.resourceId,
                    createdAt
                }))
            )
            .returning(certificateColumns(resourceMtlsCertificates));
        return rows.map(toInfo);
    }
    const rows = await trx
        .insert(resourcePolicyMtlsCertificates)
        .values(
            certs.map((c) => ({
                ...c,
                resourcePolicyId: owner.resourcePolicyId,
                createdAt
            }))
        )
        .returning(certificateColumns(resourcePolicyMtlsCertificates));
    return rows.map(toInfo);
}

/** Deletes the given certificates, or all of the owner's when ids is omitted. */
async function deleteCertificates(
    owner: MtlsOwner,
    mtlsCertificateIds: number[] | undefined,
    trx: DbOrTrx
): Promise<number> {
    if (mtlsCertificateIds?.length === 0) return 0;
    if (owner.type === "resource") {
        const deleted = await trx
            .delete(resourceMtlsCertificates)
            .where(
                and(
                    eq(resourceMtlsCertificates.resourceId, owner.resourceId),
                    mtlsCertificateIds
                        ? inArray(
                              resourceMtlsCertificates.mtlsCertificateId,
                              mtlsCertificateIds
                          )
                        : undefined
                )
            )
            .returning({ id: resourceMtlsCertificates.mtlsCertificateId });
        return deleted.length;
    }
    const deleted = await trx
        .delete(resourcePolicyMtlsCertificates)
        .where(
            and(
                eq(
                    resourcePolicyMtlsCertificates.resourcePolicyId,
                    owner.resourcePolicyId
                ),
                mtlsCertificateIds
                    ? inArray(
                          resourcePolicyMtlsCertificates.mtlsCertificateId,
                          mtlsCertificateIds
                      )
                    : undefined
            )
        )
        .returning({ id: resourcePolicyMtlsCertificates.mtlsCertificateId });
    return deleted.length;
}

export async function listMtlsCertificates(
    owner: MtlsOwner,
    trx: DbOrTrx = db
): Promise<MtlsCertificateInfo[]> {
    const rows = await selectCertificates(owner, trx);
    return rows.map(toInfo);
}

/** PEMs of the owner's trusted CAs, e.g. for blueprint export. */
export async function getMtlsCertificatePems(
    owner: MtlsOwner,
    trx: DbOrTrx = db
): Promise<string[]> {
    const rows = await selectCertificates(owner, trx);
    return rows.map((r) => r.certificate);
}

export async function countMtlsCertificates(
    owner: MtlsOwner,
    trx: DbOrTrx = db
): Promise<number> {
    if (owner.type === "resource") {
        const [{ total }] = await trx
            .select({ total: count() })
            .from(resourceMtlsCertificates)
            .where(eq(resourceMtlsCertificates.resourceId, owner.resourceId));
        return total;
    }
    const [{ total }] = await trx
        .select({ total: count() })
        .from(resourcePolicyMtlsCertificates)
        .where(
            eq(
                resourcePolicyMtlsCertificates.resourcePolicyId,
                owner.resourcePolicyId
            )
        );
    return total;
}

export async function isMtlsEnabled(
    owner: MtlsOwner,
    trx: DbOrTrx = db
): Promise<boolean> {
    if (owner.type === "resource") {
        const [row] = await trx
            .select({ mtlsEnabled: resources.mtlsEnabled })
            .from(resources)
            .where(eq(resources.resourceId, owner.resourceId))
            .limit(1);
        return Boolean(row?.mtlsEnabled);
    }
    const [row] = await trx
        .select({ mtlsEnabled: resourcePolicies.mtlsEnabled })
        .from(resourcePolicies)
        .where(eq(resourcePolicies.resourcePolicyId, owner.resourcePolicyId))
        .limit(1);
    return Boolean(row?.mtlsEnabled);
}

/** Returns true if the stored value changed. */
export async function setMtlsEnabled(
    owner: MtlsOwner,
    enabled: boolean,
    trx: DbOrTrx = db
): Promise<boolean> {
    if (owner.type === "resource") {
        const updated = await trx
            .update(resources)
            .set({ mtlsEnabled: enabled })
            .where(
                and(
                    eq(resources.resourceId, owner.resourceId),
                    eq(resources.mtlsEnabled, !enabled)
                )
            )
            .returning({ id: resources.resourceId });
        return updated.length > 0;
    }
    const updated = await trx
        .update(resourcePolicies)
        .set({ mtlsEnabled: enabled })
        .where(
            and(
                eq(resourcePolicies.resourcePolicyId, owner.resourcePolicyId),
                eq(resourcePolicies.mtlsEnabled, !enabled)
            )
        )
        .returning({ id: resourcePolicies.resourcePolicyId });
    return updated.length > 0;
}

/**
 * Throws a 400 when mTLS is being turned on without a trusted CA, since
 * there would be nothing to verify clients against.
 */
export async function assertCanEnableMtls(
    owner: MtlsOwner,
    trx: DbOrTrx = db
): Promise<void> {
    if ((await countMtlsCertificates(owner, trx)) === 0) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "Add at least one trusted CA certificate before enabling mTLS."
        );
    }
}

/**
 * Adds the certificates in a PEM bundle, skipping ones already present.
 * Throws an HttpError for invalid input, duplicates, or exceeding the limit.
 */
export async function addMtlsCertificates(
    owner: MtlsOwner,
    pem: string,
    name: string | undefined,
    trx: DbOrTrx = db
): Promise<MtlsCertificateInfo[]> {
    let parsedCerts: ParsedCaCertificate[];
    try {
        parsedCerts = parseCaCertificates(pem);
    } catch (e) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            e instanceof Error ? e.message : "Invalid certificate"
        );
    }

    const existing = await selectCertificates(owner, trx);
    const existingFingerprints = new Set(existing.map((c) => c.fingerprint));
    const newCerts = parsedCerts.filter(
        (c) => !existingFingerprints.has(c.fingerprint)
    );

    if (newCerts.length === 0) {
        throw createHttpError(
            HttpCode.CONFLICT,
            parsedCerts.length === 1
                ? "This CA certificate has already been added"
                : "All certificates in this bundle have already been added"
        );
    }

    if (
        existing.length + newCerts.length >
        MAX_MTLS_CERTIFICATES_PER_RESOURCE
    ) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            `At most ${MAX_MTLS_CERTIFICATES_PER_RESOURCE} trusted CA certificates can be added`
        );
    }

    return insertCertificates(
        owner,
        newCerts.map((c) => ({
            ...c,
            // a label only makes sense for a single certificate
            name: newCerts.length === 1 ? (name ?? null) : null
        })),
        trx
    );
}

/**
 * Removes one trusted CA. With no CA left there is nothing to verify clients
 * against, so leaving mTLS "enabled" would either lock everyone out or be
 * silently ignored by the Traefik config builder; it is switched off instead.
 * Returns null when the certificate does not belong to the owner.
 */
export async function removeMtlsCertificate(
    owner: MtlsOwner,
    mtlsCertificateId: number
): Promise<{ mtlsDisabled: boolean } | null> {
    return db.transaction(async (trx) => {
        const removed = await deleteCertificates(
            owner,
            [mtlsCertificateId],
            trx
        );
        if (removed === 0) {
            return null;
        }

        let mtlsDisabled = false;
        if ((await countMtlsCertificates(owner, trx)) === 0) {
            mtlsDisabled = await setMtlsEnabled(owner, false, trx);
        }
        return { mtlsDisabled };
    });
}

/**
 * Makes the owner's trusted CAs exactly the given PEMs (each entry may be a
 * bundle). Used by blueprints, which declare the full desired set.
 */
export async function syncMtlsCertificates(
    owner: MtlsOwner,
    caCertificates: string[],
    trx: Transaction
): Promise<void> {
    // A PEM entry may itself be a bundle; flatten and dedupe by fingerprint.
    const desired = new Map<string, ParsedCaCertificate>();
    for (const pem of caCertificates) {
        for (const cert of parseCaCertificates(pem)) {
            desired.set(cert.fingerprint, cert);
        }
    }

    if (desired.size > MAX_MTLS_CERTIFICATES_PER_RESOURCE) {
        throw new Error(
            `At most ${MAX_MTLS_CERTIFICATES_PER_RESOURCE} trusted CA certificates can be added`
        );
    }

    const existing = await selectCertificates(owner, trx);
    const existingFingerprints = new Set(existing.map((c) => c.fingerprint));

    await insertCertificates(
        owner,
        [...desired.values()]
            .filter((c) => !existingFingerprints.has(c.fingerprint))
            .map((c) => ({ ...c, name: null })),
        trx
    );

    await deleteCertificates(
        owner,
        existing
            .filter((r) => !r.fingerprint || !desired.has(r.fingerprint))
            .map((r) => r.mtlsCertificateId),
        trx
    );
}

/** Turns mTLS off and drops the trusted CAs. */
export async function clearMtls(owner: MtlsOwner, trx: DbOrTrx): Promise<void> {
    await setMtlsEnabled(owner, false, trx);
    await deleteCertificates(owner, undefined, trx);
}

type PolicyMtlsColumns = {
    resourcePolicyId: AnyColumn;
    mtlsEnabled: AnyColumn;
};

/**
 * SQL boolean: whether Traefik enforces mTLS on the resource, mirroring
 * getMtlsCaCertificatesByResource. The shared policy wins over the default
 * (inline) policy; when that policy has mTLS off the resource-level setting
 * applies; either way there must be a trusted CA, SSL and a mode served over
 * HTTP(S). The policies are the caller's joins on resourcePolicyId and
 * defaultResourcePolicyId.
 */
export function effectiveMtlsSql(
    sharedPolicy: PolicyMtlsColumns,
    defaultPolicy: PolicyMtlsColumns
): SQL<boolean> {
    return sql<boolean>`(CASE
        WHEN NOT (${resources.ssl} AND ${inArray(resources.mode, [...MTLS_RESOURCE_MODES])}) THEN false
        WHEN COALESCE(CASE
            WHEN ${sharedPolicy.resourcePolicyId} IS NOT NULL THEN ${sharedPolicy.mtlsEnabled}
            ELSE ${defaultPolicy.mtlsEnabled}
        END, false) THEN EXISTS (
            SELECT 1 FROM ${resourcePolicyMtlsCertificates}
            WHERE ${resourcePolicyMtlsCertificates.resourcePolicyId} = COALESCE(${sharedPolicy.resourcePolicyId}, ${defaultPolicy.resourcePolicyId})
        )
        WHEN ${resources.mtlsEnabled} THEN EXISTS (
            SELECT 1 FROM ${resourceMtlsCertificates}
            WHERE ${resourceMtlsCertificates.resourceId} = ${resources.resourceId}
        )
        ELSE false
    END)`;
}

/** Whether Traefik enforces mTLS on the resource; see effectiveMtlsSql. */
export async function isResourceMtlsEnforced(
    resourceId: number,
    trx: DbOrTrx = db
): Promise<boolean> {
    const sharedPolicy = alias(resourcePolicies, "sharedPolicy");
    const defaultPolicy = alias(resourcePolicies, "defaultPolicy");
    const [row] = await trx
        .select({ mtls: effectiveMtlsSql(sharedPolicy, defaultPolicy) })
        .from(resources)
        .leftJoin(
            sharedPolicy,
            eq(sharedPolicy.resourcePolicyId, resources.resourcePolicyId)
        )
        .leftJoin(
            defaultPolicy,
            eq(
                defaultPolicy.resourcePolicyId,
                resources.defaultResourcePolicyId
            )
        )
        .where(eq(resources.resourceId, resourceId))
        .limit(1);
    return Boolean(row?.mtls);
}
