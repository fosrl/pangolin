/**
 * Inspired from plausible: https://github.com/plausible/analytics/blob/1df08a25b4a536c9cc1e03855ddcfeac1d1cf6e5/assets/js/dashboard/stats/locations/map.tsx
 */
import { cn } from "@app/lib/cn";
import worldJson from "visionscarto-world-atlas/world/110m.json";
import * as topojson from "topojson-client";
import * as d3 from "d3";
import { useRef, type ComponentRef, useState, useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import { COUNTRY_CODE_LIST } from "@app/lib/countryCodeList";
import { useTranslations } from "next-intl";

type CountryData = {
    alpha_3: string;
    name: string;
    count: number;
    code: string;
};

export type WorldMapProps = {
    data: Pick<CountryData, "code" | "count">[];
    label: {
        singular: string;
        plural: string;
    };
};

export function WorldMap({ data, label }: WorldMapProps) {
    const svgRef = useRef<ComponentRef<"svg">>(null);
    const [tooltip, setTooltip] = useState<{
        x: number;
        y: number;
        hoveredCountryAlpha3Code: string | null;
    }>({ x: 0, y: 0, hoveredCountryAlpha3Code: null });
    const { theme, systemTheme } = useTheme();

    const t = useTranslations();

    useEffect(() => {
        if (!svgRef.current) return;
        const svg = drawInteractiveCountries(svgRef.current, setTooltip);

        return () => {
            svg.selectAll("*").remove();
        };
    }, []);

    const displayNames = new Intl.DisplayNames(navigator.language, {
        type: "region",
        fallback: "code"
    });

    const maxValue = Math.max(...data.map((item) => item.count));
    const dataByCountryCode = useMemo(() => {
        const byCountryCode = new Map<string, CountryData>();
        for (const country of data) {
            const countryISOData = COUNTRY_CODE_LIST[country.code];

            if (countryISOData) {
                byCountryCode.set(countryISOData.alpha3, {
                    ...country,
                    name: displayNames.of(country.code)!,
                    alpha_3: countryISOData.alpha3
                });
            }
        }
        return byCountryCode;
    }, [data]);

    useEffect(() => {
        if (svgRef.current) {
            const palette =
                colorScales[theme ?? "light"] ??
                colorScales[systemTheme ?? "light"];

            const getColorForValue = d3
                .scaleLinear<string>()
                .domain([0, maxValue])
                .range(palette);

            colorInCountriesWithValues(
                svgRef.current,
                getColorForValue,
                dataByCountryCode
            );
        }
    }, [theme, systemTheme, maxValue, dataByCountryCode]);

    const hoveredCountryData = tooltip.hoveredCountryAlpha3Code
        ? dataByCountryCode.get(tooltip.hoveredCountryAlpha3Code)
        : undefined;

    return (
        <div className="mx-auto mt-4 w-full relative">
            <svg
                ref={svgRef}
                viewBox={`0 0 ${width} ${height}`}
                className="w-full"
            />

            {!!hoveredCountryData && (
                <MapTooltip
                    x={tooltip.x}
                    y={tooltip.y}
                    name={hoveredCountryData.name}
                    value={Intl.NumberFormat(navigator.language).format(
                        hoveredCountryData.count
                    )}
                    label={
                        hoveredCountryData.count === 1
                            ? t(label.singular)
                            : t(label.plural)
                    }
                />
            )}
        </div>
    );
}

interface MapTooltipProps {
    name: string;
    value: string;
    label: string;
    x: number;
    y: number;
}

function MapTooltip({ name, value, label, x, y }: MapTooltipProps) {
    return (
        <div
            className={cn(
                "absolute z-50 p-2 translate-x-2 translate-y-2",
                "pointer-events-none rounded-sm",
                "bg-white dark:bg-popover shadow border border-border"
            )}
            style={{
                left: x,
                top: y
            }}
        >
            <div className="font-semibold">{name}</div>
            <strong className="text-primary">{value}</strong> {label}
        </div>
    );
}

const width = 475;
const height = 335;
const sharedCountryClass = cn("transition-colors");

const colorScales: Record<string, [string, string]> = {
    dark: ["#4F4444", "#f36117"],
    light: ["#FFF5F3", "#f36117"]
};

const countryClass = cn(
    sharedCountryClass,
    "stroke-1",
    "fill-[#fafafa]",
    "stroke-[#E7DADA]",
    "dark:fill-[#323236]",
    "dark:stroke-[#18181b]"
);

const highlightedCountryClass = cn(
    sharedCountryClass,
    "stroke-[3]",
    "fill-[#f4f4f5]",
    "stroke-[#f36117]",
    "dark:fill-[#3f3f46]"
);

function setupProjetionPath() {
    const projection = d3
        .geoMercator()
        .scale(75)
        .translate([width / 2, height / 1.5]);

    const path = d3.geoPath().projection(projection);
    return path;
}

/** @returns the d3 selected svg element */
function drawInteractiveCountries(
    element: SVGSVGElement,
    setTooltip: React.Dispatch<
        React.SetStateAction<{
            x: number;
            y: number;
            hoveredCountryAlpha3Code: string | null;
        }>
    >
) {
    const path = setupProjetionPath();
    const data = parseWorldTopoJsonToGeoJsonFeatures();
    const svg = d3.select(element);
    const countriesLayer = svg.append("g");
    const hoverLayer = svg.append("g").style("pointer-events", "none");
    const hoverPath = hoverLayer
        .append("path")
        .datum(null)
        .attr("class", highlightedCountryClass)
        .style("display", "none");

    countriesLayer
        .selectAll("path")
        .data(data)
        .enter()
        .append("path")
        .attr("data-country-path", "true")
        .attr("class", countryClass)
        .attr("d", path as never)

        .on("mouseover", function (event, country) {
            const [x, y] = d3.pointer(event, svg.node()?.parentNode);
            setTooltip({
                x,
                y,
                hoveredCountryAlpha3Code: country.properties.a3
            });
            hoverPath
                .datum(country)
                .attr("d", path(country) as string)
                .style("display", null);
        })

        .on("mousemove", function (event) {
            const [x, y] = d3.pointer(event, svg.node()?.parentNode);
            setTooltip((currentState) => ({ ...currentState, x, y }));
        })

        .on("mouseout", function () {
            setTooltip({ x: 0, y: 0, hoveredCountryAlpha3Code: null });
            hoverPath.style("display", "none");
        });

    return svg;
}

type WorldJsonCountryData = { properties: { name: string; a3: string } };

function parseWorldTopoJsonToGeoJsonFeatures(): Array<WorldJsonCountryData> {
    const collection = topojson.feature(
        // @ts-expect-error strings in worldJson not recongizable as the enum values declared in library
        worldJson,
        worldJson.objects.countries
    );
    // @ts-expect-error topojson.feature return type incorrectly inferred as not a collection
    return collection.features;
}

/**
 * Used to color the countries
 * @returns the svg elements represeting countries
 */
function colorInCountriesWithValues(
    element: SVGSVGElement,
    getColorForValue: d3.ScaleLinear<string, string, never>,
    dataByCountryCode: Map<string, CountryData>
) {
    function getCountryByCountryPath(countryPath: unknown) {
        return dataByCountryCode.get(
            (countryPath as unknown as WorldJsonCountryData).properties.a3
        );
    }

    const svg = d3.select(element);

    return svg
        .selectAll('path[data-country-path="true"]')
        .style("fill", (countryPath) => {
            const country = getCountryByCountryPath(countryPath);
            if (!country?.count) {
                return null;
            }
            return getColorForValue(country.count);
        })
        .style("cursor", (countryPath) => {
            const country = getCountryByCountryPath(countryPath);
            if (!country?.count) {
                return null;
            }
            return "pointer";
        });
}
