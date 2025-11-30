import { db } from "@server/db";
import { newts, sites } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import stoi from "@server/lib/stoi";
import { sendToClient } from "#dynamic/routers/ws";
import {
    fetchContainers,
    dockerSocket
} from "../newt/dockerSocket";
import cache from "@server/lib/cache";

export interface ContainerNetwork {
    networkId: string;
    endpointId: string;
    gateway?: string;
    ipAddress?: string;
    ipPrefixLen?: number;
    macAddress?: string;
    aliases?: string[];
    dnsNames?: string[];
}

export interface ContainerPort {
    privatePort: number;
    publicPort?: number;
    type: "tcp" | "udp";
    ip?: string;
}

export interface Container {
    id: string;
    name: string;
    image: string;
    state: "running" | "exited" | "paused" | "created";
    status: string;
    ports?: ContainerPort[];
    labels: Record<string, string>;
    created: number;
    networks: Record<string, ContainerNetwork>;
}

const siteIdParamsSchema = z
    .object({
        siteId: z.string().transform(stoi).pipe(z.number().int().positive())
    })
    .strict();

const DockerStatusSchema = z
    .object({
        isAvailable: z.boolean(),
        socketPath: z.string().optional()
    })
    .strict();

function validateSiteIdParams(params: any) {
    const parsedParams = siteIdParamsSchema.safeParse(params);
    if (!parsedParams.success) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            fromError(parsedParams.error)
        );
    }
    return parsedParams.data;
}

async function getSiteAndValidateNewt(siteId: number) {
    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site) {
        throw createHttpError(HttpCode.NOT_FOUND, "Site not found");
    }

    if (site.type !== "newt") {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "This endpoint is only for Newt sites"
        );
    }

    return site;
}

async function getNewtBySiteId(siteId: number) {
    const [newt] = await db
        .select()
        .from(newts)
        .where(eq(newts.siteId, siteId))
        .limit(1);

    if (!newt) {
        throw createHttpError(HttpCode.NOT_FOUND, "Newt not found for site");
    }

    return newt;
}

async function getSiteAndNewt(siteId: number) {
    const site = await getSiteAndValidateNewt(siteId);
    const newt = await getNewtBySiteId(siteId);
    return { site, newt };
}

function asyncHandler(
    operation: (siteId: number) => Promise<any>,
    successMessage: string
) {
    return async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> => {
        try {
            const { siteId } = validateSiteIdParams(req.params);
            const result = await operation(siteId);

            return response(res, {
                data: result,
                success: true,
                error: false,
                message: successMessage,
                status: HttpCode.OK
            });
        } catch (error) {
            if (createHttpError.isHttpError(error)) {
                return next(error);
            }
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "An error occurred"
                )
            );
        }
    };
}

// Core business logic functions
async function triggerFetch(siteId: number) {
    const { newt } = await getSiteAndNewt(siteId);

    logger.info(
        `Triggering fetch containers for site ${siteId} with Newt ${newt.newtId}`
    );
    fetchContainers(newt.newtId);

    // clear the cache for this Newt ID so that the site has to keep asking for the containers
    // this is to ensure that the site always gets the latest data
    cache.del(`${newt.newtId}:dockerContainers`);

    return { siteId, newtId: newt.newtId };
}

async function queryContainers(siteId: number) {
    const { newt } = await getSiteAndNewt(siteId);

    const result = cache.get(
        `${newt.newtId}:dockerContainers`
    ) as Container[];
    if (!result) {
        throw createHttpError(
            HttpCode.TOO_EARLY,
            "Nothing found yet. Perhaps the fetch is still in progress? Wait a bit and try again."
        );
    }

    return result;
}

async function isDockerAvailable(siteId: number): Promise<boolean> {
    const { newt } = await getSiteAndNewt(siteId);

    const key = `${newt.newtId}:isAvailable`;
    const isAvailable = cache.get(key);

    return !!isAvailable;
}

async function getDockerStatus(
    siteId: number
): Promise<z.infer<typeof DockerStatusSchema>> {
    const { newt } = await getSiteAndNewt(siteId);

    const keys = ["isAvailable", "socketPath"];
    const mappedKeys = keys.map((x) => `${newt.newtId}:${x}`);

    const result = {
        isAvailable: cache.get(mappedKeys[0]) as boolean,
        socketPath: cache.get(mappedKeys[1]) as string | undefined
    };

    return result;
}

async function checkSocket(
    siteId: number
): Promise<{ siteId: number; newtId: string }> {
    const { newt } = await getSiteAndNewt(siteId);

    logger.info(
        `Checking Docker socket for site ${siteId} with Newt ${newt.newtId}`
    );

    // Trigger the Docker socket check
    dockerSocket(newt.newtId);
    return { siteId, newtId: newt.newtId };
}

// Export types
export type GetDockerStatusResponse = NonNullable<
    Awaited<ReturnType<typeof getDockerStatus>>
>;

export type ListContainersResponse = Awaited<
    ReturnType<typeof queryContainers>
>;

export type TriggerFetchResponse = Awaited<ReturnType<typeof triggerFetch>>;

// Route handlers
export const triggerFetchContainers = asyncHandler(
    triggerFetch,
    "Fetch containers triggered successfully"
);

export const listContainers = asyncHandler(
    queryContainers,
    "Containers retrieved successfully"
);

export const dockerOnline = asyncHandler(async (siteId: number) => {
    const isAvailable = await isDockerAvailable(siteId);
    return { isAvailable };
}, "Docker availability checked successfully");

export const dockerStatus = asyncHandler(
    getDockerStatus,
    "Docker status retrieved successfully"
);

export async function checkDockerSocket(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const { siteId } = validateSiteIdParams(req.params);
        const result = await checkSocket(siteId);

        // Notify the Newt client about the Docker socket check
        sendToClient(result.newtId, {
            type: "newt/socket/check",
            data: {}
        });

        return response(res, {
            data: result,
            success: true,
            error: false,
            message: "Docker socket checked successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        if (createHttpError.isHttpError(error)) {
            return next(error);
        }
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
