import {
    labels,
    resourceLabels,
    siteResourceLabels,
    Transaction
} from "@server/db";
import logger from "@server/logger";
import { and, eq, sql } from "drizzle-orm";

// Matches the "gray" swatch in the label color palette used by the UI
// (src/components/labels-selector.tsx), used as the default for labels
// auto-created from a blueprint where no color is specified.
const DEFAULT_LABEL_COLOR = "#b4b4b4";

/**
 * Looks up labels by name (case-insensitive) within an org, auto-creating
 * any that don't already exist. Returns the resolved, de-duplicated labelIds.
 */
export async function getOrCreateLabelIds(
    orgId: string,
    labelNames: string[],
    trx: Transaction
): Promise<number[]> {
    const labelIds = new Set<number>();

    for (const name of labelNames) {
        let [label] = await trx
            .select({ labelId: labels.labelId })
            .from(labels)
            .where(
                and(
                    eq(labels.orgId, orgId),
                    sql`LOWER(${labels.name}) = ${name.toLowerCase()}`
                )
            )
            .limit(1);

        if (!label) {
            [label] = await trx
                .insert(labels)
                .values({ name, color: DEFAULT_LABEL_COLOR, orgId })
                .returning({ labelId: labels.labelId });
            logger.info(
                `Auto-created label "${name}" in org ${orgId} from blueprint`
            );
        }

        labelIds.add(label.labelId);
    }

    return Array.from(labelIds);
}

export async function syncResourceLabels(
    resourceId: number,
    labelIds: number[],
    trx: Transaction
) {
    await trx
        .delete(resourceLabels)
        .where(eq(resourceLabels.resourceId, resourceId));

    if (labelIds.length > 0) {
        await trx
            .insert(resourceLabels)
            .values(labelIds.map((labelId) => ({ resourceId, labelId })));
    }
}

export async function syncSiteResourceLabels(
    siteResourceId: number,
    labelIds: number[],
    trx: Transaction
) {
    await trx
        .delete(siteResourceLabels)
        .where(eq(siteResourceLabels.siteResourceId, siteResourceId));

    if (labelIds.length > 0) {
        await trx
            .insert(siteResourceLabels)
            .values(
                labelIds.map((labelId) => ({ siteResourceId, labelId }))
            );
    }
}
