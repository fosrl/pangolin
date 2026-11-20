import { build } from "@server/build";
import {
    clients,
    currentFingerprint,
    db,
    idp,
    idpOidcConfig,
    olms,
    orgs,
    roleClients,
    userClients,
    users
} from "@server/db";
import { getUserDeviceName } from "@server/db/names";
import response from "@server/lib/response";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import { PaginationSchema } from "@server/lib/openapi/pagination";
import { createApiSuccessResponses } from "@server/lib/openapi/createApiResponseSchema";
import HttpCode from "@server/types/HttpCode";
import type { PaginatedResponse } from "@server/types/Pagination";
import {
    and,
    asc,
    desc,
    eq,
    inArray,
    isNotNull,
    isNull,
    like,
    or,
    sql,
    type SQL
} from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import semver from "semver";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { createSelectSchema } from "drizzle-zod";

const listUserDevicesParamsSchema = z.strictObject({
    orgId: z.string()
});

const listUserDevicesSchema = z.strictObject({
    pageSize: z.coerce
        .number<string>() // for prettier formatting
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20)
        .openapi({
            type: "integer",
            default: 20,
            description: "Number of items per page"
        }),
    page: z.coerce
        .number<string>() // for prettier formatting
        .int()
        .min(0)
        .optional()
        .catch(1)
        .default(1)
        .openapi({
            type: "integer",
            default: 1,
            description: "Page number to retrieve"
        }),
    query: z.string().optional(),
    sort_by: z
        .enum(["megabytesIn", "megabytesOut", "firstSeen", "lastSeen"])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: ["megabytesIn", "megabytesOut", "firstSeen", "lastSeen"],
            description: "Field to sort by"
        }),
    order: z
        .enum(["asc", "desc"])
        .optional()
        .default("asc")
        .catch("asc")
        .openapi({
            type: "string",
            enum: ["asc", "desc"],
            default: "asc",
            description: "Sort order"
        }),
    online: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional()
        .catch(undefined)
        .openapi({
            type: "boolean",
            description: "Filter by online status"
        }),
    agent: z
        .enum([
            "windows",
            "android",
            "cli",
            "olm",
            "macos",
            "ios",
            "ipados",
            "unknown"
        ])
        .optional()
        .catch(undefined)
        .openapi({
            type: "string",
            enum: [
                "windows",
                "android",
                "cli",
                "olm",
                "macos",
                "ios",
                "ipados",
                "unknown"
            ],
            description:
                "Filter by agent type. Use 'unknown' to filter clients with no agent detected."
        }),
    userId: z.string().nonempty().optional().catch(undefined).openapi({
        type: "string",
        description: "Filter by user ID"
    }),
    status: z.preprocess(
        (val: string | undefined) => {
            if (val) {
                return val.split(","); // the search query array is an array joined by commas
            }
            return undefined;
        },
        z
            .array(
                z.enum(["active", "pending", "denied", "blocked", "archived"])
            )
            .optional()
            .default(["active", "pending"])
            .catch(["active", "pending"])
            .openapi({
                type: "array",
                items: {
                    type: "string",
                    enum: ["active", "pending", "denied", "blocked", "archived"]
                },
                default: ["active", "pending"],
                description:
                    "Filter by device status. Can include multiple values separated by commas. 'active' means not archived, not blocked, and if approval is enabled, approved. 'pending' and 'denied' are only applicable if approval is enabled."
            })
    )
});

function queryUserDevicesBase() {
    return db
        .select({
            clientId: clients.clientId,
            orgId: clients.orgId,
            name: clients.name,
            pubKey: clients.pubKey,
            subnet: clients.subnet,
            megabytesIn: clients.megabytesIn,
            megabytesOut: clients.megabytesOut,
            orgName: orgs.name,
            type: clients.type,
            online: clients.online,
            olmVersion: olms.version,
            userId: clients.userId,
            username: users.username,
            userEmail: users.email,
            userType: users.type,
            idpName: idp.name,
            idpVariant: idpOidcConfig.variant,
            niceId: clients.niceId,
            agent: olms.agent,
            agentVersion: olms.agentVersion,
            approvalState: clients.approvalState,
            olmArchived: olms.archived,
            archived: clients.archived,
            blocked: clients.blocked,
            deviceModel: currentFingerprint.deviceModel,
            fingerprintPlatform: currentFingerprint.platform,
            fingerprintOsVersion: currentFingerprint.osVersion,
            fingerprintKernelVersion: currentFingerprint.kernelVersion,
            fingerprintArch: currentFingerprint.arch,
            fingerprintSerialNumber: currentFingerprint.serialNumber,
            fingerprintUsername: currentFingerprint.username,
            fingerprintHostname: currentFingerprint.hostname,
            firstSeen: currentFingerprint.firstSeen,
            lastSeen: currentFingerprint.lastSeen
        })
        .from(clients)
        .leftJoin(orgs, eq(clients.orgId, orgs.orgId))
        .leftJoin(olms, eq(clients.clientId, olms.clientId))
        .leftJoin(users, eq(clients.userId, users.userId))
        .leftJoin(idp, eq(users.idpId, idp.idpId))
        .leftJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .leftJoin(currentFingerprint, eq(olms.olmId, currentFingerprint.olmId));
}

