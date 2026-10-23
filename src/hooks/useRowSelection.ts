import type { RowSelectionState } from "@tanstack/react-table";
import { useEffect, useState } from "react";

export function useRowSelection<T extends { id: number }>(rows: T[]) {
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

    // Drop selections for rows that left the list (page change, filter, delete)
    useEffect(() => {
        const ids = new Set(rows.map((row) => String(row.id)));
        setRowSelection((previous) => {
            const kept = Object.keys(previous).filter((id) => ids.has(id));
            return kept.length === Object.keys(previous).length
                ? previous
                : Object.fromEntries(kept.map((id) => [id, true]));
        });
    }, [rows]);

    const selectedRows = rows.filter((row) => rowSelection[String(row.id)]);

    return { rowSelection, setRowSelection, selectedRows };
}
