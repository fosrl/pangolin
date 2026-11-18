import {
    alias,
    db,
    resourceMtlsCertificates,
    resourcePolicies,
    resourcePolicyMtlsCertificates,
    resources
} from "@server/db";
import { eq, inArray } from "drizzle-orm";

/**
 * Trusted client-CA PEMs for each resource that requires mTLS, keyed by
 * resourceId. Resolved like the other auth methods in getResourceByDomain:
 * the assigned shared policy wins, otherwise the resource's default (inline)
 * policy; when that policy has mTLS off, the resource-level setting applies.
 * Resources whose effective mTLS has no CA certificates are left out.
 */
export async function getMtlsCaCertificatesByResource(
    resourceIds: number[]
): Promise<Map<number, string[]>> {
    const byResource = new Map<number, string[]>();
    const uniqueResourceIds = [...new Set(resourceIds)];
    if (uniqueResourceIds.length === 0) {
        return byResource;
    }

    const sharedPolicy = alias(resourcePolicies, "sharedPolicy");
    const defaultPolicy = alias(resourcePolicies, "defaultPolicy");

    const rows = await db
        .select({
            resourceId: resources.resourceId,
            resourceMtlsEnabled: resources.mtlsEnabled,
            sharedPolicyId: sharedPolicy.resourcePolicyId,
            sharedPolicyMtlsEnabled: sharedPolicy.mtlsEnabled,
            defaultPolicyId: defaultPolicy.resourcePolicyId,
            defaultPolicyMtlsEnabled: defaultPolicy.mtlsEnabled
        })
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
        .where(inArray(resources.resourceId, uniqueResourceIds));

    const resourcesByPolicy = new Map<number, number[]>();
    const resourceLevelIds: number[] = [];

    for (const row of rows) {
        // If a shared policy is assigned, use only its values and do not
        // fall back to the default policy.
        const hasSharedPolicy = row.sharedPolicyId !== null;
        const policyId = hasSharedPolicy
            ? row.sharedPolicyId
            : row.defaultPolicyId;
        const policyMtlsEnabled = hasSharedPolicy
            ? row.sharedPolicyMtlsEnabled
            : row.defaultPolicyMtlsEnabled;

        if (policyId !== null && policyMtlsEnabled) {
            const list = resourcesByPolicy.get(policyId) ?? [];
            list.push(row.resourceId);
            resourcesByPolicy.set(policyId, list);
        } else if (row.resourceMtlsEnabled) {
            resourceLevelIds.push(row.resourceId);
        }
    }

    const [policyCerts, resourceCerts] = await Promise.all([
        resourcesByPolicy.size > 0
            ? db
                  .select({
                      resourcePolicyId:
                          resourcePolicyMtlsCertificates.resourcePolicyId,
                      certificate: resourcePolicyMtlsCertificates.certificate
                  })
                  .from(resourcePolicyMtlsCertificates)
                  .where(
                      inArray(resourcePolicyMtlsCertificates.resourcePolicyId, [
                          ...resourcesByPolicy.keys()
                      ])
                  )
                  .orderBy(resourcePolicyMtlsCertificates.mtlsCertificateId)
            : [],
        resourceLevelIds.length > 0
            ? db
                  .select({
                      resourceId: resourceMtlsCertificates.resourceId,
                      certificate: resourceMtlsCertificates.certificate
                  })
                  .from(resourceMtlsCertificates)
                  .where(
                      inArray(
                          resourceMtlsCertificates.resourceId,
                          resourceLevelIds
                      )
                  )
                  .orderBy(resourceMtlsCertificates.mtlsCertificateId)
            : []
    ]);

    const append = (resourceId: number, certificate: string) => {
        const list = byResource.get(resourceId) ?? [];
        list.push(certificate);
        byResource.set(resourceId, list);
    };

    for (const row of policyCerts) {
        for (const resourceId of resourcesByPolicy.get(row.resourcePolicyId) ??
            []) {
            append(resourceId, row.certificate);
        }
    }
    for (const row of resourceCerts) {
        append(row.resourceId, row.certificate);
    }

    return byResource;
}

/**
 * Adds the TLS options and client-cert headers middleware that enforce mTLS
 * for a resource and returns the TLS options name for its routers, or
 * undefined when the resource does not require mTLS.
 *
 * Traefik resolves TLS options per hostname, and routers on the same host
 * that reference different options make it fall back to the defaults, so the
 * options are keyed on the resource (not the per-path router key) and every
 * TLS router of the resource must reference the same name.
 */
export function applyMtlsConfig(
    config_output: any,
    resourceId: number,
    caCerts: string[] | undefined,
    routerMiddlewares: string[]
): string | undefined {
    if (!caCerts || caCerts.length === 0) {
        return undefined;
    }

    const mtlsOptionsName = `resource-${resourceId}-mtls`;
    const mtlsHeadersMiddlewareName = `resource-${resourceId}-mtls-headers`;

    if (!config_output.tls) {
        config_output.tls = {};
    }
    if (!config_output.tls.options) {
        config_output.tls.options = {};
    }
    // caFiles entries are Traefik FileOrContent values: anything that isn't
    // an existing file path is read as inline PEM, so the CA certs travel in
    // this config to any exit node.
    config_output.tls.options[mtlsOptionsName] = {
        clientAuth: {
            caFiles: caCerts,
            clientAuthType: "RequireAndVerifyClientCert"
        }
    };

    if (!config_output.http.middlewares) {
        config_output.http.middlewares = {};
    }
    config_output.http.middlewares[mtlsHeadersMiddlewareName] = {
        passTLSClientCert: {
            pem: false,
            info: {
                notAfter: true,
                notBefore: true,
                serialNumber: true,
                sans: true,
                subject: {
                    commonName: true,
                    organization: true
                },
                issuer: {
                    commonName: true,
                    organization: true
                }
            }
        }
    };
    routerMiddlewares.unshift(mtlsHeadersMiddlewareName);

    return mtlsOptionsName;
}
