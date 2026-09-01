import { assertEquals } from "@test/assert";
import { detectLocale } from "./detectLocale";

function runTests() {
    assertEquals(
        detectLocale("zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6"),
        "zh-TW",
        "An exact regional match should take precedence over a language fallback"
    );
    assertEquals(
        detectLocale("ZH-tw"),
        "zh-TW",
        "Locale matching should be case-insensitive"
    );
    assertEquals(
        detectLocale("  zh-TW ; q=1 , zh-CN;q=0.8 "),
        "zh-TW",
        "Whitespace and quality parameters should not prevent an exact match"
    );
    assertEquals(
        detectLocale("zh-CN,zh-TW;q=0.9"),
        "zh-CN",
        "Simplified Chinese should still match exactly"
    );
    assertEquals(
        detectLocale("zh"),
        "zh-CN",
        "A generic Chinese preference should retain the existing fallback"
    );
    assertEquals(
        detectLocale("en-GB,en;q=0.9"),
        "en-US",
        "An unsupported region should fall back to a supported locale for the language"
    );
    assertEquals(
        detectLocale("ja-JP,zh-TW;q=0.9"),
        "zh-TW",
        "The next preference should be used when a language is unsupported"
    );
    assertEquals(
        detectLocale("zh-CN;q=0.5,zh-TW;q=0.9"),
        "zh-TW",
        "Preferences should be evaluated by quality"
    );
    assertEquals(
        detectLocale("zh-TW;q=0,fr-FR;q=0.8"),
        "fr-FR",
        "Locales with zero quality should be excluded"
    );
    assertEquals(
        detectLocale("*,de-DE;q=0.8"),
        "de-DE",
        "A wildcard should not obscure a supported preference"
    );
    assertEquals(
        detectLocale("ja-JP"),
        undefined,
        "An unsupported language should not match"
    );
    assertEquals(
        detectLocale(""),
        undefined,
        "An empty Accept-Language header should not match"
    );

    console.log("All locale detection tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Locale detection test failed:", error);
    process.exit(1);
}
