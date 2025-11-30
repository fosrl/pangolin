import * as fs from "fs";
import * as path from "path";
import config from "@server/lib/config";
import logger from "@server/logger";
import * as yaml from "js-yaml";
import axios from "axios";
import { db, exitNodes } from "@server/db";
import { eq } from "drizzle-orm";
import { getCurrentExitNodeId } from "@server/lib/exitNodes";
import { getTraefikConfig } from "#dynamic/lib/traefik";
import { getValidCertificatesForDomains } from "#dynamic/lib/certificates";
import { sendToExitNode } from "#dynamic/lib/exitNodes";
import { build } from "@server/build";

export class TraefikConfigManager {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;
    private activeDomains = new Set<string>();
    private timeoutId: NodeJS.Timeout | null = null;
    private lastCertificateFetch: Date | null = null;
    private lastKnownDomains = new Set<string>();
    private lastLocalCertificateState = new Map<
        string,
        {
            exists: boolean;
            lastModified: number | null;
            expiresAt: number | null;
            wildcard: boolean | null;
        }
    >();

    constructor() {}

    /**
     * Start monitoring certificates
     */
    private scheduleNextExecution(): void {
        const intervalMs = config.getRawConfig().traefik.monitor_interval;
        const now = Date.now();
        const nextExecution = Math.ceil(now / intervalMs) * intervalMs;
        const delay = nextExecution - now;

        this.timeoutId = setTimeout(async () => {
            try {
                await this.HandleTraefikConfig();
            } catch (error) {
                logger.error("Error during certificate monitoring:", error);
            }

            if (this.isRunning) {
                this.scheduleNextExecution(); // Schedule the next execution
            }
        }, delay);
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            logger.info("Certificate monitor is already running");
            return;
        }
        this.isRunning = true;
        logger.info(`Starting certificate monitor for exit node`);

        // Ensure certificates directory exists
        await this.ensureDirectoryExists(
            config.getRawConfig().traefik.certificates_path
        );

        // Initialize local certificate state
        this.lastLocalCertificateState = await this.scanLocalCertificateState();
        logger.info(
            `Found ${this.lastLocalCertificateState.size} existing certificate directories`
        );

        // Run initial check
        await this.HandleTraefikConfig();

        // Start synchronized scheduling
        this.scheduleNextExecution();

