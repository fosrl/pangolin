import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import config from "@server/lib/config";
import logger from "@server/logger";
import {
    errorHandlerMiddleware,
    notFoundMiddleware
} from "@server/middlewares";
import { internalRouter } from "#dynamic/routers/internal";
import { stripDuplicateSesions } from "./middlewares/stripDuplicateSessions";
import { router as wsRouter, handleWSUpgrade } from "#dynamic/routers/ws";

const internalPort = config.getRawConfig().server.internal_port;

export function createInternalServer() {
    const internalServer = express();

    const trustProxy = config.getRawConfig().server.trust_proxy;
    if (trustProxy) {
        internalServer.set("trust proxy", trustProxy);
    }

    internalServer.use(helmet());
    internalServer.use(cors());
    internalServer.use(stripDuplicateSesions);
    internalServer.use(cookieParser());
    internalServer.use(express.json());

    const prefix = `/api/v1`;
    internalServer.use(prefix, internalRouter);

    // WebSocket routes
    internalServer.use(prefix, wsRouter);

    internalServer.use(notFoundMiddleware);
    internalServer.use(errorHandlerMiddleware);

    const httpServer = internalServer.listen(internalPort, (err?: any) => {
        if (err) throw err;
        logger.info(
            `Internal API server is running on http://localhost:${internalPort}`
        );
    });

    // Handle WebSocket upgrades
    handleWSUpgrade(httpServer);

    return httpServer;
}
