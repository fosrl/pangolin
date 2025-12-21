import logger from "@server/logger";
import { setNestedProperty } from "./parseDotNotation";

export type DockerLabels = {
    [key: string]: string;
};

export type ParsedObject = {
    [key: string]: any;
};

type ContainerPort = {
    privatePort: number;
    publicPort: number;
    type: string;
    ip: string;
};

type Container = {
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
    ports: ContainerPort[] | null;
    labels: DockerLabels;
    created: number;
    networks: { [key: string]: any };
    hostname: string;
};

type Target = {
    hostname?: string;
    port?: number;
    method?: string;
    enabled?: boolean;
    [key: string]: any;
};

type ResourceConfig = {
    [key: string]: any;
    targets?: (Target | null)[];
};

function getContainerPort(container: Container): number | null {
    if (!container.ports || container.ports.length === 0) {
        return null;
    }
    // Return the first port's privatePort
    return container.ports[0].privatePort;
    // return container.ports[0].publicPort;
}

export function processContainerLabels(containers: Container[]): {
    "proxy-resources": { [key: string]: ResourceConfig };
    "client-resources": { [key: string]: ResourceConfig };
    "public-resources": { [key: string]: ResourceConfig };
    "private-resources": { [key: string]: ResourceConfig };
} {
    const result = {
        "proxy-resources": {} as { [key: string]: ResourceConfig },
        "client-resources": {} as { [key: string]: ResourceConfig },
        "public-resources": {} as { [key: string]: ResourceConfig },
        "private-resources": {} as { [key: string]: ResourceConfig }
    };

    // Process each container
    containers.forEach((container) => {
        if (container.state !== "running") {
            return;
        }

        const proxyResourceLabels: DockerLabels = {};
        const clientResourceLabels: DockerLabels = {};
        const publicResourceLabels: DockerLabels = {};
        const privateResourceLabels: DockerLabels = {};

        // Filter and separate proxy-resources, client-resources, public-resources, and private-resources labels
        Object.entries(container.labels).forEach(([key, value]) => {
            if (key.startsWith("pangolin.proxy-resources.")) {
                // remove the pangolin.proxy- prefix to get "resources.xxx"
                const strippedKey = key.replace("pangolin.proxy-", "");
                proxyResourceLabels[strippedKey] = value;
            } else if (key.startsWith("pangolin.client-resources.")) {
                // remove the pangolin.client- prefix to get "resources.xxx"
                const strippedKey = key.replace("pangolin.client-", "");
                clientResourceLabels[strippedKey] = value;
            } else if (key.startsWith("pangolin.public-resources.")) {
                // remove the pangolin.public- prefix to get "resources.xxx"
                const strippedKey = key.replace("pangolin.public-", "");
                publicResourceLabels[strippedKey] = value;
            } else if (key.startsWith("pangolin.private-resources.")) {
                // remove the pangolin.private- prefix to get "resources.xxx"
                const strippedKey = key.replace("pangolin.private-", "");
                privateResourceLabels[strippedKey] = value;
            }
        });

        // Process proxy resources
        if (Object.keys(proxyResourceLabels).length > 0) {
            processResourceLabels(
                proxyResourceLabels,
                container,
                result["proxy-resources"]
            );
        }

        // Process client resources
        if (Object.keys(clientResourceLabels).length > 0) {
            processResourceLabels(
                clientResourceLabels,
                container,
                result["client-resources"]
            );
        }

        // Process public resources (alias for proxy resources)
        if (Object.keys(publicResourceLabels).length > 0) {
            processResourceLabels(
                publicResourceLabels,
                container,
                result["public-resources"]
            );
        }

        // Process private resources (alias for client resources)
        if (Object.keys(privateResourceLabels).length > 0) {
            processResourceLabels(
                privateResourceLabels,
                container,
                result["private-resources"]
            );
        }
    });

    return result;
}

