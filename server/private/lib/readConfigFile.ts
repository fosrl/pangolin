/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import fs from "fs";
import * as yaml from "js-yaml";
import { privateConfigFilePath1 } from "@server/lib/consts";
import { z } from "zod";
import { colorsSchema } from "@server/lib/colorsSchema";
import { build } from "@server/build";
import { getEnvOrYaml } from "@server/lib/getEnvOrYaml";

const portSchema = z.number().positive().gt(0).lte(65535);

export const privateConfigSchema = z
    .object({
        app: z
            .object({
                region: z.string().optional().default("default"),
                base_domain: z.string().optional(),
                identity_provider_mode: z.enum(["global", "org"]).optional()
            })
            .optional()
            .default({
                region: "default"
            }),
        server: z
            .object({
                reo_client_id: z
                    .string()
                    .optional()
                    .transform(getEnvOrYaml("REO_CLIENT_ID")),
                fossorial_api: z
                    .string()
                    .optional()
                    .default("https://api.fossorial.io"),
                fossorial_api_key: z
                    .string()
                    .optional()
                    .transform(getEnvOrYaml("FOSSORIAL_API_KEY"))
            })
            .optional()
            .prefault({}),
        redis: z
            .object({
                host: z.string(),
                port: portSchema,
                password: z
                    .string()
                    .optional()
                    .transform(getEnvOrYaml("REDIS_PASSWORD")),
                db: z.int().nonnegative().optional().default(0),
                replicas: z
                    .array(
                        z.object({
                            host: z.string(),
                            port: portSchema,
                            password: z.string().optional(),
                            db: z.int().nonnegative().optional().default(0)
                        })
                    )
                    .optional(),
                tls: z
                    .object({
                        rejectUnauthorized: z.boolean().optional().default(true)
                    })
                    .optional(),
                regional_redis: z
                    .object({
                        host: z.string(),
                        port: portSchema,
                        password: z
                            .string()
                            .optional()
                            .transform(getEnvOrYaml("REGIONAL_REDIS_PASSWORD")),
                        db: z.int().nonnegative().optional().default(0),
                        tls: z
                            .object({
                                rejectUnauthorized: z
                                    .boolean()
                                    .optional()
                                    .default(true)
                            })
                            .optional()
                    })
                    .optional()
            })
            .optional(),
        dns: z
            .object({
                enabled: z.boolean().optional().default(false),
                listen_port: z.number(),
                nameserver_name: z.string(),
                cname_extension: z.string(),
                site_extension: z.string(),
                cname_alternate_extensions: z
                    .array(z.string())
                    .optional()
                    .default([]),
                alternate_nameservers: z
                    .array(z.string())
                    .optional()
                    .default([]),
                rate_limit: z
                    .object({
                        enabled: z.boolean().optional().default(true),
                        window_ms: z
                            .number()
                            .int()
                            .min(1000)
                            .max(600000)
                            .optional()
                            .default(60000),
                        max_requests: z
                            .number()
                            .int()
                            .min(50)
                            .max(100000)
                            .optional()
                            .default(1200),
                        max_requests_per_query_type: z
                            .number()
                            .int()
                            .min(10)
                            .max(50000)
                            .optional()
                            .default(600)
                    })
                    .default({
                        enabled: true,
                        window_ms: 60000,
                        max_requests: 1200,
                        max_requests_per_query_type: 600
                    }),
                static_records: z
                    .array(
                        z.object({
                            domain: z.string(),
                            type: z.enum(["TXT", "CNAME", "A", "NS"]),
                            value: z.string(),
                            ttl: z
                                .number()
                                .int()
                                .positive()
                                .optional()
                                .default(300)
                        })
                    )
                    .optional()
                    .default([])
            })
            .optional(),
        gerbil: z
            .object({
                local_exit_node_reachable_at: z
                    .string()
                    .optional()
                    .default("http://gerbil:3004")
            })
            .optional()
            .prefault({}),
        flags: z
            .object({
                enable_redis: z.boolean().optional().default(false),
                use_pangolin_dns: z.boolean().optional().default(false),
                use_org_only_idp: z.boolean().optional(),
                // @deprecated Moved to the public config file as
                // `flags.enable_acme_cert_sync` (server/lib/readConfigFile.ts).
                // Kept here only so existing private config files keep parsing;
                // any value set here is migrated into the public config at
                // startup by PrivateConfig (server/private/lib/config.ts).
                enable_acme_cert_sync: z.boolean().optional(),
                // @deprecated Moved to the public config file as
                // `flags.disable_private_http_placeholder`
                // (server/lib/readConfigFile.ts). Kept here only so existing
                // private config files keep parsing; any value set here is
                // migrated into the public config at startup by PrivateConfig
                // (server/private/lib/config.ts).
                disable_private_http_placeholder: z.boolean().optional()
            })
            .optional()
            .prefault({}),
        acme: z
            .object({
                cert_mode: z
                    .enum(["traefik", "pangolin"])
                    .optional()
                    .default("traefik"),
                // @deprecated Moved to the public config file
                // (server/lib/readConfigFile.ts). Kept here only so existing private
                // config files keep parsing; any value set here is migrated into the
                // public config at startup by PrivateConfig (server/private/lib/config.ts).
                acme_json_path: z.string().optional(),
                // @deprecated Moved to the public config file
                // (server/lib/readConfigFile.ts). Kept here only so existing private
                // config files keep parsing; any value set here is migrated into the
                // public config at startup by PrivateConfig (server/private/lib/config.ts).
                acme_http_endpoint: z.string().optional(),
                // @deprecated Moved to the public config file
                // (server/lib/readConfigFile.ts). Kept here only so existing private
                // config files keep parsing; any value set here is migrated into the
                // public config at startup by PrivateConfig (server/private/lib/config.ts).
                sync_interval_ms: z.number().optional(),
                acme_directory_url: z
                    .string()
                    .url()
                    .default("https://acme-v02.api.letsencrypt.org/directory"),
                contact_email: z.string().email(),
                acme_account_key_path: z
                    .string()
                    .default("./config/account.key"),
                challenge_ttl_ms: z.number().int().positive().default(300000),
                renewal_check_interval_ms: z
                    .number()
                    .int()
                    .positive()
                    .default(3600000),
                new_cert_check_interval_ms: z
                    .number()
                    .int()
                    .positive()
                    .default(60000),
                // Kept safely under Let's Encrypt's ~20 req/s limit since this
                // budget is shared across all pops workers and only covers the
                // request-issuing calls we make directly (not every request
                // acme-client makes internally, e.g. while polling for
                // challenge/order status).
                acme_requests_per_second: z
                    .number()
                    .int()
                    .positive()
                    .default(15),
                dns_check_interval_ms: z
                    .number()
                    .int()
                    .positive()
                    .default(60000),
                domain_reverification_interval_ms: z
                    .number()
                    .int()
                    .positive()
                    .default(3600000), // 1 hour — how often to run the reverification pass
                domain_reverification_window_ms: z
                    .number()
                    .int()
                    .positive()
                    .default(259200000), // 72 hours — how old checkedAt must be before rechecking
                domain_reverification_batch_size: z
                    .number()
                    .int()
                    .positive()
                    .default(20), // max domains to recheck per pass
                dns_resolvers: z
                    .array(z.string())
                    .optional()
                    .default([
                        "8.8.8.8",
                        "1.1.1.1",
                        "9.9.9.9",
                        "208.67.222.222"
                    ])
            })
            .optional(),
        branding: z
            .object({
                app_name: z.string().optional(),
                background_image_path: z.string().optional(),
                colors: z
                    .object({
                        light: colorsSchema.optional(),
                        dark: colorsSchema.optional()
                    })
                    .optional(),
                logo: z
                    .object({
                        light_path: z.string().optional(),
                        dark_path: z.string().optional(),
                        auth_page: z
                            .object({
                                width: z.number().optional(),
                                height: z.number().optional()
                            })
                            .optional(),
                        navbar: z
                            .object({
                                width: z.number().optional(),
                                height: z.number().optional()
                            })
                            .optional()
                    })
                    .optional(),
                footer: z
                    .array(
                        z.object({
                            text: z.string(),
                            href: z.string().optional()
                        })
                    )
                    .optional(),
                hide_auth_layout_footer: z.boolean().optional().default(false),
                hide_powered_by: z.boolean().optional(),
                login_page: z
                    .object({
                        subtitle_text: z.string().optional()
                    })
                    .optional(),
                signup_page: z
                    .object({
                        subtitle_text: z.string().optional()
                    })
                    .optional(),
                resource_auth_page: z
                    .object({
                        show_logo: z.boolean().optional(),
                        hide_powered_by: z.boolean().optional(),
                        title_text: z.string().optional(),
                        subtitle_text: z.string().optional()
                    })
                    .optional(),
                emails: z
                    .object({
                        signature: z.string().optional(),
                        colors: z
                            .object({
                                primary: z.string().optional()
                            })
                            .optional()
                    })
                    .optional()
            })
            .optional(),
        stripe: z
            .object({
                secret_key: z
                    .string()
                    .optional()
                    .transform(getEnvOrYaml("STRIPE_SECRET_KEY")),
                webhook_secret: z
                    .string()
                    .optional()
                    .transform(getEnvOrYaml("STRIPE_WEBHOOK_SECRET"))
                // s3Bucket: z.string(),
                // s3Region: z.string().default("us-east-1"),
                // localFilePath: z.string().optional()
            })
            .optional()
    })
    .transform((data) => {
        // this to maintain backwards compatibility with the old config file
        const identityProviderMode = data.app?.identity_provider_mode;
        const useOrgOnlyIdp = data.flags?.use_org_only_idp;

        if (identityProviderMode !== undefined) {
            return data;
        }
        if (useOrgOnlyIdp === true) {
            return {
                ...data,
                app: { ...data.app, identity_provider_mode: "org" as const }
            };
        }
        if (useOrgOnlyIdp === false) {
            return {
                ...data,
                app: { ...data.app, identity_provider_mode: "global" as const }
            };
        }
        return data;
    });

export function readPrivateConfigFile() {
    if (build == "oss") {
        return {};
    }

    // test if the config file is there
    if (!fs.existsSync(privateConfigFilePath1)) {
        // console.warn(
        //     `Private configuration file not found at ${privateConfigFilePath1}. Using default configuration.`
        // );
        // load the default values of the zod schema and return those
        return privateConfigSchema.parse({});
    }

    const loadConfig = (configPath: string) => {
        try {
            const yamlContent = fs.readFileSync(configPath, "utf8");
            if (yamlContent.trim() === "") {
                return {};
            }
            const config = yaml.load(yamlContent);
            return config;
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(
                    `Error loading configuration file: ${error.message}`
                );
            }
            throw error;
        }
    };

    let environment: any = {};
    if (fs.existsSync(privateConfigFilePath1)) {
        environment = loadConfig(privateConfigFilePath1);
    }

    if (!environment) {
        throw new Error("No private configuration file found.");
    }

    return environment;
}