type OlmWithUpdateAvailable = Awaited<
    ReturnType<typeof queryUserDevicesBase>
>[0] & {
    olmUpdateAvailable?: boolean;
};

export type ListUserDevicesResponse = z.infer<
    typeof ListUserDevicesResponseDataSchema
>;

const UserDeviceListItemSchema = createSelectSchema(clients, {
    clientId: (s) => s.openapi({ description: "Numeric ID of the client." }),
    orgId: (s) =>
        s.openapi({
            description: "ID of the organization the client belongs to."
        }),
    niceId: (s) =>
        s.openapi({
            description:
                "Human readable ID of the client, unique within the organization."
        }),
    name: (s) => s.openapi({ description: "Client name." }),
    pubKey: (s) =>
        s.openapi({ description: "WireGuard public key of the client." }),
    subnet: (s) =>
        s.openapi({
            description:
                "Address assigned to the client inside the overlay network."
        }),
    megabytesIn: (s) =>
        s.openapi({ description: "Megabytes received from the client." }),
    megabytesOut: (s) =>
        s.openapi({ description: "Megabytes sent to the client." }),
    type: (s) => s.openapi({ description: "Kind of client, for example olm." }),
    online: (s) =>
        s.openapi({
            description: "Whether the client is currently connected."
        }),
    userId: (s) =>
        s.openapi({
            description:
                "ID of the user that owns the client. Null for machine clients."
        }),
    approvalState: z
        .enum(["approved", "denied", "pending"])
        .nullable()
        .openapi({
            description:
                "Whether the client was approved by an admin. Only set when the owner's role requires device approval."
        }),
    archived: (s) =>
        s.openapi({
            description: "Whether the client is archived and hidden from lists."
        }),
    blocked: (s) =>
        s.openapi({
            description: "Whether the client is blocked from connecting."
        })
})
    .pick({
        clientId: true,
        orgId: true,
        niceId: true,
        name: true,
        pubKey: true,
        subnet: true,
        megabytesIn: true,
        megabytesOut: true,
        type: true,
        online: true,
        userId: true,
        approvalState: true,
        archived: true,
        blocked: true
    })
    .extend({
        orgName: z.string().nullable().openapi({
            description: "Name of the organization the device belongs to."
        }),
        olmVersion: z
            .string()
            .nullable()
            .openapi({ description: "Version of the Olm agent." }),
        username: z
            .string()
            .nullable()
            .openapi({ description: "Username of the owning user." }),
        userEmail: z
            .string()
            .nullable()
            .openapi({ description: "Email of the owning user." }),
        userType: z.string().nullable().openapi({
            description: "Sign-in type of the owning user."
        }),
        idpName: z.string().nullable().openapi({
            description:
                "Name of the identity provider the owning user belongs to."
        }),
        idpVariant: z.string().nullable().openapi({
            description: "Variant of the identity provider."
        }),
        agent: z
            .string()
            .nullable()
            .openapi({ description: "Name of the agent software." }),
        agentVersion: z.string().nullable().openapi({
            description: "Version of the agent software."
        }),
        olmArchived: z.boolean().nullable().openapi({
            description: "Whether the device's Olm agent is archived."
        }),
        deviceModel: z
            .string()
            .nullable()
            .openapi({ description: "Device model." }),
        fingerprintPlatform: z
            .string()
            .nullable()
            .openapi({ description: "Operating system platform." }),
        fingerprintOsVersion: z
            .string()
            .nullable()
            .openapi({ description: "Operating system version." }),
        fingerprintKernelVersion: z
            .string()
            .nullable()
            .openapi({ description: "Kernel version." }),
        fingerprintArch: z
            .string()
            .nullable()
            .openapi({ description: "CPU architecture." }),
        fingerprintSerialNumber: z
            .string()
            .nullable()
            .openapi({ description: "Device serial number." }),
        fingerprintUsername: z.string().nullable().openapi({
            description: "OS username the client runs as."
        }),
        fingerprintHostname: z
            .string()
            .nullable()
            .openapi({ description: "Device hostname." }),
        firstSeen: z.number().int().nullable().openapi({
            description: "Epoch seconds when the device was first seen."
        }),
        lastSeen: z.number().int().nullable().openapi({
            description: "Epoch seconds when the device was last seen."
        }),
        olmUpdateAvailable: z.boolean().optional().openapi({
            description: "Whether a newer Olm version is available."
        })
    });

const ListUserDevicesResponseDataSchema = z.object({
    devices: z.array(UserDeviceListItemSchema),
    pagination: PaginationSchema
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/user-devices",
    description: "List all user devices for an organization.",
    tags: [OpenAPITags.Client],
    request: {
        query: listUserDevicesSchema,
        params: listUserDevicesParamsSchema
    },
    responses: createApiSuccessResponses(ListUserDevicesResponseDataSchema)
});

