import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, resourceMtlsCertificates, resources } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import {
    MAX_MTLS_CERTIFICATES_PER_RESOURCE,
    parseCaCertificates
} from "@server/lib/mtlsCertificate";

const createResourceMtlsCertificateParamsSchema = z.strictObject({
    resourceId: z.coerce.number().int().positive()
});

const createResourceMtlsCertificateBodySchema = z.strictObject({
    name: z.string().min(1).max(255).optional(),
    certificate: z.string().min(1).max(100_000)
});

export type CreateResourceMtlsCertificateResponse = {
    certificates: {
        mtlsCertificateId: number;
        resourceId: number;
        name: string | null;
        subject: string | null;
        issuer: string | null;
        serialNumber: string | null;
        fingerprint: string | null;
        notBefore: number | null;
        notAfter: number | null;
        createdAt: number;
    }[];
};

const description =
    "Add a trusted CA certificate that clients must present a certificate signed by when mTLS is enabled on a resource. Accepts a PEM bundle; each certificate in the bundle is stored separately.";

registry.registerPath({
    method: "put",
    path: "/resource/{resourceId}/mtls/certificate",
    description,
    tags: [OpenAPITags.PublicResourceLegacy],
    request: {
        params: createResourceMtlsCertificateParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourceMtlsCertificateBodySchema
                }
            }
        }
    },
    responses: {}
});

registry.registerPath({
    method: "put",
    path: "/public-resource/{resourceId}/mtls/certificate",
    description,
    tags: [OpenAPITags.PublicResource],
    request: {
        params: createResourceMtlsCertificateParamsSchema,
        body: {
            content: {
                "application/json": {
                    schema: createResourceMtlsCertificateBodySchema
                }
            }
        }
    },
    responses: {}
});

export async function createResourceMtlsCertificate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams =
            createResourceMtlsCertificateParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = createResourceMtlsCertificateBodySchema.safeParse(
            req.body
        );
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { resourceId } = parsedParams.data;
        const { name, certificate } = parsedBody.data;

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        if (resource.mode !== "http") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "mTLS is only supported on HTTP resources"
                )
            );
        }

        const isLicensed = await isLicensedOrSubscribed(
            resource.orgId,
            tierMatrix.mtls
        );
        if (!isLicensed) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "mTLS is not supported on your current plan. Please upgrade to access this feature."
                )
            );
        }

        let parsedCerts;
        try {
            parsedCerts = parseCaCertificates(certificate);
        } catch (e) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    e instanceof Error ? e.message : "Invalid certificate"
                )
            );
        }

        const existing = await db
            .select({ fingerprint: resourceMtlsCertificates.fingerprint })
            .from(resourceMtlsCertificates)
            .where(eq(resourceMtlsCertificates.resourceId, resourceId));

        const existingFingerprints = new Set(existing.map((c) => c.fingerprint));
        const newCerts = parsedCerts.filter(
            (c) => !existingFingerprints.has(c.fingerprint)
        );

        if (newCerts.length === 0) {
            return next(
                createHttpError(
                    HttpCode.CONFLICT,
                    parsedCerts.length === 1
                        ? "This CA certificate has already been added to this resource"
                        : "All certificates in this bundle have already been added to this resource"
                )
            );
        }

        if (
            existing.length + newCerts.length >
            MAX_MTLS_CERTIFICATES_PER_RESOURCE
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `A resource can have at most ${MAX_MTLS_CERTIFICATES_PER_RESOURCE} trusted CA certificates`
                )
            );
        }

        const now = Date.now();
        const inserted = await db
            .insert(resourceMtlsCertificates)
            .values(
                newCerts.map((c) => ({
                    resourceId,
                    // a label only makes sense for a single certificate
                    name: newCerts.length === 1 ? (name ?? null) : null,
                    certificate: c.certificate,
                    subject: c.subject,
                    issuer: c.issuer,
                    serialNumber: c.serialNumber,
                    fingerprint: c.fingerprint,
                    notBefore: c.notBefore,
                    notAfter: c.notAfter,
                    createdAt: now
                }))
            )
            .returning({
                mtlsCertificateId: resourceMtlsCertificates.mtlsCertificateId,
                resourceId: resourceMtlsCertificates.resourceId,
                name: resourceMtlsCertificates.name,
                subject: resourceMtlsCertificates.subject,
                issuer: resourceMtlsCertificates.issuer,
                serialNumber: resourceMtlsCertificates.serialNumber,
                fingerprint: resourceMtlsCertificates.fingerprint,
                notBefore: resourceMtlsCertificates.notBefore,
                notAfter: resourceMtlsCertificates.notAfter,
                createdAt: resourceMtlsCertificates.createdAt
            });

        return response<CreateResourceMtlsCertificateResponse>(res, {
            data: { certificates: inserted },
            success: true,
            error: false,
            message: "CA certificate added successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
