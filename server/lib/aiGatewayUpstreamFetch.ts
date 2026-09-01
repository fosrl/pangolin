import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

type UpstreamFetchInit = {
    method: string;
    headers: Record<string, string>;
    body?: string;
    skipTlsVerification?: boolean;
    signal?: AbortSignal;
};

const insecureHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
});

export function aiGatewayUpstreamFetch(
    url: string,
    init: UpstreamFetchInit
): Promise<Response> {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const agent =
        isHttps && init.skipTlsVerification ? insecureHttpsAgent : undefined;

    return new Promise((resolve, reject) => {
        if (init.signal?.aborted) {
            reject(init.signal.reason ?? new Error("Request aborted"));
            return;
        }

        const req = lib.request(
            url,
            {
                method: init.method,
                headers: init.headers,
                agent
            },
            (res) => {
                const headers = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                    if (value === undefined) {
                        continue;
                    }
                    if (Array.isArray(value)) {
                        for (const entry of value) {
                            headers.append(key, entry);
                        }
                    } else {
                        headers.set(key, value);
                    }
                }

                const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
                resolve(
                    new Response(body, {
                        status: res.statusCode ?? 502,
                        statusText: res.statusMessage,
                        headers
                    })
                );
            }
        );

        req.on("error", reject);

        if (init.signal) {
            const onAbort = () => req.destroy(init.signal!.reason);
            init.signal.addEventListener("abort", onAbort, { once: true });
            req.on("close", () =>
                init.signal!.removeEventListener("abort", onAbort)
            );
        }

        if (init.body !== undefined) {
            req.write(init.body);
        }
        req.end();
    });
}
