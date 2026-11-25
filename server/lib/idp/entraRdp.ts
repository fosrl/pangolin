import config from "@server/lib/config";
import logger from "@server/logger";

/**
 * Helpers for Microsoft Entra ID sign-in to RDP hosts (RDS AAD Auth).
 *
 * The browser RDP client authenticates to Entra joined Windows hosts with an
 * access token issued for the Remote Desktop sign-in resource and bound to
 * an RSA proof-of-possession key held by the browser. The token is obtained
 * through the regular authorization code flow of an Entra OIDC identity
 * provider configured in Pangolin, with two additions: the RDP scope and the
 * `req_cnf` parameter that binds the token to the key.
 */

const ENTRA_AUTHORITY_SUFFIXES = [
    "login.microsoftonline.com",
    "login.microsoftonline.us",
    "login.microsoftonline.de",
    "login.partner.microsoftonline.cn",
    "login.windows.net"
];

const RDP_TOKEN_AUDIENCE = "ms-device-service://termsrv.wvd.microsoft.com";

/** Entra device names are NetBIOS-style computer names. */
const DEVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** Entra device IDs are GUIDs; a computer name is too short to be one. */
const DEVICE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEntraAuthority(authUrl: string): boolean {
    try {
        const { hostname } = new URL(authUrl);
        return ENTRA_AUTHORITY_SUFFIXES.some(
            (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
        );
    } catch {
        return false;
    }
}

export function isValidEntraDeviceName(name: string): boolean {
    return DEVICE_NAME_PATTERN.test(name);
}

/**
 * Scope of the access token for one target host.
 *
 * MS-RDPBCGR 4.11.4 allows the host to be named by its Entra device ID or by
 * its hostname. Device names are not unique in a tenant, so a device ID is
 * the unambiguous form.
 */
export function rdpEntraScope(device: string): string {
    const form = DEVICE_ID_PATTERN.test(device) ? "id" : "name";
    return `${RDP_TOKEN_AUDIENCE}/${form}/${device}/user_impersonation`;
}

export function rdpEntraRedirectUrl(idpId: number): string {
    const baseUrl = config.getRawConfig().app.dashboard_url!;
    return new URL(`/auth/idp/${idpId}/rdp/callback`, baseUrl).toString();
}

export type RdpEntraTokens = {
    accessToken: string;
    expiresIn: number | null;
};

export class EntraTokenError extends Error {
    constructor(
        message: string,
        public readonly code?: string
    ) {
        super(message);
        this.name = "EntraTokenError";
    }
}

/**
 * Exchanges the authorization code for a proof-of-possession access token.
 *
 * `reqCnf` is the base64url `{"kid": <RFC 7638 thumbprint>}` of the browser's
 * key; Entra echoes it as the `cnf` claim of the token.
 *
 * The request follows MS-RDPBCGR 4.11.4: it carries `req_cnf` and no
 * `token_type`, and it is made as a public client, without the client secret,
 * like the Microsoft Remote Desktop clients. The RDP redirect URI is therefore
 * registered under the "Mobile and desktop applications" platform of the app
 * registration.
 */
export async function exchangeRdpEntraCode(params: {
    tokenUrl: string;
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
    scope: string;
    reqCnf: string;
}): Promise<RdpEntraTokens> {
    const body = new URLSearchParams({
        client_id: params.clientId,
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
        scope: params.scope,
        req_cnf: params.reqCnf
    });

    const json = await postForm(params.tokenUrl, body);

    if (typeof json.access_token !== "string") {
        throw new EntraTokenError(
            "Entra ID did not return an access token",
            typeof json.error === "string" ? json.error : undefined
        );
    }

    if (json.token_type !== "pop") {
        // Without the binding the RDP host rejects the assertion, so fail here
        // with a message that points at the tenant configuration.
        throw new EntraTokenError(
            "Entra ID issued a bearer token instead of a proof-of-possession token; the app registration is not approved for Remote Desktop sign-in"
        );
    }

    return {
        accessToken: json.access_token,
        expiresIn: typeof json.expires_in === "number" ? json.expires_in : null
    };
}

export const ENTRA_DEVICE_LIST_SCOPE = "https://graph.microsoft.com/User.Read";

// A user is linked to a device as its owner, its registered user, or both,
// depending on how the device was joined, so both lists are read.
// The lists are read without a type cast: with one, Graph leaves out the
// entries the app may not read instead of returning them without details.
const GRAPH_USER_DEVICE_URLS = [
    "https://graph.microsoft.com/v1.0/me/ownedDevices?$top=100",
    "https://graph.microsoft.com/v1.0/me/registeredDevices?$top=100"
];
const GRAPH_DEVICE_TYPE = "#microsoft.graph.device";

export type EntraDevice = {
    deviceId: string;
    name: string;
};

export async function exchangeEntraGraphCode(params: {
    tokenUrl: string;
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
}): Promise<string> {
    const json = await postForm(
        params.tokenUrl,
        new URLSearchParams({
            client_id: params.clientId,
            grant_type: "authorization_code",
            code: params.code,
            redirect_uri: params.redirectUri,
            code_verifier: params.codeVerifier,
            scope: ENTRA_DEVICE_LIST_SCOPE
        })
    );

    if (typeof json.access_token !== "string") {
        throw new EntraTokenError(
            "Entra ID did not return an access token",
            typeof json.error === "string" ? json.error : undefined
        );
    }

    return json.access_token;
}

/**
 * Lists the Windows devices in Entra ID that the signed-in user owns or is
 * the registered user of, which are the devices the user joined or registered.
 */
export async function listOwnedEntraDevices(
    graphAccessToken: string
): Promise<EntraDevice[]> {
    const entries = (
        await Promise.all(
            GRAPH_USER_DEVICE_URLS.map((url) =>
                fetchGraphDevices(url, graphAccessToken)
            )
        )
    ).flat();

    const devices = new Map<string, EntraDevice>();
    let unreadable = 0;
    for (const entry of entries) {
        if (entry["@odata.type"] !== GRAPH_DEVICE_TYPE) {
            continue;
        }
        // Graph returns only the object ID for entries the app may not read.
        if (
            typeof entry.deviceId !== "string" ||
            typeof entry.displayName !== "string"
        ) {
            unreadable++;
            continue;
        }
        if (entry.accountEnabled === false) {
            continue;
        }
        if (
            typeof entry.operatingSystem === "string" &&
            !entry.operatingSystem.toLowerCase().startsWith("windows")
        ) {
            continue;
        }
        devices.set(entry.deviceId, {
            deviceId: entry.deviceId,
            name: entry.displayName
        });
    }

    logger.info("Entra user devices listed", {
        returned: entries.length,
        unreadable,
        usable: devices.size
    });

    if (devices.size === 0 && unreadable > 0) {
        throw new EntraTokenError(
            "Microsoft Graph returned your devices without their details. The app registration needs the delegated Microsoft Graph permission Device.Read.All with admin consent."
        );
    }

    return [...devices.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchGraphDevices(
    url: string,
    graphAccessToken: string
): Promise<Record<string, unknown>[]> {
    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${graphAccessToken}`,
                Accept: "application/json"
            }
        });
    } catch (error) {
        throw new EntraTokenError(
            `Unable to reach Microsoft Graph: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    let json: { value?: unknown; error?: { message?: unknown } };
    try {
        json = await response.json();
    } catch {
        throw new EntraTokenError(
            `Microsoft Graph returned an unexpected response (HTTP ${response.status})`
        );
    }

    if (!response.ok || !Array.isArray(json.value)) {
        const description =
            typeof json.error?.message === "string"
                ? json.error.message
                : `HTTP ${response.status}`;
        throw new EntraTokenError(
            `Microsoft Graph rejected the device request: ${description}`
        );
    }

    return json.value as Record<string, unknown>[];
}

/** Fresh Entra nonce that the RDP assertion must carry (grant_type=srv_challenge). */
export async function fetchEntraNonce(tokenUrl: string): Promise<string> {
    const json = await postForm(
        tokenUrl,
        new URLSearchParams({ grant_type: "srv_challenge" })
    );

    if (typeof json.Nonce !== "string") {
        throw new EntraTokenError("Entra ID did not return a nonce");
    }

    return json.Nonce;
}

async function postForm(
    url: string,
    body: URLSearchParams
): Promise<Record<string, unknown>> {
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json"
            },
            body
        });
    } catch (error) {
        throw new EntraTokenError(
            `Unable to reach Entra ID: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    let json: Record<string, unknown>;
    try {
        json = (await response.json()) as Record<string, unknown>;
    } catch {
        throw new EntraTokenError(
            `Entra ID returned an unexpected response (HTTP ${response.status})`
        );
    }

    if (!response.ok) {
        const description =
            typeof json.error_description === "string"
                ? json.error_description
                : `HTTP ${response.status}`;
        throw new EntraTokenError(
            `Entra ID rejected the request: ${description}`,
            typeof json.error === "string" ? json.error : undefined
        );
    }

    return json;
}
