"use server";

import { cookies, headers as reqHeaders } from "next/headers";
import { ResponseT } from "@server/types/Response";
import { pullEnv } from "@app/lib/pullEnv";

type CookieOptions = {
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
    expires?: Date;
    maxAge?: number;
    domain?: string;
};

function parseSetCookieString(
    setCookie: string,
    host?: string
): {
    name: string;
    value: string;
    options: CookieOptions;
} {
    const parts = setCookie.split(";").map((p) => p.trim());
    const [nameValue, ...attrParts] = parts;
    const [name, ...valParts] = nameValue.split("=");
    const value = valParts.join("="); // handles '=' inside JWT

    const env = pullEnv();

    const options: CookieOptions = {};

    for (const attr of attrParts) {
        const [k, v] = attr.split("=").map((s) => s.trim());
        switch (k.toLowerCase()) {
            case "path":
                options.path = v;
                break;
            case "httponly":
                options.httpOnly = true;
                break;
            case "secure":
                options.secure = true;
                break;
            case "samesite":
                options.sameSite =
                    v?.toLowerCase() as CookieOptions["sameSite"];
                break;
            case "expires":
                options.expires = new Date(v);
                break;
            case "max-age":
                options.maxAge = parseInt(v, 10);
                break;
        }
    }

    if (!options.domain) {
        const d = host
            ? host.split(":")[0] // strip port if present
            : new URL(env.app.dashboardUrl).hostname;
        if (d) {
            options.domain = d;
        }
    }

    return { name, value, options };
}

async function makeApiRequest<T>(
    url: string,
    method: "GET" | "POST",
    body?: any,
    additionalHeaders: Record<string, string> = {}
): Promise<ResponseT<T>> {
    // Get existing cookies to forward
    const allCookies = await cookies();
    const cookieHeader = allCookies.toString();

    const headersList = await reqHeaders();
    const host = headersList.get("host");
    const xForwardedFor = headersList.get("x-forwarded-for");

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-CSRF-Token": "x-csrf-protection",
        ...(xForwardedFor ? { "X-Forwarded-For": xForwardedFor } : {}),
        ...(cookieHeader && { Cookie: cookieHeader }),
        ...additionalHeaders
    };

    let res: Response;
    try {
        res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            cache: "no-store"
        });
    } catch (fetchError) {
        console.error("API request failed:", fetchError);
        return {
            data: null,
            success: false,
            error: true,
            message: "Failed to connect to server. Please try again.",
            status: 0
        };
    }

    // Handle Set-Cookie header
    const rawSetCookie = res.headers.get("set-cookie");
    if (rawSetCookie) {
        try {
            const { name, value, options } = parseSetCookieString(
                rawSetCookie,
                host || undefined
            );
            const allCookies = await cookies();
            allCookies.set(name, value, options);
        } catch (cookieError) {
            console.error("Failed to parse Set-Cookie header:", cookieError);
            // Continue without setting cookies rather than failing
        }
    }

    let responseData;
    try {
        responseData = await res.json();
    } catch (jsonError) {
        console.error("Failed to parse response JSON:", jsonError);
        return {
            data: null,
            success: false,
            error: true,
            message: "Invalid response format from server. Please try again.",
            status: res.status
        };
    }

    if (!responseData) {
        console.error("Invalid response structure:", responseData);
        return {
            data: null,
            success: false,
            error: true,
            message:
                "Invalid response structure from server. Please try again.",
            status: res.status
        };
    }

    // If the API returned an error, return the error message
    if (!res.ok || responseData.error) {
        return {
            data: null,
            success: false,
            error: true,
            message:
                responseData.message ||
                `Server responded with ${res.status}: ${res.statusText}`,
            status: res.status
        };
    }

    // Handle successful responses where data can be null
    if (responseData.success && responseData.data === null) {
        return {
            data: null,
            success: true,
            error: false,
            message: responseData.message || "Success",
            status: res.status
        };
    }

    if (!responseData.data) {
        console.error("Invalid response structure:", responseData);
        return {
            data: null,
            success: false,
            error: true,
            message:
                "Invalid response structure from server. Please try again.",
            status: res.status
        };
    }

    return {
        data: responseData.data,
        success: true,
        error: false,
        message: responseData.message || "Success",
        status: res.status
    };
}

// ============================================================================
// AUTH TYPES AND FUNCTIONS
// ============================================================================

export type LoginRequest = {
    email: string;
    password: string;
    code?: string;
    resourceGuid?: string;
};

export type LoginResponse = {
    useSecurityKey?: boolean;
    codeRequested?: boolean;
    emailVerificationRequired?: boolean;
    twoFactorSetupRequired?: boolean;
};

export type SecurityKeyStartRequest = {
    email?: string;
};

