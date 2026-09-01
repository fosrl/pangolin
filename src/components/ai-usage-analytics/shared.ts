import type { TrendSeries } from "./ToggleableTrendChart";

// Matches the theme's 5 categorical chart colors (--chart-1..--chart-5 in
// src/app/globals.css) - the same ceiling RequestChart already respects.
export const SERIES_COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)"
];
export const OTHER_COLOR = "var(--muted-foreground)";
export const OTHER_KEY = "other";

// The server already collapsed each day's row down to the top-N dimension
// keys (already ranked) plus an optional "other" bucket - so the full set of
// series can be derived straight from the data's own keys, no separate
// top-list needed. Assigns one categorical color per key, "other" last.
export function buildSeriesFromData(
    data: Array<Record<string, number | string>>,
    labelFor: (key: string) => string,
    otherLabel = "Other"
): TrendSeries[] {
    const keys = new Set<string>();
    for (const row of data) {
        for (const key of Object.keys(row)) {
            if (key !== "day" && key !== OTHER_KEY) {
                keys.add(key);
            }
        }
    }

    const series: TrendSeries[] = [...keys].map((key, i) => ({
        key,
        label: labelFor(key),
        color: SERIES_COLORS[i % SERIES_COLORS.length]
    }));

    const hasOther = data.some((row) => OTHER_KEY in row);
    if (hasOther) {
        series.push({ key: OTHER_KEY, label: otherLabel, color: OTHER_COLOR });
    }

    return series;
}

export const currencyFormatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
});

export const compactNumberFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: "compact",
    compactDisplay: "short"
});

export const exactNumberFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0
});

export function formatCost(value: number | null | undefined) {
    return currencyFormatter.format(value ?? 0);
}
