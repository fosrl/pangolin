import type { VisibilityState } from "@tanstack/react-table";
import { useCallback, useState } from "react";

const STORAGE_KEYS = {
    COLUMN_VISIBILITY: "datatable-column-visibility",
    getTableColumnVisibility: (tableId: string) =>
        `datatable-${tableId}-column-visibility`
};

const getStoredColumnVisibility = (
    tableId: string,
    defaultVisibility?: Record<string, boolean>
): Record<string, boolean> => {
    if (typeof window === "undefined") return defaultVisibility || {};

    try {
        const key = STORAGE_KEYS.getTableColumnVisibility(tableId);
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Validate that it's an object
            if (typeof parsed === "object" && parsed !== null) {
                // Stored choices win. Keys only present in the defaults
                // (for example a newly hidden column) still apply.
                return { ...(defaultVisibility || {}), ...parsed };
            }
        }
    } catch (error) {
        console.warn(
            "Failed to read column visibility from localStorage:",
            error
        );
    }
    return defaultVisibility || {};
};

const setStoredColumnVisibility = (
    visibility: Record<string, boolean>,
    tableId: string
): void => {
    if (typeof window === "undefined") return;

    try {
        const key = STORAGE_KEYS.getTableColumnVisibility(tableId);
        localStorage.setItem(key, JSON.stringify(visibility));
    } catch (error) {
        console.warn(
            "Failed to save column visibility to localStorage:",
            error
        );
    }
};

export function useStoredColumnVisibility(
    tableId: string,
    defaultColumnVisibility?: Record<string, boolean>
) {
    const [columnVisibility, setVisibility] = useState<VisibilityState>(() =>
        getStoredColumnVisibility(tableId, defaultColumnVisibility)
    );

    const setColumnVisibility = useCallback(
        (
            updaterOrValue:
                VisibilityState | ((old: VisibilityState) => VisibilityState)
        ) => {
            if (typeof updaterOrValue === "function") {
                setVisibility((oldValue) => {
                    const newValue = updaterOrValue(oldValue);
                    setStoredColumnVisibility(newValue, tableId);
                    return newValue;
                });
            } else {
                setVisibility(updaterOrValue);
                setStoredColumnVisibility(updaterOrValue, tableId);
            }
        },
        [tableId]
    );

    return [columnVisibility, setColumnVisibility] as const;
}