        logger.info(
            `Certificate monitor started with synchronized ${
                config.getRawConfig().traefik.monitor_interval
            }ms interval`
        );
    }
    /**
     * Stop monitoring certificates
     */
    stop(): void {
        if (!this.isRunning) {
            logger.info("Certificate monitor is not running");
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        logger.info("Certificate monitor stopped");
    }

    /**
     * Scan local certificate directories to build current state
     */
    private async scanLocalCertificateState(): Promise<
        Map<
            string,
            {
                exists: boolean;
                lastModified: number | null;
                expiresAt: number | null;
                wildcard: boolean;
            }
        >
    > {
        const state = new Map();
        const certsPath = config.getRawConfig().traefik.certificates_path;

        try {
            if (!fs.existsSync(certsPath)) {
                return state;
            }

            const certDirs = fs.readdirSync(certsPath, { withFileTypes: true });

            for (const dirent of certDirs) {
                if (!dirent.isDirectory()) continue;

                const domain = dirent.name;
                const domainDir = path.join(certsPath, domain);
                const certPath = path.join(domainDir, "cert.pem");
                const keyPath = path.join(domainDir, "key.pem");
                const lastUpdatePath = path.join(domainDir, ".last_update");
                const wildcardPath = path.join(domainDir, ".wildcard");

                const certExists = await this.fileExists(certPath);
                const keyExists = await this.fileExists(keyPath);
                const lastUpdateExists = await this.fileExists(lastUpdatePath);
                const wildcardExists = await this.fileExists(wildcardPath);

                let lastModified: Date | null = null;
                const expiresAt: Date | null = null;
                let wildcard = false;

                if (lastUpdateExists) {
                    try {
                        const lastUpdateStr = fs
                            .readFileSync(lastUpdatePath, "utf8")
                            .trim();
                        lastModified = new Date(lastUpdateStr);
                    } catch {
                        // If we can't read the last update, fall back to file stats
                        try {
                            const stats = fs.statSync(certPath);
                            lastModified = stats.mtime;
                        } catch {
                            lastModified = null;
                        }
                    }
                }

                // Check if this is a wildcard certificate
                if (wildcardExists) {
                    try {
                        const wildcardContent = fs
                            .readFileSync(wildcardPath, "utf8")
                            .trim();
                        wildcard = wildcardContent === "true";
                    } catch (error) {
                        logger.warn(
                            `Could not read wildcard file for ${domain}:`,
                            error
                        );
                    }
                }

                state.set(domain, {
                    exists: certExists && keyExists,
                    lastModified,
                    expiresAt,
                    wildcard
                });
            }
        } catch (error) {
            logger.error("Error scanning local certificate state:", error);
        }

        return state;
    }

    /**
     * Check if we need to fetch certificates from remote
     */
    private shouldFetchCertificates(currentDomains: Set<string>): boolean {
        // Always fetch on first run
        if (!this.lastCertificateFetch) {
            return true;
        }

        // Fetch if it's been more than 24 hours (for renewals)
        const dayInMs = 24 * 60 * 60 * 1000;
        const timeSinceLastFetch =
            Date.now() - this.lastCertificateFetch.getTime();
        if (timeSinceLastFetch > dayInMs) {
            logger.info("Fetching certificates due to 24-hour renewal check");
            return true;
        }

        // Filter out domains covered by wildcard certificates
        const domainsNeedingCerts = new Set<string>();
        for (const domain of currentDomains) {
            if (
                !isDomainCoveredByWildcard(
                    domain,
                    this.lastLocalCertificateState
                )
            ) {
                domainsNeedingCerts.add(domain);
            }
        }

        // Fetch if domains needing certificates have changed
        const lastDomainsNeedingCerts = new Set<string>();
        for (const domain of this.lastKnownDomains) {
            if (
                !isDomainCoveredByWildcard(
                    domain,
                    this.lastLocalCertificateState
                )
            ) {
                lastDomainsNeedingCerts.add(domain);
            }
        }

        if (
            domainsNeedingCerts.size !== lastDomainsNeedingCerts.size ||
            !Array.from(domainsNeedingCerts).every((domain) =>
                lastDomainsNeedingCerts.has(domain)
            )
        ) {
            logger.info(
                "Fetching certificates due to domain changes (after wildcard filtering)"
            );
            return true;
        }

        // Check if any local certificates are missing or appear to be outdated
        for (const domain of domainsNeedingCerts) {
            const localState = this.lastLocalCertificateState.get(domain);
            if (!localState || !localState.exists) {
                logger.info(
                    `Fetching certificates due to missing local cert for ${domain}`
                );
                return true;
            }

            // Check if certificate is expiring soon (within 30 days)
            if (localState.expiresAt) {
                const daysUntilExpiry =
                    (localState.expiresAt - Math.floor(Date.now() / 1000)) /
                    (1000 * 60 * 60 * 24);
                if (daysUntilExpiry < 30) {
                    logger.info(
                        `Fetching certificates due to upcoming expiry for ${domain} (${Math.round(daysUntilExpiry)} days remaining)`
                    );
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Main monitoring logic
     */
    lastActiveDomains: Set<string> = new Set();
    public async HandleTraefikConfig(): Promise<void> {
        try {
            // Get all active domains for this exit node via HTTP call
            const getTraefikConfig = await this.internalGetTraefikConfig();

            if (!getTraefikConfig) {
                logger.error(
                    "Failed to fetch active domains from traefik config"
                );
                return;
            }

            const { domains, traefikConfig } = getTraefikConfig;

            // Add static domains from config
            // const staticDomains = [config.getRawConfig().app.dashboard_url];
            // staticDomains.forEach((domain) => domains.add(domain));

            // Log if domains changed
            if (
                this.lastActiveDomains.size !== domains.size ||
                !Array.from(this.lastActiveDomains).every((domain) =>
                    domains.has(domain)
                )
            ) {
                logger.info(
                    `Active domains changed for exit node: ${Array.from(domains).join(", ")}`
                );
                this.lastActiveDomains = new Set(domains);
            }

            if (process.env.USE_PANGOLIN_DNS === "true" && build != "oss") {
                // Scan current local certificate state
                this.lastLocalCertificateState =
                    await this.scanLocalCertificateState();

                // Only fetch certificates if needed (domain changes, missing certs, or daily renewal check)
                let validCertificates: Array<{
                    id: number;
                    domain: string;
                    wildcard: boolean | null;
                    certFile: string | null;
                    keyFile: string | null;
                    expiresAt: number | null;
                    updatedAt?: number | null;
                }> = [];

                if (this.shouldFetchCertificates(domains)) {
                    // Filter out domains that are already covered by wildcard certificates
                    const domainsToFetch = new Set<string>();
                    for (const domain of domains) {
                        if (
                            !isDomainCoveredByWildcard(
                                domain,
                                this.lastLocalCertificateState
                            )
                        ) {
                            domainsToFetch.add(domain);
                        } else {
                            logger.debug(
                                `Domain ${domain} is covered by existing wildcard certificate, skipping fetch`
                            );
                        }
                    }

                    if (domainsToFetch.size > 0) {
                        // Get valid certificates for domains not covered by wildcards
                        validCertificates =
                            await getValidCertificatesForDomains(
                                domainsToFetch
                            );
                        this.lastCertificateFetch = new Date();
                        this.lastKnownDomains = new Set(domains);

                        logger.info(
                            `Fetched ${validCertificates.length} certificates from remote (${domains.size - domainsToFetch.size} domains covered by wildcards)`
                        );

                        // Download and decrypt new certificates
                        await this.processValidCertificates(validCertificates);
                    } else {
                        logger.info(
                            "All domains are covered by existing wildcard certificates, no fetch needed"
                        );
                        this.lastCertificateFetch = new Date();
                        this.lastKnownDomains = new Set(domains);
                    }

                    // Always ensure all existing certificates (including wildcards) are in the config
                    await this.updateDynamicConfigFromLocalCerts(domains);
                } else {
                    const timeSinceLastFetch = this.lastCertificateFetch
                        ? Math.round(
                              (Date.now() -
                                  this.lastCertificateFetch.getTime()) /
                                  (1000 * 60)
                          )
                        : 0;

                    // logger.debug(
                    //     `Skipping certificate fetch - no changes detected and within 24-hour window (last fetch: ${timeSinceLastFetch} minutes ago)`
                    // );

                    // Still need to ensure config is up to date with existing certificates
                    await this.updateDynamicConfigFromLocalCerts(domains);
                }

                // Clean up certificates for domains no longer in use
                await this.cleanupUnusedCertificates(domains);

                // wait 1 second for traefik to pick up the new certificates
                await new Promise((resolve) => setTimeout(resolve, 500));
            }

            // Write traefik config as YAML to a second dynamic config file if changed
            await this.writeTraefikDynamicConfig(traefikConfig);

            // Send domains to SNI proxy
            try {
                let exitNode;
                if (config.getRawConfig().gerbil.exit_node_name) {
                    const exitNodeName =
                        config.getRawConfig().gerbil.exit_node_name!;
                    [exitNode] = await db
                        .select()
                        .from(exitNodes)
                        .where(eq(exitNodes.name, exitNodeName))
                        .limit(1);
                } else {
                    [exitNode] = await db.select().from(exitNodes).limit(1);
                }
                if (exitNode) {
                    await sendToExitNode(exitNode, {
                        localPath: "/update-local-snis",
                        method: "POST",
                        data: { fullDomains: Array.from(domains) }
                    });
                } else {
                    logger.error(
                        "No exit node found. Has gerbil registered yet?"
                    );
                }
            } catch (err) {
                logger.error("Failed to post domains to SNI proxy:", err);
            }

            // Update active domains tracking
            this.activeDomains = domains;
        } catch (error) {
            logger.error("Error in traefik config monitoring cycle:", error);
        }
    }

    /**
     * Get all domains currently in use from traefik config API
     */
    private async internalGetTraefikConfig(): Promise<{
        domains: Set<string>;
        traefikConfig: any;
    } | null> {
        let traefikConfig;
        try {
            const currentExitNode = await getCurrentExitNodeId();
            // logger.debug(`Fetching traefik config for exit node: ${currentExitNode}`);
            traefikConfig = await getTraefikConfig(
                // this is called by the local exit node to get its own config
                currentExitNode,
                config.getRawConfig().traefik.site_types,
                build == "oss", // filter out the namespace domains in open source
                build != "oss", // generate the login pages on the cloud and hybrid,
                build == "saas" ? false : config.getRawConfig().traefik.allow_raw_resources // dont allow raw resources on saas otherwise use config
            );

            const domains = new Set<string>();

            if (traefikConfig?.http?.routers) {
                for (const router of Object.values<any>(
                    traefikConfig.http.routers
                )) {
                    if (router.rule && typeof router.rule === "string") {
                        // Match Host(`domain`)
                        const match = router.rule.match(/Host\(`([^`]+)`\)/);
                        if (match && match[1]) {
                            domains.add(match[1]);
                        }
                    }
                }
            }

            // logger.debug(
            //     `Successfully retrieved traefik config: ${JSON.stringify(traefikConfig)}`
            // );

            const badgerMiddlewareName = "badger";
            if (traefikConfig?.http?.middlewares) {
                traefikConfig.http.middlewares[badgerMiddlewareName] = {
                    plugin: {
                        [badgerMiddlewareName]: {
                            apiBaseUrl: new URL(
                                "/api/v1",
                                `http://${
                                    config.getRawConfig().server
                                        .internal_hostname
                                }:${config.getRawConfig().server.internal_port}`
                            ).href,
                            userSessionCookieName:
                                config.getRawConfig().server
                                    .session_cookie_name,

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

            // tcp:
            //     serversTransports:
            //         pp-transport-v1:
            //         proxyProtocol:
            //             version: 1
            //         pp-transport-v2:
            //         proxyProtocol:
            //             version: 2

            if (build != "saas") {
                // add the serversTransports section if not present
                if (traefikConfig.tcp && !traefikConfig.tcp.serversTransports) {
                    traefikConfig.tcp.serversTransports = {
                        "pp-transport-v1": { proxyProtocol: { version: 1 } },
                        "pp-transport-v2": { proxyProtocol: { version: 2 } }
                    };
                }
            }

            return { domains, traefikConfig };
        } catch (error) {
            // pull data out of the axios error to log
            if (axios.isAxiosError(error)) {
                logger.error("Error fetching traefik config:", {
                    message: error.message,
                    code: error.code,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    url: error.config?.url,
                    method: error.config?.method
                });
            } else {
                logger.error("Error fetching traefik config:", error);
            }
            return null;
        }
    }

    /**
     * Write traefik config as YAML to a second dynamic config file if changed
     */
    private async writeTraefikDynamicConfig(traefikConfig: any): Promise<void> {
        const traefikDynamicConfigPath =
            config.getRawConfig().traefik.dynamic_router_config_path;
        let shouldWrite = false;
        let oldJson = "";
        if (fs.existsSync(traefikDynamicConfigPath)) {
            try {
                const oldContent = fs.readFileSync(
                    traefikDynamicConfigPath,
                    "utf8"
                );
                // Try to parse as YAML then JSON.stringify for comparison
                const oldObj = yaml.load(oldContent);
                oldJson = JSON.stringify(oldObj);
            } catch {
                oldJson = "";
            }
        }
        const newJson = JSON.stringify(traefikConfig);
        if (oldJson !== newJson) {
            shouldWrite = true;
        }
        if (shouldWrite) {
            try {
                fs.writeFileSync(
                    traefikDynamicConfigPath,
                    yaml.dump(traefikConfig, { noRefs: true }),
                    "utf8"
                );
                logger.info("Traefik dynamic config updated");
            } catch (err) {
                logger.error("Failed to write traefik dynamic config:", err);
            }
        }
    }

    /**
     * Update dynamic config from existing local certificates without fetching from remote
     */
    private async updateDynamicConfigFromLocalCerts(
        domains: Set<string>
    ): Promise<void> {
        const dynamicConfigPath =
            config.getRawConfig().traefik.dynamic_cert_config_path;

        // Load existing dynamic config if it exists, otherwise initialize
        let dynamicConfig: any = { tls: { certificates: [] } };
        if (fs.existsSync(dynamicConfigPath)) {
            try {
                const fileContent = fs.readFileSync(dynamicConfigPath, "utf8");
                dynamicConfig = yaml.load(fileContent) || dynamicConfig;
                if (!dynamicConfig.tls)
                    dynamicConfig.tls = { certificates: [] };
                if (!Array.isArray(dynamicConfig.tls.certificates)) {
                    dynamicConfig.tls.certificates = [];
                }
            } catch (err) {
                logger.error("Failed to load existing dynamic config:", err);
            }
        }

        // Keep a copy of the original config for comparison
        const originalConfigYaml = yaml.dump(dynamicConfig, { noRefs: true });

        // Clear existing certificates and rebuild from local state
        dynamicConfig.tls.certificates = [];

        // Keep track of certificates we've already added to avoid duplicates
        const addedCertPaths = new Set<string>();

        for (const domain of domains) {
            // First, try to find an exact match certificate
            const localState = this.lastLocalCertificateState.get(domain);
            if (localState && localState.exists) {
                const domainDir = path.join(
                    config.getRawConfig().traefik.certificates_path,
                    domain
                );
                const certPath = path.join(domainDir, "cert.pem");
                const keyPath = path.join(domainDir, "key.pem");

                if (!addedCertPaths.has(certPath)) {
                    const certEntry = {
                        certFile: certPath,
                        keyFile: keyPath
                    };
                    dynamicConfig.tls.certificates.push(certEntry);
                    addedCertPaths.add(certPath);
                }
                continue;
            }

            // If no exact match, check for wildcard certificates that cover this domain
            for (const [certDomain, certState] of this
                .lastLocalCertificateState) {
                if (certState.exists && certState.wildcard) {
                    // Check if this wildcard certificate covers the domain
                    if (domain.endsWith("." + certDomain)) {
                        // Verify it's only one level deep (wildcard only covers one level)
                        const prefix = domain.substring(
                            0,
                            domain.length - ("." + certDomain).length
                        );
                        if (!prefix.includes(".")) {
                            const domainDir = path.join(
                                config.getRawConfig().traefik.certificates_path,
                                certDomain
                            );
                            const certPath = path.join(domainDir, "cert.pem");
                            const keyPath = path.join(domainDir, "key.pem");

                            if (!addedCertPaths.has(certPath)) {
                                const certEntry = {
                                    certFile: certPath,
                                    keyFile: keyPath
                                };
                                dynamicConfig.tls.certificates.push(certEntry);
                                addedCertPaths.add(certPath);
                            }
                            break; // Found a wildcard that covers this domain
                        }
                    }
                }
            }
        }

        // Only write the config if it has changed
        const newConfigYaml = yaml.dump(dynamicConfig, { noRefs: true });
        if (newConfigYaml !== originalConfigYaml) {
            fs.writeFileSync(dynamicConfigPath, newConfigYaml, "utf8");
            logger.info("Dynamic cert config updated from local certificates");
        }
    }

    /**
     * Process valid certificates - download and decrypt them
     */
    private async processValidCertificates(
        validCertificates: Array<{
            id: number;
            domain: string;
            wildcard: boolean | null;
            certFile: string | null;
            keyFile: string | null;
            expiresAt: number | null;
            updatedAt?: number | null;
        }>
    ): Promise<void> {
        const dynamicConfigPath =
            config.getRawConfig().traefik.dynamic_cert_config_path;

        // Load existing dynamic config if it exists, otherwise initialize
        let dynamicConfig: any = { tls: { certificates: [] } };
        if (fs.existsSync(dynamicConfigPath)) {
            try {
                const fileContent = fs.readFileSync(dynamicConfigPath, "utf8");
                dynamicConfig = yaml.load(fileContent) || dynamicConfig;
                if (!dynamicConfig.tls)
                    dynamicConfig.tls = { certificates: [] };
                if (!Array.isArray(dynamicConfig.tls.certificates)) {
                    dynamicConfig.tls.certificates = [];
                }
            } catch (err) {
                logger.error("Failed to load existing dynamic config:", err);
            }
        }

        // Keep a copy of the original config for comparison
        const originalConfigYaml = yaml.dump(dynamicConfig, { noRefs: true });

        for (const cert of validCertificates) {
            try {
                if (
                    !cert.certFile ||
                    !cert.keyFile ||
                    cert.certFile.length === 0 ||
                    cert.keyFile.length === 0
                ) {
                    logger.warn(
                        `Certificate for domain ${cert.domain} is missing cert or key file`
                    );
                    continue;
                }

                const domainDir = path.join(
                    config.getRawConfig().traefik.certificates_path,
                    cert.domain
                );
                await this.ensureDirectoryExists(domainDir);

                const certPath = path.join(domainDir, "cert.pem");
                const keyPath = path.join(domainDir, "key.pem");
                const lastUpdatePath = path.join(domainDir, ".last_update");

                // Check if we need to update the certificate
                const shouldUpdate = await this.shouldUpdateCertificate(
                    cert,
                    certPath,
                    keyPath,
                    lastUpdatePath
                );

                if (shouldUpdate) {
                    logger.info(
                        `Processing certificate for domain: ${cert.domain}`
                    );

                    fs.writeFileSync(certPath, cert.certFile, "utf8");
                    fs.writeFileSync(keyPath, cert.keyFile, "utf8");

                    // Set appropriate permissions (readable by owner only for key file)
                    fs.chmodSync(certPath, 0o644);
                    fs.chmodSync(keyPath, 0o600);

                    // Write/update .last_update file with current timestamp
                    fs.writeFileSync(
                        lastUpdatePath,
                        new Date().toISOString(),
                        "utf8"
                    );

                    // Check if this is a wildcard certificate and store it
                    const wildcardPath = path.join(domainDir, ".wildcard");
                    fs.writeFileSync(
                        wildcardPath,
                        cert.wildcard ? "true" : "false",
                        "utf8"
                    );

                    logger.info(
                        `Certificate updated for domain: ${cert.domain}${cert.wildcard ? " (wildcard)" : ""}`
                    );

                    // Update local state tracking
                    this.lastLocalCertificateState.set(cert.domain, {
                        exists: true,
                        lastModified: Math.floor(Date.now() / 1000),
                        expiresAt: cert.expiresAt,
                        wildcard: cert.wildcard
                    });
                }

                // Always ensure the config entry exists and is up to date
                const certEntry = {
                    certFile: certPath,
                    keyFile: keyPath
                };
                // Remove any existing entry for this cert/key path
                dynamicConfig.tls.certificates =
                    dynamicConfig.tls.certificates.filter(
                        (entry: any) =>
                            entry.certFile !== certEntry.certFile ||
                            entry.keyFile !== certEntry.keyFile
                    );
                dynamicConfig.tls.certificates.push(certEntry);
            } catch (error) {
                logger.error(
                    `Error processing certificate for domain ${cert.domain}:`,
                    error
                );
            }
        }

        // Only write the config if it has changed
        const newConfigYaml = yaml.dump(dynamicConfig, { noRefs: true });
        if (newConfigYaml !== originalConfigYaml) {
            fs.writeFileSync(dynamicConfigPath, newConfigYaml, "utf8");
            logger.info("Dynamic cert config updated");
        }
    }

    /**
     * Check if certificate should be updated
     */
    private async shouldUpdateCertificate(
        cert: {
            id: number;
            domain: string;
            expiresAt: number | null;
            updatedAt?: number | null;
        },
        certPath: string,
        keyPath: string,
        lastUpdatePath: string
    ): Promise<boolean> {
        try {
            // If files don't exist, we need to create them
            const certExists = await this.fileExists(certPath);
            const keyExists = await this.fileExists(keyPath);
            const lastUpdateExists = await this.fileExists(lastUpdatePath);

            if (!certExists || !keyExists || !lastUpdateExists) {
                return true;
            }

            // Read last update time from .last_update file
            let lastUpdateTime: number | null = null;
            try {
                const lastUpdateStr = fs
                    .readFileSync(lastUpdatePath, "utf8")
                    .trim();
                lastUpdateTime = Math.floor(
                    new Date(lastUpdateStr).getTime() / 1000
                );
            } catch {
                lastUpdateTime = null;
            }

            // Use updatedAt from cert, fallback to expiresAt if not present
            const dbUpdateTime = cert.updatedAt ?? cert.expiresAt;

            if (!dbUpdateTime) {
                // If no update time in DB, always update
                return true;
            }

            // If DB updatedAt is newer than last update file, update
            if (!lastUpdateTime || dbUpdateTime > lastUpdateTime) {
                return true;
            }

            return false;
        } catch (error) {
            logger.error(
                `Error checking certificate update status for ${cert.domain}:`,
                error
            );
            return true; // When in doubt, update
        }
    }

    /**
     * Clean up certificates for domains no longer in use
     */
    private async cleanupUnusedCertificates(
        currentActiveDomains: Set<string>
    ): Promise<void> {
        try {
            const certsPath = config.getRawConfig().traefik.certificates_path;
            const dynamicConfigPath =
                config.getRawConfig().traefik.dynamic_cert_config_path;

            // Load existing dynamic config if it exists
            let dynamicConfig: any = { tls: { certificates: [] } };
            if (fs.existsSync(dynamicConfigPath)) {
                try {
                    const fileContent = fs.readFileSync(
                        dynamicConfigPath,
                        "utf8"
                    );
                    dynamicConfig = yaml.load(fileContent) || dynamicConfig;
                    if (!dynamicConfig.tls)
                        dynamicConfig.tls = { certificates: [] };
                    if (!Array.isArray(dynamicConfig.tls.certificates)) {
                        dynamicConfig.tls.certificates = [];
                    }
                } catch (err) {
                    logger.error(
                        "Failed to load existing dynamic config:",
                        err
                    );
                }
            }

            const certDirs = fs.readdirSync(certsPath, {
                withFileTypes: true
            });

            let configChanged = false;

            for (const dirent of certDirs) {
                if (!dirent.isDirectory()) continue;

                const dirName = dirent.name;
                // Only delete if NO current domain is exactly the same or ends with `.${dirName}`
                const shouldDelete = !Array.from(currentActiveDomains).some(
                    (domain) =>
                        domain === dirName || domain.endsWith(`.${dirName}`)
                );

                if (shouldDelete) {
                    const domainDir = path.join(certsPath, dirName);
                    logger.info(
                        `Cleaning up unused certificate directory: ${dirName}`
                    );
                    fs.rmSync(domainDir, { recursive: true, force: true });

                    // Remove from local state tracking
                    this.lastLocalCertificateState.delete(dirName);

                    // Remove from dynamic config
                    const certFilePath = path.join(domainDir, "cert.pem");
                    const keyFilePath = path.join(domainDir, "key.pem");
                    const before = dynamicConfig.tls.certificates.length;
                    dynamicConfig.tls.certificates =
                        dynamicConfig.tls.certificates.filter(
                            (entry: any) =>
                                entry.certFile !== certFilePath &&
                                entry.keyFile !== keyFilePath
                        );
                    if (dynamicConfig.tls.certificates.length !== before) {
                        configChanged = true;
                    }
                }
            }

            if (configChanged) {
                try {
                    fs.writeFileSync(
                        dynamicConfigPath,
                        yaml.dump(dynamicConfig, { noRefs: true }),
                        "utf8"
                    );
                    logger.info("Dynamic config updated after cleanup");
                } catch (err) {
                    logger.error(
                        "Failed to update dynamic config after cleanup:",
                        err
                    );
                }
            }
        } catch (error) {
            logger.error("Error during certificate cleanup:", error);
        }
    }

    /**
     * Ensure directory exists
     */
    private async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            fs.mkdirSync(dirPath, { recursive: true });
        } catch (error) {
            logger.error(`Error creating directory ${dirPath}:`, error);
            throw error;
        }
    }

    /**
     * Check if file exists
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            fs.accessSync(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Force a certificate refresh regardless of cache state
     */
    public async forceCertificateRefresh(): Promise<void> {
        logger.info("Forcing certificate refresh");
        this.lastCertificateFetch = null;
        this.lastKnownDomains = new Set();
        await this.HandleTraefikConfig();
    }

    /**
     * Get current status
     */
    getStatus(): {
        isRunning: boolean;
        activeDomains: string[];
        monitorInterval: number;
        lastCertificateFetch: Date | null;
        localCertificateCount: number;
        wildcardCertificates: string[];
        domainsCoveredByWildcards: string[];
    } {
        const wildcardCertificates: string[] = [];
        const domainsCoveredByWildcards: string[] = [];

        // Find wildcard certificates
        for (const [domain, state] of this.lastLocalCertificateState) {
            if (state.exists && state.wildcard) {
                wildcardCertificates.push(domain);
            }
        }

        // Find domains covered by wildcards
        for (const domain of this.activeDomains) {
            if (
                isDomainCoveredByWildcard(
                    domain,
                    this.lastLocalCertificateState
                )
            ) {
                domainsCoveredByWildcards.push(domain);
            }
        }

        return {
            isRunning: this.isRunning,
            activeDomains: Array.from(this.activeDomains),
            monitorInterval:
                config.getRawConfig().traefik.monitor_interval || 5000,
            lastCertificateFetch: this.lastCertificateFetch,
            localCertificateCount: this.lastLocalCertificateState.size,
            wildcardCertificates,
            domainsCoveredByWildcards
        };
    }
}

/**
 * Check if a domain is covered by existing wildcard certificates
 */
export function isDomainCoveredByWildcard(
    domain: string,
    lastLocalCertificateState: Map<
        string,
        { exists: boolean; wildcard: boolean | null }
    >
): boolean {
    for (const [certDomain, state] of lastLocalCertificateState) {
        if (state.exists && state.wildcard) {
            // If stored as example.com but is wildcard, check subdomains
            if (domain.endsWith("." + certDomain)) {
                // Check that it's only one level deep (wildcard only covers one level)
                const prefix = domain.substring(
                    0,
                    domain.length - ("." + certDomain).length
                );
                // If prefix contains a dot, it's more than one level deep
                if (!prefix.includes(".")) {
                    return true;
                }
            }
        }
    }
    return false;
}
