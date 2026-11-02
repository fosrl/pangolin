export type ParsedUserAgent = {
    browser: string | null;
    os: string | null;
    device: "desktop" | "mobile" | "tablet" | "bot" | null;
};

// Order matters: many browsers include the tokens of the ones they derive
// from (Edge and Opera include "Chrome", Chrome includes "Safari").
const BROWSERS: { name: string; pattern: RegExp }[] = [
    { name: "Edge", pattern: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
    { name: "Opera", pattern: /(?:OPR|Opera)\/([\d.]+)/ },
    { name: "Samsung Internet", pattern: /SamsungBrowser\/([\d.]+)/ },
    { name: "Vivaldi", pattern: /Vivaldi\/([\d.]+)/ },
    { name: "Brave", pattern: /Brave\/([\d.]+)/ },
    { name: "Firefox", pattern: /(?:Firefox|FxiOS)\/([\d.]+)/ },
    { name: "Chrome", pattern: /(?:Chrome|CriOS)\/([\d.]+)/ },
    { name: "Safari", pattern: /Version\/([\d.]+).*Safari\// },
    { name: "curl", pattern: /curl\/([\d.]+)/ },
    { name: "Wget", pattern: /Wget\/([\d.]+)/ }
];

const OPERATING_SYSTEMS: { name: string; pattern: RegExp }[] = [
    { name: "iOS", pattern: /(?:iPhone|iPad|iPod).*OS ([\d_]+)/ },
    { name: "Android", pattern: /Android ([\d.]+)/ },
    { name: "ChromeOS", pattern: /CrOS/ },
    { name: "Windows", pattern: /Windows NT/ },
    { name: "macOS", pattern: /Mac OS X ([\d_.]+)/ },
    { name: "Linux", pattern: /Linux/ }
];

function majorVersion(version: string | undefined): string | null {
    if (!version) {
        return null;
    }
    return version.split(/[._]/)[0] || null;
}

export function parseUserAgent(
    userAgent: string | null | undefined
): ParsedUserAgent {
    if (!userAgent) {
        return { browser: null, os: null, device: null };
    }

    let browser: string | null = null;
    for (const { name, pattern } of BROWSERS) {
        const match = userAgent.match(pattern);
        if (match) {
            const version = majorVersion(match[1]);
            browser = version ? `${name} ${version}` : name;
            break;
        }
    }

    let os: string | null = null;
    for (const { name, pattern } of OPERATING_SYSTEMS) {
        const match = userAgent.match(pattern);
        if (match) {
            // macOS reports a frozen 10.15 version, so don't show it
            const version =
                name === "iOS" || name === "Android"
                    ? majorVersion(match[1])
                    : null;
            os = version ? `${name} ${version}` : name;
            break;
        }
    }

    let device: ParsedUserAgent["device"] = "desktop";
    if (/bot|crawler|spider|curl|wget|python|go-http-client/i.test(userAgent)) {
        device = "bot";
    } else if (/iPad|Tablet/i.test(userAgent)) {
        device = "tablet";
    } else if (/Android/.test(userAgent) && !/Mobile/.test(userAgent)) {
        device = "tablet";
    } else if (/Mobi|iPhone|iPod/i.test(userAgent)) {
        device = "mobile";
    }

    return { browser, os, device };
}
