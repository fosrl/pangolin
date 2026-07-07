import { Target, TargetHealthCheck } from "@server/db";
import { sendToClient } from "#dynamic/routers/ws";
import logger from "@server/logger";
import { canCompress } from "@server/lib/clientVersionChecks";
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";

export async function addTargets(
    newtId: string,
    targets: Target[],
    healthCheckData: TargetHealthCheck[],
    protocol: string,
    version?: string | null
) {
    //create a list of udp and tcp targets
    const payloadTargets = targets.map((target) => {
        return `${target.internalPort ? target.internalPort + ":" : ""}${
            target.ip
        }:${target.port}`;
    });

    if (payloadTargets.length > 0) {
        await sendToClient(
            newtId,
            {
                type: `newt/${protocol}/add`,
                data: {
                    targets: payloadTargets
                }
            },
            {
                incrementConfigVersion: true,
                compress: canCompress(version, "newt")
            }
        );
    }

    const healthCheckTargets = healthCheckData.map((hc) => {
        // Ensure all necessary fields are present
        const isTCP = hc.hcMode?.toLowerCase() === "tcp";
        if (!hc.hcHostname || !hc.hcPort || !hc.hcInterval) {
            logger.debug(
                `Skipping hc ${hc.targetHealthCheckId} due to missing health check fields`
            );
            return null;
        }
        if (!isTCP && (!hc.hcPath || !hc.hcMethod)) {
            logger.debug(
                `Skipping hc ${hc.targetHealthCheckId} due to missing HTTP health check fields`
            );
            return null;
        }

        const hcHeadersParse = hc.hcHeaders ? JSON.parse(hc.hcHeaders) : null;
        const hcHeadersSend: { [key: string]: string } = {};
        if (hcHeadersParse) {
            // transform
            hcHeadersParse.forEach(
                (header: { name: string; value: string }) => {
                    hcHeadersSend[header.name] = header.value;
                }
            );
        }

        // try to parse the hcStatus into a int and if not possible set to undefined
        let hcStatus: number | undefined = undefined;
        if (hc.hcStatus) {
            const parsedStatus = parseInt(hc.hcStatus.toString());
            if (!isNaN(parsedStatus)) {
                hcStatus = parsedStatus;
            }
        }

        return {
            id: hc.targetHealthCheckId,
            hcEnabled: hc.hcEnabled,
            hcPath: hc.hcPath,
            hcScheme: hc.hcScheme,
            hcMode: hc.hcMode,
            hcHostname: hc.hcHostname,
            hcPort: hc.hcPort,
            hcInterval: hc.hcInterval, // in seconds
            hcUnhealthyInterval: hc.hcUnhealthyInterval, // in seconds
            hcTimeout: hc.hcTimeout, // in seconds
            hcHeaders: hcHeadersSend,
            hcFollowRedirects: hc.hcFollowRedirects,
            hcMethod: hc.hcMethod,
            hcStatus: hcStatus,
            hcTlsServerName: hc.hcTlsServerName,
            hcHealthyThreshold: hc.hcHealthyThreshold,
            hcUnhealthyThreshold: hc.hcUnhealthyThreshold
        };
    });

    // Filter out any null values from health check targets
    const validHealthCheckTargets = healthCheckTargets.filter(
        (hc) => hc !== null
    );

    await sendToClient(
        newtId,
        {
            type: `newt/healthcheck/add`,
            data: {
                targets: validHealthCheckTargets
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function addStandaloneHealthCheck(
    newtId: string,
    healthCheck: TargetHealthCheck,
    version?: string | null
) {
    const isTCP = healthCheck.hcMode?.toLowerCase() === "tcp";
    if (
        !healthCheck.hcHostname ||
        !healthCheck.hcPort ||
        !healthCheck.hcInterval
    ) {
        logger.debug(
            `Skipping standalone health check ${healthCheck.targetHealthCheckId} due to missing fields`
        );
        return;
    }
    if (!isTCP && (!healthCheck.hcPath || !healthCheck.hcMethod)) {
        logger.debug(
            `Skipping standalone health check ${healthCheck.targetHealthCheckId} due to missing HTTP health check fields`
        );
        return;
    }

    const hcHeadersParse = healthCheck.hcHeaders
        ? JSON.parse(healthCheck.hcHeaders)
        : null;
    const hcHeadersSend: { [key: string]: string } = {};
    if (hcHeadersParse) {
        hcHeadersParse.forEach((header: { name: string; value: string }) => {
            hcHeadersSend[header.name] = header.value;
        });
    }

    let hcStatus: number | undefined = undefined;
    if (healthCheck.hcStatus) {
        const parsedStatus = parseInt(healthCheck.hcStatus.toString());
        if (!isNaN(parsedStatus)) {
            hcStatus = parsedStatus;
        }
    }

    await sendToClient(
        newtId,
        {
            type: `newt/healthcheck/add`,
            data: {
                targets: [
                    {
                        id: healthCheck.targetHealthCheckId,
                        hcEnabled: healthCheck.hcEnabled,
                        hcPath: healthCheck.hcPath,
                        hcScheme: healthCheck.hcScheme,
                        hcMode: healthCheck.hcMode,
                        hcHostname: healthCheck.hcHostname,
                        hcPort: healthCheck.hcPort,
                        hcInterval: healthCheck.hcInterval,
                        hcUnhealthyInterval: healthCheck.hcUnhealthyInterval,
                        hcTimeout: healthCheck.hcTimeout,
                        hcHeaders: hcHeadersSend,
                        hcFollowRedirects: healthCheck.hcFollowRedirects,
                        hcMethod: healthCheck.hcMethod,
                        hcStatus: hcStatus,
                        hcTlsServerName: healthCheck.hcTlsServerName,
                        hcHealthyThreshold: healthCheck.hcHealthyThreshold,
                        hcUnhealthyThreshold: healthCheck.hcUnhealthyThreshold
                    }
                ]
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function removeStandaloneHealthCheck(
    newtId: string,
    healthCheckId: number,
    version?: string | null
) {
    await sendToClient(
        newtId,
        {
            type: `newt/healthcheck/remove`,
            data: {
                ids: [healthCheckId]
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function removeTargets(
    newtId: string,
    targets: Target[],
    healthCheckData: TargetHealthCheck[],
    protocol: string,
    version?: string | null
) {
    //create a list of udp and tcp targets
    const payloadTargets = targets.map((target) => {
        return `${target.internalPort ? target.internalPort + ":" : ""}${
            target.ip
        }:${target.port}`;
    });

    if (payloadTargets.length > 0) {
        await sendToClient(
            newtId,
            {
                type: `newt/${protocol}/remove`,
                data: {
                    targets: payloadTargets
                }
            },
            { incrementConfigVersion: true }
        );
    }

    const healthCheckTargets = healthCheckData.map((hc) => {
        return hc.targetHealthCheckId;
    });

    await sendToClient(
        newtId,
        {
            type: `newt/healthcheck/remove`,
            data: {
                ids: healthCheckTargets
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function sendBrowserGatewayTargets(
    newtId: string,
    targets: Target[],
    version?: string | null
) {
    if (targets.length === 0) return;

    // filter out the ones without auth tokens
    const filteredTargets = targets.filter((t) => t.authToken);
    if (filteredTargets.length === 0) return;

    const payload = filteredTargets.map((t) => {
        const decryptAuthToken = decrypt(
            t.authToken!,
            config.getRawConfig().server.secret!
        );
        return {
            id: t.targetId,
            resourceId: t.resourceId,
            siteId: t.siteId,
            type: t.mode,
            destination: t.ip,
            destinationPort: t.port,
            authToken: decryptAuthToken
        };
    });

    await sendToClient(
        newtId,
        {
            type: "newt/browsergateway/add",
            data: {
                targets: payload
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}

export async function removeBrowserGatewayTarget(
    newtId: string,
    browserGatewayTargetId: number,
    version?: string | null
) {
    await sendToClient(
        newtId,
        {
            type: "newt/browsergateway/remove",
            data: {
                ids: [browserGatewayTargetId]
            }
        },
        { incrementConfigVersion: true, compress: canCompress(version, "newt") }
    );
}
