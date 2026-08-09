import assert from "node:assert/strict";
import test from "node:test";
import { isLegacyIosUserAgent } from "./legacyIosStylesheet";

const cases: Array<{
    name: string;
    userAgent: string;
    expected: boolean;
}> = [
    {
        name: "iPhone iOS 14 WeCom",
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 14_1 like Mac OS X) " +
            "AppleWebKit/605.1.15 Mobile/15E148 wxwork/4.1.0",
        expected: true
    },
    {
        name: "iPad iOS 13 mobile mode",
        userAgent:
            "Mozilla/5.0 (iPad; CPU OS 13_7 like Mac OS X) " +
            "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        expected: true
    },
    {
        name: "iPadOS 14 desktop mode",
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) " +
            "AppleWebKit/605.1.15 Version/14.0 Mobile/15E148 Safari/604.1",
        expected: true
    },
    {
        name: "iPadOS 18 desktop mode",
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) " +
            "AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        expected: false
    },
    {
        name: "iPhone 13-class iOS 15.0",
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) " +
            "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        expected: true
    },
    {
        name: "iPhone iOS 15.3",
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 15_3 like Mac OS X) " +
            "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        expected: true
    },
    {
        name: "iPhone iOS 15.4",
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) " +
            "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        expected: false
    },
    {
        name: "macOS Safari 14",
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/605.1.15 Version/14.0 Safari/605.1.15",
        expected: false
    },
    {
        name: "Android Chrome",
        userAgent:
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 " +
            "Chrome/126.0.0.0 Mobile Safari/537.36",
        expected: false
    },
    {
        name: "unknown mobile user agent",
        userAgent: "CustomMobileClient/1.0",
        expected: false
    }
];

for (const entry of cases) {
    test(entry.name, () => {
        assert.equal(isLegacyIosUserAgent(entry.userAgent), entry.expected);
    });
}
