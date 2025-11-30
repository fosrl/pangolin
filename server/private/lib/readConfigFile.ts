/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import fs from "fs";
import yaml from "js-yaml";
import { privateConfigFilePath1 } from "@server/lib/consts";
import { z } from "zod";
import { colorsSchema } from "@server/lib/colorsSchema";
import { build } from "@server/build";

const portSchema = z.number().positive().gt(0).lte(65535);

export const privateConfigSchema = z.object({
    app: z
        .object({
            region: z.string().optional().default("default"),
            base_domain: z.string().optional()
        })
        .optional()
        .default({
            region: "default"
        }),
    server: z
        .object({
            encryption_key_path: z
                .string()
                .optional()
                .default("./config/encryption.pem")
                .pipe(z.string().min(8)),
            resend_api_key: z.string().optional(),
            reo_client_id: z.string().optional(),
            fossorial_api_key: z.string().optional()
        })
        .optional()
        .default({
            encryption_key_path: "./config/encryption.pem"
        }),
    redis: z
        .object({
            host: z.string(),
            port: portSchema,
            password: z.string().optional(),
            db: z.number().int().nonnegative().optional().default(0),
            replicas: z
                .array(
                    z.object({
                        host: z.string(),
                        port: portSchema,
                        password: z.string().optional(),
                        db: z.number().int().nonnegative().optional().default(0)
                    })
                )
                .optional()
            // tls: z
            //     .object({
            //         reject_unauthorized: z
            //             .boolean()
            //             .optional()
            //             .default(true)
            //     })
            //     .optional()
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
        .default({}),
    flags: z
        .object({
            enable_redis: z.boolean().optional().default(false),
            use_pangolin_dns: z.boolean().optional().default(false)
        })
        .optional()
        .default({}),
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
            favicon_path: z.string().optional(),
            footer: z
                .array(
                    z.object({
                        text: z.string(),
                        href: z.string().optional()
                    })
                )
                .optional(),
            login_page: z
                .object({
                    subtitle_text: z.string().optional(),
                    title_text: z.string().optional()
                })
                .optional(),
            signup_page: z
                .object({
                    subtitle_text: z.string().optional(),
                    title_text: z.string().optional()
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
            secret_key: z.string(),
            webhook_secret: z.string(),
            s3Bucket: z.string(),
            s3Region: z.string().default("us-east-1"),
            localFilePath: z.string()
        })
        .optional()
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
