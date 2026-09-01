import { Locale, locales } from "./config";

export function detectLocale(acceptLanguage: string): Locale | undefined {
    const browserLocales = acceptLanguage
        .split(",")
        .map((entry, index) => {
            const [locale, ...parameters] = entry.trim().split(";");
            const qualityParameter = parameters.find((parameter) =>
                parameter.trim().toLowerCase().startsWith("q=")
            );
            const quality = qualityParameter
                ? Number(qualityParameter.trim().slice(2))
                : 1;

            return {
                locale: locale.trim().toLowerCase(),
                quality,
                index
            };
        })
        .filter(
            ({ locale, quality }) =>
                locale && locale !== "*" && quality > 0 && quality <= 1
        )
        .sort(
            (left, right) =>
                right.quality - left.quality || left.index - right.index
        );

    for (const { locale: browserLocale } of browserLocales) {
        const exactMatch = locales.find(
            (locale) => locale.toLowerCase() === browserLocale
        );
        if (exactMatch) {
            return exactMatch;
        }

        const browserLanguage = browserLocale.split("-")[0];
        const languageMatch = locales.find(
            (locale) => locale.split("-")[0].toLowerCase() === browserLanguage
        );
        if (languageMatch) {
            return languageMatch;
        }
    }

    return undefined;
}
