export type LauncherActiveViewId = number | "default";

const LAST_VIEW_PREFIX = "pangolin:launcher:last-view:";
const GROUP_OPEN_PREFIX = "pangolin:launcher:group-open:";

function lastViewKey(orgId: string) {
    return `${LAST_VIEW_PREFIX}${orgId}`;
}

function groupOpenKey(
    orgId: string,
    viewId: LauncherActiveViewId,
    groupBy: "site" | "label" | "none"
) {
    return `${GROUP_OPEN_PREFIX}${orgId}:${viewId}:${groupBy}`;
}

function readJson<T>(key: string, fallback: T): T {
    if (typeof window === "undefined") {
        return fallback;
    }

    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch (error) {
        console.warn(`Error reading localStorage key "${key}":`, error);
        return fallback;
    }
}

function writeJson(key: string, value: unknown) {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Error writing localStorage key "${key}":`, error);
    }
}

export function readLauncherLastView(
    orgId: string
): LauncherActiveViewId | null {
    const value = readJson<LauncherActiveViewId | null>(
        lastViewKey(orgId),
        null
    );
    if (value === "default" || typeof value === "number") {
        return value;
    }
    return null;
}

export function writeLauncherLastView(
    orgId: string,
    viewId: LauncherActiveViewId
) {
    writeJson(lastViewKey(orgId), viewId);
}

export function readLauncherGroupOpenState(
    orgId: string,
    viewId: LauncherActiveViewId,
    groupBy: "site" | "label" | "none"
): Record<string, boolean> {
    return readJson<Record<string, boolean>>(
        groupOpenKey(orgId, viewId, groupBy),
        {}
    );
}

export function readLauncherGroupOpen(
    orgId: string,
    viewId: LauncherActiveViewId,
    groupBy: "site" | "label" | "none",
    groupKey: string,
    defaultOpen: boolean
): boolean {
    const state = readLauncherGroupOpenState(orgId, viewId, groupBy);
    return groupKey in state ? state[groupKey] : defaultOpen;
}

export function writeLauncherGroupOpen(
    orgId: string,
    viewId: LauncherActiveViewId,
    groupBy: "site" | "label" | "none",
    groupKey: string,
    isOpen: boolean
) {
    const state = readLauncherGroupOpenState(orgId, viewId, groupBy);
    writeJson(groupOpenKey(orgId, viewId, groupBy), {
        ...state,
        [groupKey]: isOpen
    });
}