export async function listUserDevices(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listUserDevicesSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const {
            page,
            pageSize,
            query,
            sort_by,
            online,
            status,
            agent,
            userId,
            order
        } = parsedQuery.data;

        const parsedParams = listUserDevicesParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }
        const { orgId } = parsedParams.data;

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        let accessibleClients;
        if (req.user) {
            accessibleClients = await db
                .select({
                    clientId: sql<number>`COALESCE(${userClients.clientId}, ${roleClients.clientId})`
                })
                .from(userClients)
                .fullJoin(
                    roleClients,
                    eq(userClients.clientId, roleClients.clientId)
                )
                .where(
                    or(
                        eq(userClients.userId, req.user!.userId),
                        inArray(roleClients.roleId, req.userOrgRoleIds!)
                    )
                );
        } else {
            accessibleClients = await db
                .select({ clientId: clients.clientId })
                .from(clients)
                .where(eq(clients.orgId, orgId));
        }

        const accessibleClientIds = accessibleClients.map(
            (client) => client.clientId
        );
        // Get client count with filter
        const conditions = [
            and(
                inArray(clients.clientId, accessibleClientIds),
                eq(clients.orgId, orgId),
                isNotNull(clients.userId)
            )
        ];

        if (query) {
            conditions.push(
                or(
                    like(
                        sql`LOWER(${clients.name})`,
                        "%" + query.toLowerCase() + "%"
                    ),
                    like(
                        sql`LOWER(${clients.niceId})`,
                        "%" + query.toLowerCase() + "%"
                    ),
                    like(
                        sql`LOWER(${users.email})`,
                        "%" + query.toLowerCase() + "%"
                    )
                )
            );
        }

        if (typeof online !== "undefined") {
            conditions.push(eq(clients.online, online));
        }

        if (typeof userId !== "undefined") {
            conditions.push(eq(clients.userId, userId));
        }

        const agentValueMap = {
            windows: "Pangolin Windows",
            android: "Pangolin Android",
            ios: "Pangolin iOS",
            ipados: "Pangolin iPadOS",
            macos: "Pangolin macOS",
            cli: "Pangolin CLI",
            olm: "Olm CLI"
        } satisfies Record<
            Exclude<typeof agent, undefined | "unknown">,
            string
        >;
        if (typeof agent !== "undefined") {
            if (agent === "unknown") {
                conditions.push(isNull(olms.agent));
            } else {
                conditions.push(eq(olms.agent, agentValueMap[agent]));
            }
        }

        if (status.length > 0) {
            const filterAggregates: (SQL<unknown> | undefined)[] = [];

            if (status.includes("active")) {
                filterAggregates.push(
                    and(
                        eq(clients.archived, false),
                        eq(clients.blocked, false),
                        build !== "oss"
                            ? or(
                                  eq(clients.approvalState, "approved"),
                                  isNull(clients.approvalState) // approval state of `NULL` means approved by default
                              )
                            : undefined // undefined are automatically ignored by `drizzle-orm`
                    )
                );
            }

            if (status.includes("archived")) {
                filterAggregates.push(eq(clients.archived, true));
            }
            if (status.includes("blocked")) {
                filterAggregates.push(eq(clients.blocked, true));
            }

            if (build !== "oss") {
                if (status.includes("pending")) {
                    filterAggregates.push(eq(clients.approvalState, "pending"));
                }
                if (status.includes("denied")) {
                    filterAggregates.push(eq(clients.approvalState, "denied"));
                }
            }

            conditions.push(or(...filterAggregates));
        }

        const baseQuery = queryUserDevicesBase().where(and(...conditions));

        const countQuery = db.$count(baseQuery.as("filtered_clients"));

        const sortColumn =
            sort_by === "firstSeen"
                ? currentFingerprint.firstSeen
                : sort_by === "lastSeen"
                  ? currentFingerprint.lastSeen
                  : sort_by
                    ? clients[sort_by]
                    : undefined;

        const listDevicesQuery = baseQuery
            .limit(pageSize)
            .offset(pageSize * (page - 1))
            .orderBy(
                sortColumn
                    ? order === "asc"
                        ? asc(sortColumn)
                        : desc(sortColumn)
                    : asc(clients.clientId)
            );

        const [clientsList, totalCount] = await Promise.all([
            listDevicesQuery,
            countQuery
        ]);

        // Merge clients with their site associations and replace name with device name
        const olmsWithUpdates: OlmWithUpdateAvailable[] = clientsList.map(
            (client) => {
                const model = client.deviceModel || null;
                const newName = getUserDeviceName(model, client.name);
                const OlmWithUpdate: OlmWithUpdateAvailable = {
                    ...client,
                    name: newName
                };
                // Initially set to false, will be updated if version check succeeds
                OlmWithUpdate.olmUpdateAvailable = false;
                return OlmWithUpdate;
            }
        );

        return response<ListUserDevicesResponse>(res, {
            data: {
                devices: olmsWithUpdates,
                pagination: {
                    total: totalCount,
                    page,
                    pageSize
                }
            },
            success: true,
            error: false,
            message: "Clients retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
