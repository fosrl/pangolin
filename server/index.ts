#! /usr/bin/env node
import "./extendZod";

import { runSetupFunctions } from "./setup";
import { createApiServer } from "./apiServer";
import { createNextServer } from "./nextServer";
import { createInternalServer } from "./internalServer";
import { createAiGatewayServer } from "./aiGatewayServer";
import { createIntegrationApiServer } from "./integrationApiServer";
import {
    ApiKey,
    ApiKeyOrg,
    AiBudget,
    AiModel,
    AiProvider,
    RemoteExitNode,
    Session,
    SiteResource,
    User,
    UserOrg,
    VirtualApiKey
} from "@server/db";
import config from "@server/lib/config";
import { setHostMeta } from "@server/lib/hostMeta";
import { TraefikConfigManager } from "@server/lib/traefik/TraefikConfigManager";
import { initCleanup } from "#dynamic/cleanup";
import { startSchedulers } from "#dynamic/startSchedulers";
import license from "#dynamic/license/license";
import { fetchServerIp } from "@server/lib/serverIpService";
import { initAiModelCatalog } from "@server/lib/aiModelCatalog";

async function startServers() {
    await setHostMeta();

    await config.initServer();

    license.setServerSecret(config.getRawConfig().server.secret!);
    await license.check();

    await runSetupFunctions();

    await fetchServerIp();

    await initAiModelCatalog();

    startSchedulers();

    // Start all servers
    const apiServer = createApiServer();
    const internalServer = createInternalServer();
    const aiGatewayServer = createAiGatewayServer();

    const nextServer = await createNextServer();
    if (config.getRawConfig().traefik.file_mode) {
        const monitor = new TraefikConfigManager();
        await monitor.start();
    }

    let integrationServer;
    if (config.getRawConfig().flags?.enable_integration_api) {
        integrationServer = createIntegrationApiServer();
    }

    await initCleanup();

    return {
        apiServer,
        nextServer,
        internalServer,
        aiGatewayServer,
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
            userOrgRoleIds?: number[];
            userOrgId?: string;
            userOrgIds?: string[];
            remoteExitNode?: RemoteExitNode;
            siteResource?: SiteResource;
            aiProvider?: AiProvider;
            aiModel?: AiModel;
            aiBudget?: AiBudget;
            virtualApiKey?: VirtualApiKey;
            orgPolicyAllowed?: boolean;
        }
    }
}

startServers().catch(console.error);
