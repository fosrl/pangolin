import { PostHog } from "posthog-node";
import config from "./config";
import { getHostMeta } from "./hostMeta";
import logger from "@server/logger";
import {
    alertRules,
    apiKeys,
    blueprints,
    db,
    roles,
    siteResources
} from "@server/db";
import { sites, users, orgs, resources, clients, idp } from "@server/db";
import { eq, count, notInArray, and, isNotNull, isNull } from "drizzle-orm";
import { APP_VERSION } from "./consts";
import crypto from "crypto";
import { UserType } from "@server/types/UserTypes";
import { build } from "@server/build";
import license from "@server/license/license";

class TelemetryClient {
    private client: PostHog | null = null;
    private enabled: boolean;
    private intervalId: NodeJS.Timeout | null = null;
    private collectionIntervalDays = 14;

    constructor() {
        const enabled = config.getRawConfig().app.telemetry.anonymous_usage;
        this.enabled = enabled;
        const dev = process.env.ENVIRONMENT !== "prod";

        if (dev) {
            return;
        }

        if (build === "saas") {
            return;
        }

        if (this.enabled) {
            this.client = new PostHog(
                "phc_QYuATSSZt6onzssWcYJbXLzQwnunIpdGGDTYhzK3VjX",
                {
                    host: "https://telemetry.fossorial.io/relay-O7yI"
                }
            );

            process.on("exit", () => {
                this.client?.shutdown();
            });

            this.sendStartupEvents()
                .catch((err) => {
                    logger.error("Failed to send startup telemetry:", err);
                })
                .then(() => {
                    logger.debug("Successfully sent startup telemetry data");
                });

            this.startAnalyticsInterval();

            logger.info(
                "Pangolin gathers anonymous usage data to help us better understand how the software is used and guide future improvements and feature development. You can find more details, including instructions for opting out of this anonymous data collection, at: https://docs.pangolin.net/telemetry"
            );
        } else if (!this.enabled) {
            logger.info(
                "Analytics usage statistics collection is disabled. If you enable this, you can help us make Pangolin better for everyone. Learn more at: https://docs.pangolin.net/telemetry"
            );
        }
    }

    private startAnalyticsInterval() {
        this.intervalId = setInterval(
            () => {
                this.collectAndSendAnalytics()
                    .catch((err) => {
                        logger.error("Failed to collect analytics:", err);
                    })
                    .then(() => {
                        logger.debug("Successfully sent analytics data");
                    });
            },
            this.collectionIntervalDays * 24 * 60 * 60 * 1000 // Convert days to milliseconds
        );

        this.collectAndSendAnalytics().catch((err) => {
            logger.error("Failed to collect initial analytics:", err);
        });
    }

    private anon(value: string): string {
        return crypto
            .createHash("sha256")
            .update(value.toLowerCase())
            .digest("hex");
    }

