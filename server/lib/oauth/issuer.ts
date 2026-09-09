import config from "@server/lib/config";

function stripTrailingSlash(value: string): string {
    if (value.endsWith("/")) {
        return value.slice(0, -1);
    }
    return value;
}

export function getIssuerUrl(): string {
    const dashboardUrl = config.getRawConfig().app.dashboard_url;
    if (dashboardUrl) {
        return stripTrailingSlash(dashboardUrl);
    }

    return `http://localhost:${config.getRawConfig().server.external_port}`;
}
