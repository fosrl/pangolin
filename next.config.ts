import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import fs from "fs";
import path from "path";

const withNextIntl = createNextIntlPlugin();
// read allowedDevOrigins.json if it exists
let allowedDevOrigins: string[] = [];
const allowedDevOriginsPath = path.join(
    process.cwd(),
    "allowedDevOrigins.json"
);
if (fs.existsSync(allowedDevOriginsPath)) {
    try {
        const data = fs.readFileSync(allowedDevOriginsPath, "utf-8");
        allowedDevOrigins = JSON.parse(data);
    } catch {}
}

const nextConfig: NextConfig = {
    reactStrictMode: false,
    reactCompiler: true,
    transpilePackages: ["@novnc/novnc"],
    output: "standalone",
    allowedDevOrigins,
    async redirects() {
        return [
            {
                source: "/:orgId/settings/resources/proxy/:path*",
                destination: "/:orgId/settings/resources/public/:path*",
                permanent: true
            },
            {
                source: "/:orgId/settings/resources/client/:path*",
                destination: "/:orgId/settings/resources/private/:path*",
                permanent: true
            }
        ];
    }
};

export default withNextIntl(nextConfig);