    private async getSystemStats() {
        try {
            const [sitesCount] = await db
                .select({ count: count() })
                .from(sites);
            const [usersCount] = await db
                .select({ count: count() })
                .from(users);
            const [usersInternalCount] = await db
                .select({ count: count() })
                .from(users)
                .where(eq(users.type, UserType.Internal));
            const [usersOidcCount] = await db
                .select({ count: count() })
                .from(users)
                .where(eq(users.type, UserType.OIDC));
            const [orgsCount] = await db.select({ count: count() }).from(orgs);
            const [resourcesCount] = await db
                .select({ count: count() })
                .from(resources);
            const [userDevicesCount] = await db
                .select({ count: count() })
                .from(clients)
                .where(isNotNull(clients.userId));
            const [machineClients] = await db
                .select({ count: count() })
                .from(clients)
                .where(isNull(clients.userId));
            const [idpCount] = await db.select({ count: count() }).from(idp);
            const [onlineSitesCount] = await db
                .select({ count: count() })
                .from(sites)
                .where(eq(sites.online, true));
            const [numApiKeys] = await db
                .select({ count: count() })
                .from(apiKeys);
            const [customRoles] = await db
                .select({ count: count() })
                .from(roles)
                .where(
                    and(
                        eq(roles.isAdmin, false),
                        notInArray(roles.name, ["Member"])
                    )
                );

            const adminUsers = await db
                .select({ email: users.email })
                .from(users)
                .where(eq(users.serverAdmin, true));

            const resourceDetails = await db
                .select({
                    name: resources.name,
                    sso: resources.sso,
                    mode: resources.mode
                })
                .from(resources);

            const siteDetails = await db
                .select({
                    siteName: sites.name,
                    megabytesIn: sites.megabytesIn,
                    megabytesOut: sites.megabytesOut,
                    type: sites.type,
                    online: sites.online
                })
                .from(sites);

            const [numAlertRules] = await db
                .select({ count: count() })
                .from(alertRules);

            const [blueprintsCount] = await db
                .select({ count: count() })
                .from(blueprints);

            const supporterKey = config.getSupporterData();

            const allPrivateResources = await db.select().from(siteResources);

            const numPrivResources = allPrivateResources.length;
            let numPrivResourceAliases = 0;
            let numPrivResourceHosts = 0;
            let numPrivResourceCidr = 0;
            let numPrivResourceHttp = 0;
            let numPrivResourceSsh = 0;
            for (const res of allPrivateResources) {
                if (res.mode === "host") {
                    numPrivResourceHosts += 1;
                } else if (res.mode === "cidr") {
                    numPrivResourceCidr += 1;
                } else if (res.mode === "http") {
                    numPrivResourceHttp += 1;
                } else if (res.mode === "ssh") {
                    numPrivResourceSsh += 1;
                }

                if (res.alias) {
                    numPrivResourceAliases += 1;
                }
            }

            return {
                numSites: sitesCount.count,
                numUsers: usersCount.count,
                numUsersInternal: usersInternalCount.count,
                numUsersOidc: usersOidcCount.count,
                numOrganizations: orgsCount.count,
                numResources: resourcesCount.count,
                numPrivateResources: numPrivResources,
                numPrivateResourceAliases: numPrivResourceAliases,
                numPrivateResourceHosts: numPrivResourceHosts,
                numPrivateResourceCidr: numPrivResourceCidr,
                numPrivateResourceHttp: numPrivResourceHttp,
                numPrivateResourceSsh: numPrivResourceSsh,
                numAlertRules: numAlertRules.count,
                numUserDevices: userDevicesCount.count,
                numMachineClients: machineClients.count,
                numIdentityProviders: idpCount.count,
                numSitesOnline: onlineSitesCount.count,
                resources: resourceDetails,
                adminUsers: adminUsers.map((u) => u.email),
                sites: siteDetails,
                appVersion: APP_VERSION,
                numApiKeys: numApiKeys.count,
                numCustomRoles: customRoles.count,
                numBlueprints: blueprintsCount.count,
                supporterStatus: {
                    valid: supporterKey?.valid || false,
                    tier: supporterKey?.tier || "None",
                    githubUsername: supporterKey?.githubUsername || null
                }
            };
        } catch (error) {
            logger.error("Failed to collect system stats:", error);
            throw error;
        }
    }

    private async sendStartupEvents() {
        if (!this.enabled || !this.client) return;

        const hostMeta = await getHostMeta();
        if (!hostMeta) return;

        const stats = await this.getSystemStats();

        if (build === "enterprise") {
            const licenseStatus = await license.check();
            const payload = {
                distinctId: hostMeta.hostMetaId,
                event: "enterprise_status",
                properties: {
                    is_host_licensed: licenseStatus.isHostLicensed,
                    is_license_valid: licenseStatus.isLicenseValid,
                    license_tier: licenseStatus.tier || "unknown"
                }
            };
            logger.debug("Sending enterprise startup telemetry payload:", {
                payload
            });
            this.client.capture(payload);
        }

        if (build === "oss") {
            this.client.capture({
                distinctId: hostMeta.hostMetaId,
                event: "supporter_status",
                properties: {
                    valid: stats.supporterStatus.valid,
                    tier: stats.supporterStatus.tier
                }
            });
        }

        this.client.capture({
            distinctId: hostMeta.hostMetaId,
            event: "host_startup",
            properties: {
                host_id: hostMeta.hostMetaId,
                app_version: stats.appVersion,
                install_timestamp: hostMeta.createdAt
            }
        });
    }

