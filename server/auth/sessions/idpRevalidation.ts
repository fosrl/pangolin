import * as arctic from "arctic";

// Continuous IdP session revalidation is a paid feature, so the open source
// build never stores grants or revalidates sessions with the IdP.
export async function storeIdpRefreshToken(
    _sessionId: string,
    _idpId: number,
    _tokens: arctic.OAuth2Tokens
): Promise<void> {}

export async function clearIdpSessionGrants(_idpId: number): Promise<void> {}

export async function revalidateIdpSession(
    _sessionId: string
): Promise<boolean> {
    return true;
}

export async function inheritIdpGrant(
    _approvingSessionId: string,
    _deviceSessionId: string
): Promise<boolean> {
    return true;
}
