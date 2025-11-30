export function setNestedProperty(obj: any, path: string, value: string): void {
    const keys = path.split(".");
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];

        // Handle array notation like "targets[0]"
        const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);

        if (arrayMatch) {
            const [, arrayKey, indexStr] = arrayMatch;
            const index = parseInt(indexStr, 10);

            // Initialize array if it doesn't exist
            if (!current[arrayKey]) {
                current[arrayKey] = [];
            }

            // Ensure array is long enough
            while (current[arrayKey].length <= index) {
                current[arrayKey].push({});
            }

            current = current[arrayKey][index];
        } else {
            // Regular object property
            if (!current[key]) {
                current[key] = {};
            }
            current = current[key];
        }
    }

    // Set the final value
    const finalKey = keys[keys.length - 1];
    const arrayMatch = finalKey.match(/^(.+)\[(\d+)\]$/);

    if (arrayMatch) {
        const [, arrayKey, indexStr] = arrayMatch;
        const index = parseInt(indexStr, 10);

        if (!current[arrayKey]) {
            current[arrayKey] = [];
        }

        // Ensure array is long enough
        while (current[arrayKey].length <= index) {
            current[arrayKey].push(null);
        }

        current[arrayKey][index] = convertValue(value);
    } else {
        current[finalKey] = convertValue(value);
    }
}

// Helper function to convert string values to appropriate types
export function convertValue(value: string): any {
    // Convert boolean strings
    if (value === "true") return true;
    if (value === "false") return false;

    // Convert numeric strings
    if (/^\d+$/.test(value)) {
        const num = parseInt(value, 10);
        return num;
    }

    if (/^\d*\.\d+$/.test(value)) {
        const num = parseFloat(value);
        return num;
    }

    // Return as string
    return value;
}

// // Example usage:
// const dockerLabels: DockerLabels = {
//     "resources.resource-nice-id.name": "this is my resource",
//     "resources.resource-nice-id.protocol": "http",
//     "resources.resource-nice-id.full-domain": "level1.test3.example.com",
//     "resources.resource-nice-id.host-header": "example.com",
//     "resources.resource-nice-id.tls-server-name": "example.com",
//     "resources.resource-nice-id.auth.pincode": "123456",
//     "resources.resource-nice-id.auth.password": "sadfasdfadsf",
//     "resources.resource-nice-id.auth.sso-enabled": "true",
//     "resources.resource-nice-id.auth.sso-roles[0]": "Member",
//     "resources.resource-nice-id.auth.sso-users[0]": "owen@pangolin.net",
//     "resources.resource-nice-id.auth.whitelist-users[0]": "owen@pangolin.net",
//     "resources.resource-nice-id.targets[0].hostname": "localhost",
//     "resources.resource-nice-id.targets[0].method": "http",
//     "resources.resource-nice-id.targets[0].port": "8000",
//     "resources.resource-nice-id.targets[0].healthcheck.port": "8000",
//     "resources.resource-nice-id.targets[0].healthcheck.hostname": "localhost",
//     "resources.resource-nice-id.targets[1].hostname": "localhost",
//     "resources.resource-nice-id.targets[1].method": "http",
//     "resources.resource-nice-id.targets[1].port": "8001",
//     "resources.resource-nice-id2.name": "this is other resource",
//     "resources.resource-nice-id2.protocol": "tcp",
//     "resources.resource-nice-id2.proxy-port": "3000",
//     "resources.resource-nice-id2.targets[0].hostname": "localhost",
//     "resources.resource-nice-id2.targets[0].port": "3000"
// };

// // Parse the labels
// const parsed = parseDockerLabels(dockerLabels);
// console.log(JSON.stringify(parsed, null, 2));
