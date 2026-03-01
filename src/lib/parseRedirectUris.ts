export function parseRedirectUris(redirectUris: string): string[] {
    try {
        const parsed = JSON.parse(redirectUris);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => typeof item === "string");
        }
        return [];
    } catch {
        return [];
    }
}
