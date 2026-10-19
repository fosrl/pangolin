import next from "next";
import express from "express";
import fs from "fs";
import path from "path";
import { parse } from "url";
import logger from "@server/logger";
import config from "@server/lib/config";
import { stripDuplicateSesions } from "./middlewares/stripDuplicateSessions";

const nextPort = config.getRawConfig().server.next_port;

export async function createNextServer() {
    const dev = process.env.ENVIRONMENT !== "prod";

    // The image only ships the files Next traced for its standalone output,
    // which leaves out what is needed to load next.config at runtime. Hand
    // Next the config resolved at build time instead, the same way the
    // generated .next/standalone/server.js does.
    const requiredServerFilesPath = path.join(
        process.cwd(),
        ".next",
        "required-server-files.json"
    );
    if (!dev && fs.existsSync(requiredServerFilesPath)) {
        const { config: nextConfig } = JSON.parse(
            fs.readFileSync(requiredServerFilesPath, "utf8")
        );
        process.env.__NEXT_PRIVATE_STANDALONE_CONFIG =
            JSON.stringify(nextConfig);
    }

    //   const app = next({ dev });
    const app = next({
        dev,
        turbopack: false
    });
    const handle = app.getRequestHandler();

    await app.prepare();

    const nextServer = express();

    nextServer.use(stripDuplicateSesions);

    nextServer.all("/{*splat}", (req, res) => {
        const parsedUrl = parse(req.url!, true);
        return handle(req, res, parsedUrl);
    });

    nextServer.listen(nextPort, (err?: any) => {
        if (err) throw err;
        logger.info(
            `Dashboard Web UI server is running on http://localhost:${nextPort}`
        );
    });

    return nextServer;
}
