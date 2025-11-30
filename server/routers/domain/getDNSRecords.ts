import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, dnsRecords } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { getServerIp } from "@server/lib/serverIpService"; // your in-memory IP module

const getDNSRecordsSchema = z
    .object({
        domainId: z.string(),
        orgId: z.string()
    })
    .strict();

async function query(domainId: string) {
    const records = await db
        .select()
        .from(dnsRecords)
        .where(eq(dnsRecords.domainId, domainId));
    
    return records;
}

export type GetDNSRecordsResponse = Awaited<ReturnType<typeof query>>;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/domain/{domainId}/dns-records",
    description: "Get all DNS records for a domain by domainId.",
    tags: [OpenAPITags.Domain],
    request: {
        params: z.object({
            domainId: z.string(),
            orgId: z.string()
        })
    },
    responses: {}
});

export async function getDNSRecords(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = getDNSRecordsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { domainId } = parsedParams.data;

        const records = await query(domainId);

        if (!records || records.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "No DNS records found for this domain"
                )
            );
        }

        const serverIp = getServerIp();

        // Override value for type A or wildcard records
        const updatedRecords = records.map(record => {
            if ((record.recordType === "A" || record.baseDomain === "*") && serverIp) {
                return { ...record, value: serverIp };
            }
            return record;
        });

        return response<GetDNSRecordsResponse>(res, {
            data: updatedRecords,
            success: true,
            error: false,
            message: "DNS records retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}