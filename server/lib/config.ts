import { z } from "zod";
import { __DIRNAME, APP_VERSION } from "@server/lib/consts";
import { db } from "@server/db";
import { SupporterKey, supporterKey } from "@server/db";
import { eq } from "drizzle-orm";
import { configSchema, readConfigFile } from "./readConfigFile";
import { fromError } from "zod-validation-error";
import { build } from "@server/build";

export class Config {
    private rawConfig!: z.infer<typeof configSchema>;

    supporterData: SupporterKey | null = null;

    supporterHiddenUntil: number | null = null;

    isDev: boolean = process.env.ENVIRONMENT !== "prod";

    constructor() {
        const environment = readConfigFile();

        const {
            data: parsedConfig,
            success,
            error
        } = configSchema.safeParse(environment);

        if (!success) {
            const errors = fromError(error);
            throw new Error(`Invalid configuration file: ${errors}`);
        }

        if (
            // @ts-ignore
            parsedConfig.users ||
            process.env.USERS_SERVERADMIN_EMAIL ||
            process.env.USERS_SERVERADMIN_PASSWORD
        ) {
            console.log(
                "WARNING: Your admin credentials are still in the config file or environment variables. This method of setting admin credentials is no longer supported. It is recommended to remove them."
            );
        }

        process.env.APP_VERSION = APP_VERSION;

        process.env.NEXT_PORT = parsedConfig.server.next_port.toString();
        process.env.SERVER_EXTERNAL_PORT =
            parsedConfig.server.external_port.toString();
        process.env.SERVER_INTERNAL_PORT =
            parsedConfig.server.internal_port.toString();
        process.env.FLAGS_EMAIL_VERIFICATION_REQUIRED = parsedConfig.flags
            ?.require_email_verification
            ? "true"
            : "false";
        process.env.FLAGS_ALLOW_RAW_RESOURCES = parsedConfig.flags
            ?.allow_raw_resources
            ? "true"
            : "false";
        process.env.SESSION_COOKIE_NAME =
            parsedConfig.server.session_cookie_name;
        process.env.EMAIL_ENABLED = parsedConfig.email ? "true" : "false";
        process.env.DISABLE_SIGNUP_WITHOUT_INVITE = parsedConfig.flags
            ?.disable_signup_without_invite
            ? "true"
            : "false";
        process.env.DISABLE_USER_CREATE_ORG = parsedConfig.flags
            ?.disable_user_create_org
            ? "true"
            : "false";
        process.env.RESOURCE_ACCESS_TOKEN_PARAM =
            parsedConfig.server.resource_access_token_param;
        process.env.RESOURCE_ACCESS_TOKEN_HEADERS_ID =
            parsedConfig.server.resource_access_token_headers.id;
        process.env.RESOURCE_ACCESS_TOKEN_HEADERS_TOKEN =
            parsedConfig.server.resource_access_token_headers.token;
        process.env.RESOURCE_SESSION_REQUEST_PARAM =
            parsedConfig.server.resource_session_request_param;
        process.env.DASHBOARD_URL = parsedConfig.app.dashboard_url;
        process.env.FLAGS_DISABLE_LOCAL_SITES = parsedConfig.flags
            ?.disable_local_sites
            ? "true"
            : "false";
        process.env.FLAGS_DISABLE_BASIC_WIREGUARD_SITES = parsedConfig.flags
            ?.disable_basic_wireguard_sites
            ? "true"
            : "false";
        process.env.FLAGS_DISABLE_PRODUCT_HELP_BANNERS = parsedConfig.flags
            ?.disable_product_help_banners
            ? "true"
            : "false";

        process.env.PRODUCT_UPDATES_NOTIFICATION_ENABLED = parsedConfig.app
            .notifications.product_updates
            ? "true"
            : "false";

        process.env.NEW_RELEASES_NOTIFICATION_ENABLED = parsedConfig.app
            .notifications.new_releases
            ? "true"
            : "false";

        if (parsedConfig.server.maxmind_db_path) {
            process.env.MAXMIND_DB_PATH = parsedConfig.server.maxmind_db_path;
        }

        if (parsedConfig.server.maxmind_asn_path) {
            process.env.MAXMIND_ASN_PATH = parsedConfig.server.maxmind_asn_path;
        }

        process.env.DISABLE_ENTERPRISE_FEATURES = parsedConfig.flags
            ?.disable_enterprise_features
            ? "true"
            : "false";

        process.env.FLAGS_DISABLE_VIRTUAL_API_KEYS_UI = parsedConfig.flags
            ?.disable_virtual_api_keys_ui
            ? "true"
            : "false";

        this.rawConfig = parsedConfig;
    }

    public async initServer() {
        if (!this.rawConfig) {
            throw new Error("Config not loaded. Call load() first.");
        }

        await this.checkKeyStatus();
    }

    private async checkKeyStatus() {
        if (build == "oss") {
            this.checkSupporterKey();
        }
    }

    public getRawConfig() {
        return this.rawConfig;
    }

    public getNoReplyEmail(): string | undefined {
        return (
            this.rawConfig.email?.no_reply || this.rawConfig.email?.smtp_user
        );
    }

    public getDomain(domainId: string) {
        if (!this.rawConfig.domains || !this.rawConfig.domains[domainId]) {
            return null;
        }
        return this.rawConfig.domains[domainId];
    }

    public hideSupporterKey(days: number = 7) {
        const now = new Date().getTime();

        if (this.supporterHiddenUntil && now < this.supporterHiddenUntil) {
            return;
        }

        this.supporterHiddenUntil = now + 1000 * 60 * 60 * 24 * days;
    }

    public isSupporterKeyHidden() {
        const now = new Date().getTime();

        if (this.supporterHiddenUntil && now < this.supporterHiddenUntil) {
            return true;
        }

        return false;
    }

    public async checkSupporterKey() {
        const [key] = await db.select().from(supporterKey).limit(1);

        if (!key) {
            return;
        }

        const { key: licenseKey, githubUsername } = key;

        try {
            const response = await fetch(
                `https://api.fossorial.io/api/v1/license/validate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        licenseKey,
                        githubUsername
                    })
                }
            );

            if (!response.ok) {
                this.supporterData = key;
                return;
            }

            const data = await response.json();

            if (!data.data.valid) {
                this.supporterData = {
                    ...key,
                    valid: false
                };
                return;
            }

            this.supporterData = {
                ...key,
                tier: data.data.tier,
                valid: true
            };

            // update the supporter key in the database
            await db
                .update(supporterKey)
                .set({
                    tier: data.data.tier || null,
                    phrase: data.data.cutePhrase || null,
                    valid: true
                })
                .where(eq(supporterKey.keyId, key.keyId));
        } catch (e) {
            this.supporterData = key;
            console.error("Failed to validate supporter key", e);
        }
    }

    public getSupporterData() {
        return this.supporterData;
    }
}

export const config = new Config();

export default config;
