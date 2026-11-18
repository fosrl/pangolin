// Revoking resource sessions is an enterprise feature, so nothing can ever
// require a reauth in the open source build.
export async function isResourceReauthRequired(
    userSessionId: string,
    resourceId: number
): Promise<boolean> {
    return false;
}
