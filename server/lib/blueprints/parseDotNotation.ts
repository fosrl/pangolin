const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type PathSegment = { key: string; index: number | null };

// Split "a.b[0].c" into segments. Docker labels come from a Newt agent, so a
// segment naming a reserved key (with or without an index) rejects the path.
function parsePath(path: string): PathSegment[] | null {
    const segments: PathSegment[] = [];
    for (const raw of path.split(".")) {
        const match = raw.match(/^(.+)\[(\d+)\]$/);
        const key = match ? match[1] : raw;
        if (RESERVED_KEYS.has(key)) {
            return null;
        }
        segments.push({
            key,
            index: match ? parseInt(match[2], 10) : null
        });
    }
    return segments;
}

// Returns false (and leaves obj untouched) if the path is not safe to set.
export function setNestedProperty(
    obj: any,
    path: string,
    value: string
): boolean {
    const segments = parsePath(path);
    if (!segments) {
        return false;
    }

    // Containers are null-prototype and only own properties are followed, so a
    // missing key can never resolve to something on Object.prototype.
    const own = (o: any, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);

    let current = obj;

    for (let i = 0; i < segments.length - 1; i++) {
        const { key, index } = segments[i];

        if (index !== null) {
            let arr = own(current, key);
            if (!Array.isArray(arr)) {
                arr = [];
                current[key] = arr;
            }
            while (arr.length <= index) {
                arr.push(Object.create(null));
            }
            current = arr[index];
        } else {
            let next = own(current, key);
            if (typeof next !== "object" || next === null) {
                next = Object.create(null);
                current[key] = next;
            }
            current = next;
        }
    }

    // Set the final value
    const { key: finalKey, index: finalIndex } = segments[segments.length - 1];

    if (finalIndex !== null) {
        let arr = own(current, finalKey);
        if (!Array.isArray(arr)) {
            arr = [];
            current[finalKey] = arr;
        }
        while (arr.length <= finalIndex) {
            arr.push(null);
        }
        arr[finalIndex] = convertValue(value);
    } else {
        current[finalKey] = convertValue(value);
    }
    return true;
}

// Helper function to convert string values to appropriate types
export function convertValue(value: string): any {
    // Convert boolean strings
    if (value === "true") return true;
    if (value === "false") return false;

    // Convert numeric strings. Digit strings with a leading zero (a PIN like
    // "012345") stay strings, since converting them would drop the zeros.
    if (/^(0|[1-9]\d*)$/.test(value)) {
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
