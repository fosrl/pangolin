// URL schemes are case-insensitive, and mobile keyboards often capitalize the
// first letter, so "Https://host:8443" must be read as https too.
export const HOST_TARGET_SCHEME = /^(https?|h2c):\/\//i;

export function parseHostTarget(input: string) {
    try {
        const normalized = HOST_TARGET_SCHEME.test(input)
            ? input
            : `http://${input}`;
        const url = new URL(normalized);

        const protocol = url.protocol.replace(":", ""); // http | https | h2c
        const host = url.hostname;

        let defaultPort: number;
        switch (protocol) {
            case "https":
                defaultPort = 443;
                break;
            case "h2c":
                defaultPort = 80;
                break;
            default: // http
                defaultPort = 80;
                break;
        }

        const port = url.port ? parseInt(url.port, 10) : defaultPort;

        return { protocol, host, port };
    } catch {
        return null;
    }
}
