import { Env } from "@app/lib/types/env";
import { resolveClientApiBaseUrl } from "@app/lib/publicEnv";
import axios, { AxiosInstance } from "axios";

let apiInstance: AxiosInstance | null = null;

export function createApiClient({ env }: { env: Env }): AxiosInstance {
    if (apiInstance) {
        return apiInstance;
    }

    if (typeof window === "undefined") {
        // @ts-ignore
        return;
    }

    const { baseURL, directAccess } = resolveClientApiBaseUrl({
        env,
        windowLocation: window.location
    });

    if (directAccess) {
        // this means the user is addressing the server directly
        axios.defaults.withCredentials = true;
    }

    if (!baseURL) {
        throw new Error("Failed to create api client, invalid environment");
    }

    apiInstance = axios.create({
        baseURL,
        timeout: 10000,
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": "x-csrf-protection"
        }
    });

    return apiInstance;
}

// we can pull from env var here becuase it is only used in the server
export const internal = axios.create({
    baseURL: `http://localhost:${process.env.SERVER_EXTERNAL_PORT}/api/v1`,
    timeout: 10000,
    headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "x-csrf-protection"
    }
});

const remoteAPIURL =
    process.env.NODE_ENV === "development"
        ? (process.env.NEXT_PUBLIC_FOSSORIAL_REMOTE_API_URL ??
          "https://api.fossorial.io")
        : "https://api.fossorial.io";

export const remote = axios.create({
    baseURL: `${remoteAPIURL}/api/v1`,
    timeout: 10000,
    headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "x-csrf-protection"
    }
});

export const priv = axios.create({
    baseURL: `http://localhost:${process.env.SERVER_INTERNAL_PORT}/api/v1`,
    timeout: 10000,
    headers: {
        "Content-Type": "application/json"
    }
});

export * from "./formatAxiosError";
