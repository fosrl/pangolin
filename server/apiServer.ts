import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import config from "@server/lib/config";
import logger from "@server/logger";
import {
    errorHandlerMiddleware,
    notFoundMiddleware
} from "@server/middlewares";
import { authenticated, unauthenticated } from "#dynamic/routers/external";
import { router as wsRouter, handleWSUpgrade } from "#dynamic/routers/ws";
import { logIncomingMiddleware } from "./middlewares/logIncoming";
import { csrfProtectionMiddleware } from "./middlewares/csrfProtection";
import helmet from "helmet";
import { build } from "./build";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import createHttpError from "http-errors";
import HttpCode from "./types/HttpCode";
import requestTimeoutMiddleware from "./middlewares/requestTimeout";
import { createStore } from "#dynamic/lib/rateLimitStore";
import { stripDuplicateSesions } from "./middlewares/stripDuplicateSessions";
import { corsWithLoginPageSupport } from "@server/lib/corsWithLoginPage";
import { hybridRouter } from "#dynamic/routers/hybrid";
import { billingWebhookHandler } from "#dynamic/routers/billing/webhooks";

const dev = config.isDev;
const externalPort = config.getRawConfig().server.external_port;

export function createApiServer() {
    const apiServer = express();
    const prefix = `/api/v1`;

    const trustProxy = config.getRawConfig().server.trust_proxy;
    if (trustProxy) {
        apiServer.set("trust proxy", trustProxy);
    }

    if (build == "saas") {
        apiServer.post(
            `${prefix}/billing/webhooks`,
            express.raw({ type: "application/json" }),
            billingWebhookHandler
        );
    }

    const corsConfig = config.getRawConfig().server.cors;
    const options = {
        ...(corsConfig?.origins
            ? { origin: corsConfig.origins }
            : {
                  origin: (origin: any, callback: any) => {
                      callback(null, true);
                  }
              }),
        ...(corsConfig?.methods && { methods: corsConfig.methods }),
        ...(corsConfig?.allowed_headers && {
            allowedHeaders: corsConfig.allowed_headers
        }),
        credentials: !(corsConfig?.credentials === false)
    };

    if (build == "oss" || !corsConfig) {
        logger.debug("Using CORS options", options);
        apiServer.use(cors(options));
    } else if (corsConfig) {
        // Use the custom CORS middleware with loginPage support
        apiServer.use(corsWithLoginPageSupport(corsConfig));
    }

    if (!dev) {
        apiServer.use(helmet());
        apiServer.use(csrfProtectionMiddleware);
    }

    apiServer.use(stripDuplicateSesions);
    apiServer.use(cookieParser());
    apiServer.use(express.json());

    // Add request timeout middleware
    apiServer.use(requestTimeoutMiddleware(60000)); // 60 second timeout

    apiServer.use(logIncomingMiddleware);

    if (build !== "oss") {
        apiServer.use(`${prefix}/hybrid`, hybridRouter); // put before rate limiting because we will rate limit there separately because some of the routes are heavily used
    }

    if (!dev) {
        apiServer.use(
            rateLimit({
                windowMs:
                    config.getRawConfig().rate_limits.global.window_minutes *
                    60 *
                    1000,
                max: config.getRawConfig().rate_limits.global.max_requests,
                keyGenerator: (req) =>
                    `apiServerGlobal:${ipKeyGenerator(req.ip || "")}:${req.path}`,
                handler: (req, res, next) => {
                    const message = `Rate limit exceeded. You can make ${config.getRawConfig().rate_limits.global.max_requests} requests every ${config.getRawConfig().rate_limits.global.window_minutes} minute(s).`;
                    return next(
                        createHttpError(HttpCode.TOO_MANY_REQUESTS, message)
                    );
                },
                store: createStore()
            })
        );
    }

    // API routes
    apiServer.use(prefix, unauthenticated);
    apiServer.use(prefix, authenticated);

    // WebSocket routes
    apiServer.use(prefix, wsRouter);

    // Error handling
    apiServer.use(notFoundMiddleware);
    apiServer.use(errorHandlerMiddleware);

    // Create HTTP server
    const httpServer = apiServer.listen(externalPort, (err?: any) => {
        if (err) throw err;
        logger.info(
            `API server is running on http://localhost:${externalPort}`
        );
    });

    // Handle WebSocket upgrades
    handleWSUpgrade(httpServer);

    return httpServer;
}
