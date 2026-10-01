import "@server/extendZod";
import { assertEqualsObj } from "@test/assert";
import {
    buildHttpLoadBalancerServers,
    buildTcpUdpLoadBalancerServers
} from "./loadBalancer";
import type { TargetWithSite } from "./types";

function makeTarget(ip: string, siteType: string): TargetWithSite {
    return {
        targetId: 1,
        resourceId: 1,
        providerId: null,
        siteId: 1,
        ip,
        port: 8080,
        internalPort: 9000,
        method: "http",
        enabled: true,
        health: "healthy",
        path: null,
        pathMatchType: null,
        rewritePath: null,
        rewritePathType: null,
        priority: 100,
        mode: "http",
        authToken: null,
        site: {
            siteId: 1,
            type: siteType,
            subnet: null,
            exitNodeId: null,
            online: true
        }
    };
}

function runTests() {
    const ipCases = [
        { ip: "2001:db8::1", host: "[2001:db8::1]" },
        { ip: "192.0.2.1", host: "192.0.2.1" }
    ];
    const cases = [
        ...ipCases,
        { ip: "backend.example.com", host: "backend.example.com" }
    ];

    for (const { ip, host } of cases) {
        const target = makeTarget(ip, "local");
        assertEqualsObj(
            buildHttpLoadBalancerServers([target]),
            [{ url: `http://${host}:8080` }],
            `Local HTTP target ${ip} should format its endpoint`
        );
        assertEqualsObj(
            buildTcpUdpLoadBalancerServers([target]),
            [{ address: `${host}:8080` }],
            `Local TCP/UDP target ${ip} should format its endpoint`
        );
    }

    for (const { ip, host } of ipCases) {
        const target = makeTarget("backend.example.com", "newt");
        target.site.subnet = `${ip}/${ip.includes(":") ? 128 : 32}`;

        assertEqualsObj(
            buildHttpLoadBalancerServers([target]),
            [{ url: `http://${host}:9000` }],
            "Newt HTTP target should use the subnet endpoint and internal port"
        );
        assertEqualsObj(
            buildTcpUdpLoadBalancerServers([target]),
            [{ address: `${host}:9000` }],
            "Newt TCP/UDP target should use the subnet endpoint and internal port"
        );
    }

    console.log("All load balancer endpoint tests passed!");
}

runTests();
