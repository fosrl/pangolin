export function isPathAllowed(pattern: string, path: string): boolean {
  const normalize = (p: string) => p.split("/").filter(Boolean);
  const patternParts = normalize(pattern);
  const pathParts = normalize(path);

  function matchSegments(patternIndex: number, pathIndex: number): boolean {
    const currentPatternPart = patternParts[patternIndex];
    const currentPathPart = pathParts[pathIndex];

    if (patternIndex >= patternParts.length) {
      return pathIndex >= pathParts.length;
    }

    if (pathIndex >= pathParts.length) {
      const remainingPattern = patternParts.slice(patternIndex);
      return remainingPattern.every((p) => p === "*");
    }

    if (currentPatternPart === "*") {
      if (matchSegments(patternIndex + 1, pathIndex)) {
        return true;
      }
      if (matchSegments(patternIndex, pathIndex + 1)) {
        return true;
      }
      return false;
    }

    if (currentPatternPart.includes("*")) {
      const regexPattern = currentPatternPart
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(currentPathPart)) {
        return matchSegments(patternIndex + 1, pathIndex + 1);
      }
      return false;
    }

    if (currentPatternPart !== currentPathPart) {
      return false;
    }

    return matchSegments(patternIndex + 1, pathIndex + 1);
  }

  return matchSegments(0, 0);
}

export async function areAllConditionsMatched(
  conditions: Array<{ match: string; value: string }>,
  clientIp: string | undefined,
  path: string | undefined,
  ipCC?: string,
  ipAsn?: number
): Promise<boolean> {
  for (const c of conditions) {
    if (clientIp && c.match === "CIDR" && isIpInCidr(clientIp, c.value)) {
      continue;
    } else if (clientIp && c.match === "IP" && clientIp === c.value) {
      continue;
    } else if (path && c.match === "PATH" && isPathAllowed(c.value, path)) {
      continue;
    } else if (clientIp && c.match === "COUNTRY" && (await isIpInGeoIP(ipCC, c.value))) {
      continue;
    } else if (clientIp && c.match === "ASN" && (await isIpInAsn(ipAsn, c.value))) {
      continue;
    }
    return false;
  }
  return true;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  // Simple CIDR check for /32 or /24 typical cases; production uses server version
  const [base, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  const mask = prefix === 0 ? 0 : 0xffffffff << (32 - prefix);
  return (ipInt & mask) === (baseInt & mask);
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

async function isIpInGeoIP(ipCountryCode: string | undefined, checkCountryCode: string): Promise<boolean> {
  if (checkCountryCode === "ALL") return true;
  return (ipCountryCode || "").toUpperCase() === checkCountryCode.toUpperCase();
}

async function isIpInAsn(ipAsn: number | undefined, checkAsn: string): Promise<boolean> {
  if (checkAsn === "ALL" || checkAsn === "AS0") return true;
  if (!ipAsn) return false;
  const normalized = checkAsn.toUpperCase().replace(/^AS/, "");
  const num = parseInt(normalized, 10);
  if (isNaN(num)) return false;
  return ipAsn === num;
}
