import express from "express";
import helmet from "helmet";
import cors from "cors";
import config from "@server/lib/config";
import logger from "@server/logger";
import {
    errorHandlerMiddleware,
    notFoundMiddleware
} from "@server/middlewares";
import { createAiGatewayRouter } from "@server/routers/aiGateway";

const aiGatewayPort = config.getRawConfig().server.ai_gateway_port;

export function createAiGatewayServer() {
    const aiGatewayServer = express();

    const trustProxy = config.getRawConfig().server.trust_proxy;
    if (trustProxy) {
        aiGatewayServer.set("trust proxy", trustProxy);
    }

    aiGatewayServer.use(helmet());
    aiGatewayServer.use(cors());
    // AI requests can carry large payloads (long conversation history, tool
    // results, embedded documents), well beyond express.json()'s 100kb default.
    aiGatewayServer.use(express.json({ limit: "50mb" }));

    aiGatewayServer.use(createAiGatewayRouter());

    aiGatewayServer.use(notFoundMiddleware);
    aiGatewayServer.use(errorHandlerMiddleware);

    aiGatewayServer.listen(aiGatewayPort, (err?: any) => {
        if (err) throw err;
        logger.info(
            `AI gateway server is running on http://localhost:${aiGatewayPort}`
        );
    });

    return aiGatewayServer;
}
