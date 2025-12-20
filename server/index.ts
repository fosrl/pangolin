#! /usr/bin/env node
import "./extendZod.ts";

import { runSetupFunctions } from "./setup";
import { createApiServer } from "./apiServer";
import { createNextServer } from "./nextServer";
import { createInternalServer } from "./internalServer";
import { createIntegrationApiServer } from "./integrationApiServer";
import {
    ApiKey,
    ApiKeyOrg,
    RemoteExitNode,
    Session,
    SiteResource,
    User,
    UserOrg
} from "@server/db";
import config from "@server/lib/config";
import { setHostMeta } from "@server/lib/hostMeta";
import { initTelemetryClient } from "@server/lib/telemetry";
import { TraefikConfigManager } from "@server/lib/traefik/TraefikConfigManager";
import { initCleanup } from "#dynamic/cleanup";
import license from "#dynamic/license/license";
import { initLogCleanupInterval } from "@server/lib/cleanupLogs";
import { fetchServerIp } from "@server/lib/serverIpService";
import { startMaintenanceServer } from "./lib/traefik/maintenance-server.js";

async function startServers() {
    await setHostMeta();

    await config.initServer();

    license.setServerSecret(config.getRawConfig().server.secret!);
    await license.check();

    await runSetupFunctions();

    await fetchServerIp();

    initTelemetryClient();

    initLogCleanupInterval();

    // Start all servers
    const apiServer = createApiServer();
    const internalServer = createInternalServer();

    const nextServer = await createNextServer();
    if (config.getRawConfig().traefik.file_mode) {
        const monitor = new TraefikConfigManager();
        await monitor.start();
    }

    let integrationServer;
    if (config.getRawConfig().flags?.enable_integration_api) {
        integrationServer = createIntegrationApiServer();
    }

     startMaintenanceServer();

    await initCleanup();

    return {
        apiServer,
        nextServer,
        internalServer,
        integrationServer
    };
}

// Types
declare global {
    namespace Express {
        interface Request {
            apiKey?: ApiKey;
            user?: User;
            session: Session;
            userOrg?: UserOrg;
            apiKeyOrg?: ApiKeyOrg;
            userOrgRoleId?: number;
            userOrgId?: string;
            userOrgIds?: string[];
            remoteExitNode?: RemoteExitNode;
            siteResource?: SiteResource;
            orgPolicyAllowed?: boolean;
        }
    }
}

startServers().catch(console.error);
