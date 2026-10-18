import type { NextFunction, Request, Response } from "express";
import { assertEquals } from "@test/assert";
import {
    EXPIRED_CA_PEM,
    FUTURE_CA_PEM,
    LEAF_CERT_PEM,
    VALID_CA_PEM
} from "../../../test/fixtures/upstreamCaCertificates";
import {
    createUpstreamCaHandlers,
    type UpstreamCaStore
} from "./upstreamCaHandlers";

type Handler = ReturnType<
    typeof createUpstreamCaHandlers
>["getResourceUpstreamCa"];

type CallResult = {
    status?: number;
    body?: {
        data: { certificatePem: string | null };
        success: boolean;
    };
    error?: { status: number; message: string };
};

// Exercise the real Express handlers, with only their database operations
// replaced by an in-memory store. No app, credentials, or test DB required.
async function call(
    handler: Handler,
    resourceId: string,
    body?: unknown
): Promise<CallResult> {
    const result: CallResult = {};
    const req = { params: { resourceId }, body } as unknown as Request;
    const res = {
        status(code: number) {
            result.status = code;
            return this;
        },
        send(payload: CallResult["body"]) {
            result.body = payload;
            return this;
        }
    } as unknown as Response;
    const next: NextFunction = (error?: any) => {
        result.error = error;
    };
    await handler(req, res, next);
    return result;
}

async function runTests() {
    const modes = new Map<number, string>([
        [1, "http"],
        [2, "tcp"],
        [3, "udp"]
    ]);
    const certificates = new Map<number, string>();
    let writes = 0;
    let removals = 0;
    let logCount = 0;
    let failNextRead = false;

    const store: UpstreamCaStore = {
        async getResourceMode(resourceId) {
            if (failNextRead) {
                failNextRead = false;
                throw new Error("Simulated database failure");
            }
            return modes.get(resourceId) ?? null;
        },
        async getCertificate(resourceId) {
            return certificates.get(resourceId) ?? null;
        },
        async saveCertificate(resourceId, certificatePem) {
            writes++;
            certificates.set(resourceId, certificatePem);
        },
        async deleteCertificate(resourceId) {
            removals++;
            certificates.delete(resourceId);
        }
    };

    const handlers = createUpstreamCaHandlers(store, () => logCount++);

    let result = await call(handlers.getResourceUpstreamCa, "1");
    assertEquals(result.status, 200, "GET with no CA should succeed");
    assertEquals(
        result.body?.data.certificatePem,
        null,
        "GET should return null"
    );

    result = await call(handlers.putResourceUpstreamCa, "1", {
        certificatePem: VALID_CA_PEM
    });
    assertEquals(result.status, 200, "PUT of a valid CA should succeed");
    assertEquals(
        result.body?.data.certificatePem,
        VALID_CA_PEM,
        "PUT returns normalized CA"
    );
    assertEquals(writes, 1, "PUT must persist exactly once");

    result = await call(handlers.getResourceUpstreamCa, "1");
    assertEquals(
        result.body?.data.certificatePem,
        VALID_CA_PEM,
        "GET should read saved CA"
    );

    // A second valid PUT is a replacement (no duplicate records).
    result = await call(handlers.putResourceUpstreamCa, "1", {
        certificatePem: `# CA bundle metadata\n${VALID_CA_PEM}`
    });
    assertEquals(result.status, 200, "Replacing a CA should succeed");
    assertEquals(
        certificates.size,
        1,
        "Replacement must not create another row"
    );
    assertEquals(
        certificates.get(1),
        VALID_CA_PEM,
        "Metadata should be stripped"
    );

    for (const [label, pem] of [
        [
            "malformed X.509",
            "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----"
        ],
        ["leaf certificate", LEAF_CERT_PEM],
        ["expired CA", EXPIRED_CA_PEM],
        ["future CA", FUTURE_CA_PEM],
        [
            "private key",
            "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----"
        ]
    ] as const) {
        const previousWrites = writes;
        result = await call(handlers.putResourceUpstreamCa, "1", {
            certificatePem: pem
        });
        assertEquals(result.error?.status, 400, `${label}: expected HTTP 400`);
        assertEquals(writes, previousWrites, `${label}: no write may occur`);
        assertEquals(
            certificates.get(1),
            VALID_CA_PEM,
            `${label}: existing CA preserved`
        );
    }

    for (const badBody of [
        {},
        { certificatePem: "" },
        { certificatePem: 12 }
    ]) {
        result = await call(handlers.putResourceUpstreamCa, "1", badBody);
        assertEquals(
            result.error?.status,
            400,
            "Invalid PUT body should be rejected"
        );
    }

    for (const badId of ["0", "not-a-number"]) {
        result = await call(handlers.getResourceUpstreamCa, badId);
        assertEquals(
            result.error?.status,
            400,
            "Invalid resource ID should be rejected"
        );
    }

    for (const resourceId of ["2", "3"]) {
        for (const handler of [
            handlers.getResourceUpstreamCa,
            handlers.putResourceUpstreamCa,
            handlers.deleteResourceUpstreamCa
        ]) {
            result = await call(handler, resourceId, {
                certificatePem: VALID_CA_PEM
            });
            assertEquals(
                result.error?.status,
                400,
                "Non-HTTP resource must be rejected"
            );
        }
    }

    for (const handler of [
        handlers.getResourceUpstreamCa,
        handlers.putResourceUpstreamCa,
        handlers.deleteResourceUpstreamCa
    ]) {
        result = await call(handler, "999", { certificatePem: VALID_CA_PEM });
        assertEquals(
            result.error?.status,
            404,
            "Missing resource should return HTTP 404"
        );
    }

    const writesBeforeDelete = writes;
    result = await call(handlers.deleteResourceUpstreamCa, "1");
    assertEquals(result.status, 200, "DELETE should succeed");
    assertEquals(result.body?.data.certificatePem, null, "DELETE returns null");
    result = await call(handlers.deleteResourceUpstreamCa, "1");
    assertEquals(result.status, 200, "DELETE should be idempotent");
    assertEquals(removals, 2, "Both DELETE operations are safe");
    assertEquals(writes, writesBeforeDelete, "DELETE must not write CA data");
    result = await call(handlers.getResourceUpstreamCa, "1");
    assertEquals(
        result.body?.data.certificatePem,
        null,
        "GET after DELETE returns null"
    );

    failNextRead = true;
    result = await call(handlers.getResourceUpstreamCa, "1");
    assertEquals(
        result.error?.status,
        500,
        "Database failures should become HTTP 500"
    );
    assertEquals(logCount, 1, "Unexpected failures should be logged");

    console.log("All upstream CA handler tests passed!");
}

runTests().catch((error) => {
    console.error("Upstream CA handler test failed:", error);
    process.exitCode = 1;
});
