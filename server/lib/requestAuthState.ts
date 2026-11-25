import type { Request } from "express";
import type { ApiKeyOrg, UserOrg } from "@server/db";

// Request fields that access middlewares use as a per-request cache. A value
// for any of these that does not live on the request itself (for example one
// inherited from a polluted Object.prototype) must never be trusted.
const AUTH_STATE_KEYS = [
    "userOrg",
    "apiKeyOrg",
    "userOrgRoleIds",
    "userOrgId",
    "userOrgIds",
    "orgPolicyAllowed"
] as const;

// Give the request its own (undefined) copy of every cached auth field so a
// read can never fall through to the prototype chain.
export function initRequestAuthState(req: Request): void {
    for (const key of AUTH_STATE_KEYS) {
        if (!Object.hasOwn(req, key)) {
            Object.defineProperty(req, key, {
                value: undefined,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
    }
}

// The cached org membership for the signed-in user, or undefined if there is
// none or it belongs to someone else.
export function ownUserOrg(req: Request): UserOrg | undefined {
    if (!Object.hasOwn(req, "userOrg")) {
        return undefined;
    }
    const userOrg = req.userOrg;
    if (!userOrg || !req.user || userOrg.userId !== req.user.userId) {
        return undefined;
    }
    return userOrg;
}

// The cached org link for the calling API key, or undefined if there is none
// or it belongs to a different key.
export function ownApiKeyOrg(req: Request): ApiKeyOrg | undefined {
    if (!Object.hasOwn(req, "apiKeyOrg")) {
        return undefined;
    }
    const keyOrg = req.apiKeyOrg;
    if (!keyOrg || !req.apiKey || keyOrg.apiKeyId !== req.apiKey.apiKeyId) {
        return undefined;
    }
    return keyOrg;
}