    private async collectAndSendAnalytics() {
        if (!this.enabled || !this.client) return;

        try {
            const hostMeta = await getHostMeta();
            if (!hostMeta) {
                logger.warn(
                    "Telemetry: Host meta not found, skipping analytics"
                );
                return;
            }

            const stats = await this.getSystemStats();

            this.client.capture({
                distinctId: hostMeta.hostMetaId,
                event: "system_analytics",
                properties: {
                    app_version: stats.appVersion,
                    num_sites: stats.numSites,
                    num_users: stats.numUsers,
                    num_users_internal: stats.numUsersInternal,
                    num_users_oidc: stats.numUsersOidc,
                    num_organizations: stats.numOrganizations,
                    num_resources: stats.numResources,
                    num_private_resources: stats.numPrivateResources,
                    num_private_resource_aliases:
                        stats.numPrivateResourceAliases,
                    num_private_resource_hosts: stats.numPrivateResourceHosts,
                    num_private_resource_cidr: stats.numPrivateResourceCidr,
                    num_user_devices: stats.numUserDevices,
                    num_machine_clients: stats.numMachineClients,
                    num_identity_providers: stats.numIdentityProviders,
                    num_sites_online: stats.numSitesOnline,
                    num_blueprint_runs: stats.numBlueprints,
                    num_resources_sso_enabled: stats.resources.filter(
                        (r) => r.sso
                    ).length,
                    num_resources_non_http: stats.resources.filter(
                        (r) => r.mode !== "http"
                    ).length,
                    num_newt_sites: stats.sites.filter((s) => s.type === "newt")
                        .length,
                    num_local_sites: stats.sites.filter(
                        (s) => s.type === "local"
                    ).length,
                    num_wg_sites: stats.sites.filter(
                        (s) => s.type === "wireguard"
                    ).length,
                    avg_megabytes_in:
                        stats.sites.length > 0
                            ? Math.round(
                                  stats.sites.reduce(
                                      (sum, s) => sum + (s.megabytesIn ?? 0),
                                      0
                                  ) / stats.sites.length
                              )
                            : 0,
                    avg_megabytes_out:
                        stats.sites.length > 0
                            ? Math.round(
                                  stats.sites.reduce(
                                      (sum, s) => sum + (s.megabytesOut ?? 0),
                                      0
                                  ) / stats.sites.length
                              )
                            : 0,
                    num_api_keys: stats.numApiKeys,
                    num_custom_roles: stats.numCustomRoles
                }
            });
        } catch (error) {
            logger.error("Failed to send analytics:", error);
        }
    }

    async sendTelemetry(eventName: string, properties: Record<string, any>) {
        if (!this.enabled || !this.client) return;

        const hostMeta = await getHostMeta();
        if (!hostMeta) {
            logger.warn("Telemetry: Host meta not found, skipping telemetry");
            return;
        }

        this.client.groupIdentify({
            groupType: "host_id",
            groupKey: hostMeta.hostMetaId,
            properties
        });
    }

    shutdown() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.enabled && this.client) {
            this.client.shutdown();
        }
    }
}

let telemetryClient!: TelemetryClient;

export function initTelemetryClient() {
    if (!telemetryClient) {
        telemetryClient = new TelemetryClient();
    }
    return telemetryClient;
}

export default telemetryClient;
