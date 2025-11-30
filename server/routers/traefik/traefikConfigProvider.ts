import { Request, Response } from "express";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import config from "@server/lib/config";
import { build } from "@server/build";
import { getTraefikConfig } from "#dynamic/lib/traefik";
import { getCurrentExitNodeId } from "@server/lib/exitNodes";

const badgerMiddlewareName = "badger";

export async function traefikConfigProvider(
    _: Request,
    res: Response
): Promise<any> {
    try {
        // First query to get resources with site and org info
        // Get the current exit node name from config
        const currentExitNodeId = await getCurrentExitNodeId();

        const traefikConfig = await getTraefikConfig(
            currentExitNodeId,
            config.getRawConfig().traefik.site_types,
            build == "oss", // filter out the namespace domains in open source
            build != "oss", // generate the login pages on the cloud and and enterprise,
            config.getRawConfig().traefik.allow_raw_resources
        );

        if (traefikConfig?.http?.middlewares) {
            // BECAUSE SOMETIMES THE CONFIG CAN BE EMPTY IF THERE IS NOTHING
            traefikConfig.http.middlewares[badgerMiddlewareName] = {
                plugin: {
                    [badgerMiddlewareName]: {
                        apiBaseUrl: new URL(
                            "/api/v1",
                            `http://${
                                config.getRawConfig().server.internal_hostname
                            }:${config.getRawConfig().server.internal_port}`
                        ).href,
                        userSessionCookieName:
                            config.getRawConfig().server.session_cookie_name,

                        // deprecated
                        accessTokenQueryParam:
                            config.getRawConfig().server
                                .resource_access_token_param,

                        resourceSessionRequestParam:
                            config.getRawConfig().server
                                .resource_session_request_param
                    }
                }
            };
        }

        return res.status(HttpCode.OK).json(traefikConfig);
    } catch (e) {
        logger.error(`Failed to build Traefik config: ${e}`);
        return res.status(HttpCode.INTERNAL_SERVER_ERROR).json({
            error: "Failed to build Traefik config"
        });
    }
}