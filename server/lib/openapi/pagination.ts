import "@server/extendZod";
import { z } from "zod";

/** Matches `Pagination` in @server/types/Pagination. */
export const PaginationSchema = z.object({
    total: z.number().int().openapi({
        description: "Total number of items matching the query."
    }),
    pageSize: z.number().int().openapi({
        description: "Maximum number of items per page."
    }),
    page: z.number().int().openapi({
        description: "Current page, starting at 1."
    })
});

/** For endpoints that paginate with `limit` and `offset` instead of pages. */
export const LimitOffsetPaginationSchema = z.object({
    total: z.number().int().openapi({
        description: "Total number of items matching the query."
    }),
    limit: z.number().int().openapi({
        description: "Maximum number of items returned."
    }),
    offset: z.number().int().openapi({
        description: "Number of items skipped."
    })
});
