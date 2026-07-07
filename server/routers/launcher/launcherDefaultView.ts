import { db, launcherViews } from "@server/db";
import { and, eq, isNull } from "drizzle-orm";
import moment from "moment";
import {
    launcherViewConfigSchema,
    type LauncherDefaultViewOverrides,
    type LauncherViewConfig,
    type LauncherViewRecord
} from "./types";

export function mapViewRow(
    row: typeof launcherViews.$inferSelect
): LauncherViewRecord {
    return {
        viewId: row.viewId,
        orgId: row.orgId,
        userId: row.userId,
        name: row.name,
        config: launcherViewConfigSchema.parse(JSON.parse(row.config)),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isOrgWide: row.userId == null,
        isDefault: row.isDefault
    };
}

export function extractDefaultViewOverrides(
    rows: Array<typeof launcherViews.$inferSelect>
): LauncherDefaultViewOverrides {
    const overrideRows = rows.filter((row) => row.isDefault);

    const personalRow = overrideRows.find((row) => row.userId !== null);
    const orgWideRow = overrideRows.find((row) => row.userId === null);

    return {
        personal: personalRow ? mapViewRow(personalRow) : null,
        orgWide: orgWideRow ? mapViewRow(orgWideRow) : null
    };
}

export function listVisibleLauncherViews(
    rows: Array<typeof launcherViews.$inferSelect>
): LauncherViewRecord[] {
    return rows.filter((row) => !row.isDefault).map(mapViewRow);
}

export async function findDefaultViewOverride(
    orgId: string,
    orgWide: boolean,
    userId: string
) {
    const [existing] = await db
        .select()
        .from(launcherViews)
        .where(
            and(
                eq(launcherViews.orgId, orgId),
                eq(launcherViews.isDefault, true),
                orgWide
                    ? isNull(launcherViews.userId)
                    : eq(launcherViews.userId, userId)
            )
        )
        .limit(1);

    return existing ?? null;
}

export async function upsertDefaultViewOverride({
    orgId,
    userId,
    orgWide,
    config
}: {
    orgId: string;
    userId: string;
    orgWide: boolean;
    config: LauncherViewConfig;
}) {
    const now = moment().toISOString();
    const existing = await findDefaultViewOverride(orgId, orgWide, userId);

    if (existing) {
        const [updated] = await db
            .update(launcherViews)
            .set({
                config: JSON.stringify(config),
                updatedAt: now
            })
            .where(eq(launcherViews.viewId, existing.viewId))
            .returning();

        return mapViewRow(updated);
    }

    const [created] = await db
        .insert(launcherViews)
        .values({
            orgId,
            userId: orgWide ? null : userId,
            name: "",
            isDefault: true,
            config: JSON.stringify(config),
            createdAt: now,
            updatedAt: now
        })
        .returning();

    return mapViewRow(created);
}

export async function deleteDefaultViewOverride({
    orgId,
    userId,
    orgWide
}: {
    orgId: string;
    userId: string;
    orgWide: boolean;
}) {
    const existing = await findDefaultViewOverride(orgId, orgWide, userId);
    if (!existing) {
        return;
    }

    await db
        .delete(launcherViews)
        .where(eq(launcherViews.viewId, existing.viewId));
}

export async function deleteAllDefaultViewOverrides(
    orgId: string,
    userId: string
) {
    await deleteDefaultViewOverride({ orgId, userId, orgWide: false });
    await deleteDefaultViewOverride({ orgId, userId, orgWide: true });
}