function processResourceLabels(
    resourceLabels: DockerLabels,
    container: Container,
    targetResult: { [key: string]: ResourceConfig }
) {
    // Parse the labels using the existing parseDockerLabels logic
    const tempResult: ParsedObject = {};
    Object.entries(resourceLabels).forEach(([key, value]) => {
        setNestedProperty(tempResult, key, value);
    });

    // Merge into target result
    if (tempResult.resources) {
        Object.entries(tempResult.resources).forEach(
            ([resourceKey, resourceConfig]: [string, any]) => {
                // Initialize resource if it doesn't exist
                if (!targetResult[resourceKey]) {
                    targetResult[resourceKey] = {};
                }

                // Merge all properties except targets
                Object.entries(resourceConfig).forEach(
                    ([propKey, propValue]) => {
                        if (propKey !== "targets") {
                            targetResult[resourceKey][propKey] = propValue;
                        }
                    }
                );

                // Handle targets specially
                if (
                    resourceConfig.targets &&
                    Array.isArray(resourceConfig.targets)
                ) {
                    const resource = targetResult[resourceKey];
                    if (resource) {
                        if (!resource.targets) {
                            resource.targets = [];
                        }

                        resourceConfig.targets.forEach(
                            (target: any, targetIndex: number) => {
                                // check if the target is an empty object
                                if (
                                    typeof target === "object" &&
                                    Object.keys(target).length === 0
                                ) {
                                    logger.debug(
                                        `Skipping null target at index ${targetIndex} for resource ${resourceKey}`
                                    );
                                    resource.targets!.push(null);
                                    return;
                                }

                                // Ensure targets array is long enough
                                while (
                                    resource.targets!.length <= targetIndex
                                ) {
                                    resource.targets!.push({});
                                }

                                // Set default hostname and port if not provided
                                const finalTarget = { ...target };
                                if (!finalTarget.hostname) {
                                    finalTarget.hostname =
                                        container.name || container.hostname;
                                }
                                if (!finalTarget.port) {
                                    const containerPort =
                                        getContainerPort(container);
                                    if (containerPort !== null) {
                                        finalTarget.port = containerPort;
                                    }
                                }

                                // Merge with existing target data
                                resource.targets![targetIndex] = {
                                    ...resource.targets![targetIndex],
                                    ...finalTarget
                                };
                            }
                        );
                    }
                }
            }
        );
    }
}

// // Test example
// const testContainers: Container[] = [
//     {
//         id: "57e056cb0e3a",
//         name: "nginx1",
//         image: "nginxdemos/hello",
//         state: "running",
//         status: "Up 4 days",
//         ports: [
//             {
//                 privatePort: 80,
//                 publicPort: 8000,
//                 type: "tcp",
//                 ip: "0.0.0.0"
//             }
//         ],
//         labels: {
//             "resources.nginx.name": "nginx",
//             "resources.nginx.full-domain": "nginx.example.com",
//             "resources.nginx.protocol": "http",
//             "resources.nginx.targets[0].enabled": "true"
//         },
//         created: 1756942725,
//         networks: {
//             owen_default: {
//                 networkId:
//                     "cb131c0f1d5d8ef7158660e77fc370508f5a563e1f9829b53a1945ae3725b58c"
//             }
//         },
//         hostname: "57e056cb0e3a"
//     },
//     {
//         id: "58e056cb0e3b",
//         name: "nginx2",
//         image: "nginxdemos/hello",
//         state: "running",
//         status: "Up 4 days",
//         ports: [
//             {
//                 privatePort: 80,
//                 publicPort: 8001,
//                 type: "tcp",
//                 ip: "0.0.0.0"
//             }
//         ],
//         labels: {
//             "resources.nginx.name": "nginx",
//             "resources.nginx.full-domain": "nginx.example.com",
//             "resources.nginx.protocol": "http",
//             "resources.nginx.targets[1].enabled": "true"
//         },
//         created: 1756942726,
//         networks: {
//             owen_default: {
//                 networkId:
//                     "cb131c0f1d5d8ef7158660e77fc370508f5a563e1f9829b53a1945ae3725b58c"
//             }
//         },
//         hostname: "58e056cb0e3b"
//     },
//     {
//         id: "59e056cb0e3c",
//         name: "api-server",
//         image: "my-api:latest",
//         state: "running",
//         status: "Up 2 days",
//         ports: [
//             {
//                 privatePort: 3000,
//                 publicPort: 3000,
//                 type: "tcp",
//                 ip: "0.0.0.0"
//             }
//         ],
//         labels: {
//             "resources.api.name": "API Server",
//             "resources.api.protocol": "http",
//             "resources.api.targets[0].enabled": "true",
//             "resources.api.targets[0].hostname": "custom-host",
//             "resources.api.targets[0].port": "3001"
//         },
//         created: 1756942727,
//         networks: {
//             owen_default: {
//                 networkId:
//                     "cb131c0f1d5d8ef7158660e77fc370508f5a563e1f9829b53a1945ae3725b58c"
//             }
//         },
//         hostname: "59e056cb0e3c"
//     },
//     {
//         id: "d0e29b08361c",
//         name: "beautiful_wilson",
//         image: "bolkedebruin/rdpgw:latest",
//         state: "exited",
//         status: "Exited (0) 4 hours ago",
//         ports: null,
//         labels: {},
//         created: 1757359039,
//         networks: {
//             bridge: {
//                 networkId:
//                     "ea7f56dfc9cc476b8a3560b5b570d0fe8a6a2bc5e8343ab1ed37822086e89687"
//             }
//         },
//         hostname: "d0e29b08361c"
//     }
// ];

// // Test the function
// const result = processContainerLabels(testContainers);
// console.log("Processed result:");
// console.log(JSON.stringify(result, null, 2));
