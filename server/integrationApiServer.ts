import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import config from "@server/lib/config";
import logger from "@server/logger";
import {
    errorHandlerMiddleware,
    notFoundMiddleware
} from "@server/middlewares";
import { authenticated, unauthenticated } from "#dynamic/routers/integration";
import { logIncomingMiddleware } from "./middlewares/logIncoming";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry, openApiTags } from "./openApi";
import fs from "fs";
import path from "path";
import { APP_PATH } from "./lib/consts";
import yaml from "js-yaml";
import { z } from "zod";

const dev = process.env.ENVIRONMENT !== "prod";
const externalPort = config.getRawConfig().server.integration_port;

export function createIntegrationApiServer() {
    const apiServer = express();

    const trustProxy = config.getRawConfig().server.trust_proxy;
    if (trustProxy) {
        apiServer.set("trust proxy", trustProxy);
    }

    apiServer.use(cors());

    if (!dev) {
        apiServer.use(helmet());
    }

    apiServer.use(cookieParser());
    apiServer.use(express.json());

    const openApiDocumentation = getOpenApiDocumentation();

    apiServer.use(
        "/v1/docs",
        swaggerUi.serve,
        swaggerUi.setup(openApiDocumentation)
    );

    // Unauthenticated OpenAPI spec endpoints
    apiServer.get("/v1/openapi.json", (_req, res) => {
        res.json(openApiDocumentation);
    });

    apiServer.get("/v1/openapi.yaml", (_req, res) => {
        const yamlOutput = yaml.dump(openApiDocumentation);
        res.type("application/yaml").send(yamlOutput);
    });

    // API routes
    const prefix = `/v1`;
    apiServer.use(logIncomingMiddleware);
    apiServer.use(prefix, unauthenticated);
    apiServer.use(prefix, authenticated);

    // Error handling
    apiServer.use(notFoundMiddleware);
    apiServer.use(errorHandlerMiddleware);

    // Create HTTP server
    const httpServer = apiServer.listen(externalPort, (err?: any) => {
        if (err) throw err;
        logger.info(
            `Integration API server is running on http://localhost:${externalPort}`
        );
    });

    return httpServer;
}

function getOpenApiDocumentation() {
    const bearerAuth = registry.registerComponent(
        "securitySchemes",
        "Bearer Auth",
        {
            type: "http",
            scheme: "bearer"
        }
    );

    registry.registerPath({
        method: "get",
        path: "/",
        description: "Health check",
        tags: [],
        request: {},
        responses: {}
    });

    registry.registerPath({
        method: "get",
        path: "/openapi.json",
        description: "Get OpenAPI specification as JSON",
        tags: [],
        request: {},
        responses: {
            "200": {
                description: "OpenAPI specification as JSON",
                content: {
                    "application/json": {
                        schema: {
                            type: "object"
                        }
                    }
                }
            }
        }
    });

    registry.registerPath({
        method: "get",
        path: "/openapi.yaml",
        description: "Get OpenAPI specification as YAML",
        tags: [],
        request: {},
        responses: {
            "200": {
                description: "OpenAPI specification as YAML",
                content: {
                    "application/yaml": {
                        schema: {
                            type: "string"
                        }
                    }
                }
            }
        }
    });

    for (const def of registry.definitions) {
        if (def.type === "route") {
            def.route.security = [
                {
                    [bearerAuth.name]: []
                }
            ];

            // Ensure every route has a generic JSON response schema so Swagger UI can render responses
            const existingResponses = def.route.responses;
            const hasExistingResponses =
                existingResponses && Object.keys(existingResponses).length > 0;

            if (!hasExistingResponses) {
                def.route.responses = {
                    "200": {
                        description: "Successful response",
                        content: {
                            "application/json": {
                                schema: z.object({
                                    data: z
                                        .record(z.string(), z.any())
                                        .nullable(),
                                    success: z.boolean(),
                                    error: z.boolean(),
                                    message: z.string(),
                                    status: z.number()
                                })
                            }
                        }
                    }
                };
            }
        }
    }

    const generator = new OpenApiGeneratorV3(registry.definitions);

    const generated = generator.generateDocument({
        openapi: "3.0.0",
        info: {
            version: "v1",
            title: "Pangolin Integration API"
        },
        servers: [{ url: "/v1" }],
        tags: openApiTags
    });

    if (!process.env.DISABLE_GEN_OPENAPI) {
        // convert to yaml and save to file
        const outputPath = path.join(APP_PATH, "openapi.yaml");
        const yamlOutput = yaml.dump(generated);
        fs.writeFileSync(outputPath, yamlOutput, "utf8");
        logger.info(`OpenAPI documentation saved to ${outputPath}`);
    }

    return generated;
}