export type SecurityKeyStartResponse = {
    tempSessionId: string;
    challenge: string;
    allowCredentials: any[];
    timeout: number;
    rpId: string;
    userVerification: "required" | "preferred" | "discouraged";
};

export type SecurityKeyVerifyRequest = {
    credential: any;
};

export type SecurityKeyVerifyResponse = {
    success: boolean;
    message?: string;
};

export async function loginProxy(
    request: LoginRequest
): Promise<ResponseT<LoginResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/login`;

    console.log("Making login request to:", url);

    return await makeApiRequest<LoginResponse>(url, "POST", request);
}

export async function securityKeyStartProxy(
    request: SecurityKeyStartRequest
): Promise<ResponseT<SecurityKeyStartResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/security-key/authenticate/start`;

    console.log("Making security key start request to:", url);

    return await makeApiRequest<SecurityKeyStartResponse>(url, "POST", request);
}

export async function securityKeyVerifyProxy(
    request: SecurityKeyVerifyRequest,
    tempSessionId: string
): Promise<ResponseT<SecurityKeyVerifyResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/security-key/authenticate/verify`;

    console.log("Making security key verify request to:", url);

    return await makeApiRequest<SecurityKeyVerifyResponse>(
        url,
        "POST",
        request,
        {
            "X-Temp-Session-Id": tempSessionId
        }
    );
}

// ============================================================================
// RESOURCE TYPES AND FUNCTIONS
// ============================================================================

export type ResourcePasswordRequest = {
    password: string;
};

export type ResourcePasswordResponse = {
    session?: string;
};

export type ResourcePincodeRequest = {
    pincode: string;
};

export type ResourcePincodeResponse = {
    session?: string;
};

export type ResourceWhitelistRequest = {
    email: string;
    otp?: string;
};

export type ResourceWhitelistResponse = {
    otpSent?: boolean;
    session?: string;
};

export type ResourceAccessResponse = {
    success: boolean;
    message?: string;
};

export async function resourcePasswordProxy(
    resourceId: number,
    request: ResourcePasswordRequest
): Promise<ResponseT<ResourcePasswordResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/resource/${resourceId}/password`;

    console.log("Making resource password request to:", url);

    return await makeApiRequest<ResourcePasswordResponse>(url, "POST", request);
}

export async function resourcePincodeProxy(
    resourceId: number,
    request: ResourcePincodeRequest
): Promise<ResponseT<ResourcePincodeResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/resource/${resourceId}/pincode`;

    console.log("Making resource pincode request to:", url);

    return await makeApiRequest<ResourcePincodeResponse>(url, "POST", request);
}

export async function resourceWhitelistProxy(
    resourceId: number,
    request: ResourceWhitelistRequest
): Promise<ResponseT<ResourceWhitelistResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/resource/${resourceId}/whitelist`;

    console.log("Making resource whitelist request to:", url);

    return await makeApiRequest<ResourceWhitelistResponse>(
        url,
        "POST",
        request
    );
}

export async function resourceAccessProxy(
    resourceId: number
): Promise<ResponseT<ResourceAccessResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/resource/${resourceId}`;

    console.log("Making resource access request to:", url);

    return await makeApiRequest<ResourceAccessResponse>(url, "GET");
}

// ============================================================================
// IDP TYPES AND FUNCTIONS
// ============================================================================

export type GenerateOidcUrlRequest = {
    redirectUrl: string;
};

export type GenerateOidcUrlResponse = {
    redirectUrl: string;
};

export type ValidateOidcUrlCallbackRequest = {
    code: string;
    state: string;
    storedState: string;
};

export type ValidateOidcUrlCallbackResponse = {
    redirectUrl: string;
};

export async function validateOidcUrlCallbackProxy(
    idpId: string,
    code: string,
    expectedState: string,
    stateCookie: string,
    loginPageId?: number
): Promise<ResponseT<ValidateOidcUrlCallbackResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/idp/${idpId}/oidc/validate-callback${loginPageId ? "?loginPageId=" + loginPageId : ""}`;

    console.log("Making OIDC callback validation request to:", url);

    return await makeApiRequest<ValidateOidcUrlCallbackResponse>(url, "POST", {
        code: code,
        state: expectedState,
        storedState: stateCookie
    });
}

export async function generateOidcUrlProxy(
    idpId: number,
    redirect: string,
    orgId?: string
): Promise<ResponseT<GenerateOidcUrlResponse>> {
    const serverPort = process.env.SERVER_EXTERNAL_PORT;
    const url = `http://localhost:${serverPort}/api/v1/auth/idp/${idpId}/oidc/generate-url${orgId ? `?orgId=${orgId}` : ""}`;

    console.log("Making OIDC URL generation request to:", url);

    return await makeApiRequest<GenerateOidcUrlResponse>(url, "POST", {
        redirectUrl: redirect || "/"
    });
}
