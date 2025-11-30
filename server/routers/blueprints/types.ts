import type { Blueprint } from "@server/db";

export type BlueprintSource = "API" | "UI" | "NEWT";

export type BlueprintData = Omit<Blueprint, "source"> & {
    source: BlueprintSource;
};
