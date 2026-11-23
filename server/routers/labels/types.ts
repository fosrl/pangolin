import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import { PaginationSchema } from "@server/lib/openapi/pagination";
import { labels } from "@server/db";

export const LabelSchema = createSelectSchema(labels, {
    color: (s) =>
        s.openapi({ description: "Label color, for example a hex code." }),
    labelId: (s) => s.openapi({ description: "Numeric ID of the label." }),
    name: (s) => s.openapi({ description: "Label name." }),
    orgId: (s) => s.openapi({ description: "ID of the organization." })
});

export const LabelListItemSchema = LabelSchema.omit({ orgId: true });

export const ListOrgLabelsResponseDataSchema = z.object({
    labels: z.array(LabelListItemSchema),
    pagination: PaginationSchema
});
export type ListOrgLabelsResponse = z.infer<
    typeof ListOrgLabelsResponseDataSchema
>;

export const LabelEnvelopeSchema = z.object({ label: LabelSchema });
export type CreateOrEditLabelResponse = z.infer<typeof LabelEnvelopeSchema>;
