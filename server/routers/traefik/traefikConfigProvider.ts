import { Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import config from "@server/lib/config";
import { build } from "@server/build";
import { getTraefikConfig } from "#dynamic/lib/traefik";
import { getCurrentExitNodeId } from "@server/lib/exitNodes";

const badgerMiddlewareName = "badger";

let warnedMissingToken = false;

// The config lists every org's backends, header values and gateway trust
// tokens, so only Traefik may read it once a token is configured.
function isAuthorizedConfigRequest(req: Request): boolean {
    const token = config.getRawConfig().traefik.config_token;
    if (!token) {
        if (!warnedMissingToken) {
            warnedMissingToken = true;
            logger.warn(
                "traefik.config_token is not set: GET /api/v1/traefik-config is readable by anything that can reach the internal port. Set it and add the same bearer token to Traefik's HTTP provider headers."
            );
        }
        return true;
    }
    const header = req.headers.authorization ?? "";
    const expected = `Bearer ${token}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function traefikConfigProvider(
    req: Request,
    res: Response
): Promise<any> {
    if (!isAuthorizedConfigRequest(req)) {
        return res
            .status(HttpCode.UNAUTHORIZED)
            .json({ error: "Unauthorized" });
    }
    try {
        // First query to get resources with site and org info
        // Get the current exit node name from config
        const currentExitNodeId = await getCurrentExitNodeId();

        const maintenancePort = config.getRawConfig().server.next_port;
        const maintenanceHost = config.getRawConfig().server.internal_hostname;
        const pangolinUIUrl = `http://${maintenanceHost}:${maintenancePort}`;
        const aiGatewayUrl =
            config.getRawConfig().server.ai_gateway_override ||
            `http://${maintenanceHost}:${
                config.getRawConfig().server.ai_gateway_port
            }`;

        const traefikConfig = await getTraefikConfig(
            currentExitNodeId,
            config.getRawConfig().traefik.site_types,
            build === "oss", // filter out the namespace domains in open source
            build !== "oss", // generate the login pages on the cloud and and enterprise,
            config.getRawConfig().traefik.allow_raw_resources,
            pangolinUIUrl,
            pangolinUIUrl,
            aiGatewayUrl
        );

        if (traefikConfig?.http?.middlewares) {
            // BECAUSE SOMETIMES THE CONFIG CAN BE EMPTY IF THERE IS NOTHING
            traefikConfig.http.middlewares[badgerMiddlewareName] = {
                plugin: {
                    [badgerMiddlewareName]: {
                        apiBaseUrl:
                            config.getRawConfig().server.badger_override ||
                            new URL(
                                "/api/v1",
                                `http://${
                                    config.getRawConfig().server
                                        .internal_hostname
                                }:${config.getRawConfig().server.internal_port}`
                            ).href,
                        disableDefaultCFIPs:
                            config.getRawConfig().server.trust_ips.length > 0,
                        customIPHeader:
                            config.getRawConfig().server.custom_ip_header,
                        trustip: config.getRawConfig().server.trust_ips,

                        userSessionCookieName:
                            config.getRawConfig().server.session_cookie_name,

                        accessTokenQueryParam:
                            config.getRawConfig().server
                                .resource_access_token_param,

                        accessTokenIdHeader:
                            config.getRawConfig().server
                                .resource_access_token_headers.id,

                        accessTokenHeader:
                            config.getRawConfig().server
                                .resource_access_token_headers.token,

                        resourceSessionRequestParam:
                            config.getRawConfig().server
                                .resource_session_request_param,

                        remoteUserIdHeader:
                            config.getRawConfig().server.remote_headers.user_id,

                        remoteVirtualApiKeyIdHeader:
                            config.getRawConfig().server.remote_headers
                                .virtual_api_key_id,

                        remoteUserHeader:
                            config.getRawConfig().server.remote_headers.user,

                        remoteEmailHeader:
                            config.getRawConfig().server.remote_headers.email,

                        remoteNameHeader:
                            config.getRawConfig().server.remote_headers.name,

                        remoteRoleHeader:
                            config.getRawConfig().server.remote_headers.role
                    }
                }
            };
        }

        return res.status(HttpCode.OK).json(traefikConfig);
    } catch (e) {
        logger.error(e);
        return res.status(HttpCode.INTERNAL_SERVER_ERROR).json({
            error: "Failed to build Traefik config"
        });
    }
}
