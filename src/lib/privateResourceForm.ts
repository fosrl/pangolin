import { z } from "zod";
import type { PrivateResourceRow } from "@app/components/PrivateResourcesTable";
import { SiteResource } from "@server/db";

export type PrivateResourceMode = SiteResource["mode"];

export type SiteResourceData = PrivateResourceRow & {
    enabled: boolean;
};

export type PortMode = "all" | "blocked" | "custom";

const tagSchema = z.object({ id: z.string(), text: z.string() });

export type PrivateResourceAccessTag = z.infer<typeof tagSchema>;

export type PrivateResourceClient = {
    clientId: number;
    name: string;
};

export type PrivateResourceFormValues = {
    name: string;
    siteIds?: number[];
    mode: PrivateResourceMode;
    destination: string | null;
    alias?: string | null;
    niceId?: string;
    enabled?: boolean;
    tcpPortRangeString?: string | null;
    udpPortRangeString?: string | null;
    disableIcmp?: boolean;
    authDaemonMode?: "site" | "remote" | "native" | null;
    authDaemonPort?: number | null;
    pamMode?: "passthrough" | "push" | null;
    destinationPort?: number | null;
    scheme?: "http" | "https";
    ssl?: boolean;
    httpConfigSubdomain?: string | null;
    httpConfigDomainId?: string | null;
    httpConfigFullDomain?: string | null;
    roles?: PrivateResourceAccessTag[];
    users?: PrivateResourceAccessTag[];
    clients?: PrivateResourceClient[];
    providerIds?: number[];
};

export type SiteResourceAccess = {
    roleIds: number[];
    userIds: string[];
    clientIds: number[];
};

type TranslateFn = (key: string) => string;

export const isValidPortRangeString = (
    val: string | undefined | null
): boolean => {
    if (!val || val.trim() === "" || val.trim() === "*") return true;
    const parts = val.split(",").map((p) => p.trim());
    for (const part of parts) {
        if (part === "") return false;
        if (part.includes("-")) {
            const [start, end] = part.split("-").map((p) => p.trim());
            if (!start || !end) return false;
            const startPort = parseInt(start, 10);
            const endPort = parseInt(end, 10);
            if (isNaN(startPort) || isNaN(endPort)) return false;
            if (
                startPort < 1 ||
                startPort > 65535 ||
                endPort < 1 ||
                endPort > 65535
            )
                return false;
            if (startPort > endPort) return false;
        } else {
            const port = parseInt(part, 10);
            if (isNaN(port) || port < 1 || port > 65535) return false;
        }
    }
    return true;
};

const getPortRangeValidationMessage = (t: TranslateFn) =>
    t("editInternalResourceDialogPortRangeValidationError");

export const createPortRangeStringSchema = (t: TranslateFn) =>
    z
        .string()
        .optional()
        .nullable()
        .refine((val) => isValidPortRangeString(val), {
            message: getPortRangeValidationMessage(t)
        });

export const getPortModeFromString = (
    val: string | undefined | null
): PortMode => {
    if (val === "*") return "all";
    if (!val || val.trim() === "") return "blocked";
    return "custom";
};

export const getPortStringFromMode = (
    mode: PortMode,
    customValue: string
): string | undefined => {
    if (mode === "all") return "*";
    if (mode === "blocked") return "";
    return customValue;
};

export const isHostname = (destination: string | null): boolean =>
    !!destination && /[a-zA-Z]/.test(destination);

export const cleanForFQDN = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "-")
        .replace(/[-]+/g, "-")
        .replace(/^-|-$/g, "")
        .replace(/^\.|\.$/g, "");

export function applyAliasAutoGeneration(
    values: PrivateResourceFormValues
): PrivateResourceFormValues {
    const data = { ...values };
    if (
        (data.mode === "host" ||
            data.mode === "http" ||
            (data.mode === "ssh" && data.authDaemonMode !== "native")) &&
        isHostname(data.destination)
    ) {
        const currentAlias = data.alias?.trim() || "";
        if (!currentAlias) {
            let aliasValue = data.destination!;
            if (data.destination?.toLowerCase() === "localhost") {
                aliasValue = `${cleanForFQDN(data.name)}.internal`;
            }
            data.alias = aliasValue;
        }
    }
    return data;
}

export function accessTagsToIds(access: {
    roles?: PrivateResourceAccessTag[];
    users?: PrivateResourceAccessTag[];
    clients?: PrivateResourceClient[];
}): SiteResourceAccess {
    return {
        roleIds: (access.roles ?? []).map((r) => parseInt(r.id)),
        userIds: (access.users ?? []).map((u) => u.id),
        clientIds: (access.clients ?? []).map((c) => c.clientId)
    };
}

export function buildCreateSiteResourcePayload(
    values: PrivateResourceFormValues
) {
    const data = applyAliasAutoGeneration(values);
    const isNativeSsh = data.mode === "ssh" && data.authDaemonMode === "native";

    return {
        name: data.name,
        siteIds: data.siteIds ?? [],
        mode: data.mode,
        destination:
            isNativeSsh || data.mode === "inference"
                ? undefined
                : (data.destination ?? undefined),
        ...(data.mode === "http" && {
            scheme: data.scheme,
            ssl: data.ssl ?? false,
            destinationPort: data.destinationPort ?? undefined,
            domainId: data.httpConfigDomainId
                ? data.httpConfigDomainId
                : undefined,
            subdomain: data.httpConfigSubdomain
                ? data.httpConfigSubdomain
                : undefined
        }),
        ...(data.mode === "host" && {
            alias:
                data.alias &&
                typeof data.alias === "string" &&
                data.alias.trim()
                    ? data.alias
                    : undefined,
            ...(data.authDaemonMode != null && {
                authDaemonMode: data.authDaemonMode
            }),
            ...(data.authDaemonMode === "remote" &&
                data.authDaemonPort != null && {
                    authDaemonPort: data.authDaemonPort
                })
        }),
        ...(data.mode === "ssh" && {
            alias:
                data.alias &&
                typeof data.alias === "string" &&
                data.alias.trim()
                    ? data.alias
                    : undefined,
            ...(!isNativeSsh && {
                destinationPort: data.destinationPort ?? undefined
            }),
            pamMode: data.pamMode ?? undefined,
            ...(data.authDaemonMode != null && {
                authDaemonMode: data.authDaemonMode
            }),
            ...(data.authDaemonMode === "remote" &&
                data.authDaemonPort != null && {
                    authDaemonPort: data.authDaemonPort
                })
        }),
        ...(data.mode === "inference" && {
            aiProviders: (data.providerIds ?? []).map((providerId) => ({
                providerId
            })),
            ssl: data.ssl ?? false,
            domainId: data.httpConfigDomainId
                ? data.httpConfigDomainId
                : undefined,
            subdomain: data.httpConfigSubdomain
                ? data.httpConfigSubdomain
                : undefined
        }),
        ...((data.mode === "host" || data.mode === "cidr") && {
            tcpPortRangeString: data.tcpPortRangeString,
            udpPortRangeString: data.udpPortRangeString,
            disableIcmp: data.disableIcmp ?? false
        }),
        roleIds: data.roles ? data.roles.map((r) => parseInt(r.id)) : [],
        userIds: data.users ? data.users.map((u) => u.id) : [],
        clientIds: data.clients ? data.clients.map((c) => c.clientId) : []
    };
}

export function buildUpdateSiteResourcePayload(
    values: PrivateResourceFormValues,
    access: SiteResourceAccess
) {
    const data = applyAliasAutoGeneration(values);
    const isNativeSsh = data.mode === "ssh" && data.authDaemonMode === "native";

    return {
        name: data.name,
        siteIds: data.siteIds,
        mode: data.mode,
        niceId: data.niceId,
        enabled: data.enabled,
        ...(isNativeSsh
            ? { destination: null, destinationPort: null }
            : data.mode !== "inference"
              ? { destination: data.destination ?? undefined }
              : {}),
        ...(data.mode === "http" && {
            scheme: data.scheme,
            ssl: data.ssl ?? false,
            destinationPort: data.destinationPort ?? null,
            domainId: data.httpConfigDomainId
                ? data.httpConfigDomainId
                : undefined,
            subdomain: data.httpConfigSubdomain
                ? data.httpConfigSubdomain
                : undefined
        }),
        ...(data.mode === "host" && {
            alias:
                data.alias &&
                typeof data.alias === "string" &&
                data.alias.trim()
                    ? data.alias
                    : null,
            ...(data.authDaemonMode != null && {
                authDaemonMode: data.authDaemonMode
            }),
            ...(data.authDaemonMode === "remote" && {
                authDaemonPort: data.authDaemonPort || null
            })
        }),
        ...(data.mode === "ssh" && {
            alias:
                data.alias &&
                typeof data.alias === "string" &&
                data.alias.trim()
                    ? data.alias
                    : null,
            ...(!isNativeSsh && {
                destinationPort: data.destinationPort ?? null
            }),
            pamMode: data.pamMode ?? undefined,
            ...(data.authDaemonMode != null && {
                authDaemonMode: data.authDaemonMode
            }),
            ...(data.authDaemonMode === "remote" && {
                authDaemonPort: data.authDaemonPort || null
            })
        }),
        ...(data.mode === "inference" && {
            alias:
                data.alias &&
                typeof data.alias === "string" &&
                data.alias.trim()
                    ? data.alias
                    : null,
            ssl: data.ssl ?? false,
            domainId: data.httpConfigDomainId
                ? data.httpConfigDomainId
                : undefined,
            subdomain: data.httpConfigSubdomain
                ? data.httpConfigSubdomain
                : undefined
        }),
        ...((data.mode === "host" || data.mode === "cidr") && {
            tcpPortRangeString: data.tcpPortRangeString,
            udpPortRangeString: data.udpPortRangeString,
            disableIcmp: data.disableIcmp ?? false
        }),
        roleIds: access.roleIds,
        userIds: access.userIds,
        clientIds: access.clientIds
    };
}

export function inferSshPamMode(
    authDaemonMode?: string | null,
    pamMode?: "passthrough" | "push" | null
): "passthrough" | "push" {
    if (pamMode === "passthrough" || pamMode === "push") {
        return pamMode;
    }

    return authDaemonMode === "remote" ? "push" : "passthrough";
}

export function siteResourceToFormValues(
    resource: SiteResourceData
): PrivateResourceFormValues {
    return {
        name: resource.name,
        siteIds: resource.siteIds,
        mode: resource.mode ?? "host",
        destination: resource.destination ?? "",
        alias: resource.alias ?? null,
        destinationPort: resource.destinationPort ?? null,
        scheme: resource.scheme ?? "http",
        ssl: resource.ssl ?? false,
        httpConfigSubdomain: resource.subdomain ?? null,
        httpConfigDomainId: resource.domainId ?? null,
        httpConfigFullDomain: resource.fullDomain ?? null,
        tcpPortRangeString: resource.tcpPortRangeString ?? "*",
        udpPortRangeString: resource.udpPortRangeString ?? "*",
        disableIcmp: resource.disableIcmp ?? false,
        authDaemonMode:
            resource.authDaemonMode === "native"
                ? "native"
                : (resource.authDaemonMode ?? "site"),
        authDaemonPort: resource.authDaemonPort ?? null,
        pamMode: inferSshPamMode(resource.authDaemonMode, resource.pamMode),
        niceId: resource.niceId,
        enabled: resource.enabled
    };
}

export function createGeneralFormSchema(
    t: TranslateFn,
    options?: { requireAlias?: boolean }
) {
    return z
        .object({
            name: z
                .string()
                .min(1, t("editInternalResourceDialogNameRequired"))
                .max(255, t("editInternalResourceDialogNameMaxLength")),
            niceId: z
                .string()
                .min(1)
                .max(255)
                .regex(/^[a-zA-Z0-9-]+$/),
            enabled: z.boolean(),
            alias: z.string().nullish()
        })
        .superRefine((data, ctx) => {
            if (options?.requireAlias && !data.alias?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("aiResourceAliasRequired"),
                    path: ["alias"]
                });
            }
        });
}

export function createAccessFormSchema() {
    return z.object({
        roles: z.array(tagSchema).optional(),
        users: z.array(tagSchema).optional(),
        clients: z
            .array(
                z.object({
                    clientId: z.number(),
                    name: z.string()
                })
            )
            .optional()
    });
}

export function createCreateFormSchema(t: TranslateFn) {
    const destinationRequired = t(
        "createInternalResourceDialogDestinationRequired"
    );

    return z
        .object({
            name: z
                .string()
                .min(1, t("createInternalResourceDialogNameRequired"))
                .max(255, t("createInternalResourceDialogNameMaxLength")),
            siteIds: z.array(z.number().int().positive()).optional(),
            mode: z.enum(["host", "cidr", "http", "ssh", "inference"]),
            destination: z.string().nullish(),
            alias: z.string().nullish(),
            destinationPort: z
                .number()
                .int()
                .min(1)
                .max(65535)
                .optional()
                .nullable(),
            scheme: z.enum(["http", "https"]).optional(),
            ssl: z.boolean().optional(),
            httpConfigSubdomain: z.string().nullish(),
            httpConfigDomainId: z.string().nullish(),
            httpConfigFullDomain: z.string().nullish(),
            authDaemonMode: z
                .enum(["site", "remote", "native"])
                .optional()
                .nullable(),
            standardDaemonLocation: z
                .enum(["site", "remote"])
                .optional()
                .nullable(),
            authDaemonPort: z.number().int().positive().optional().nullable(),
            pamMode: z.enum(["passthrough", "push"]).optional().nullable(),
            tcpPortRangeString: createPortRangeStringSchema(t),
            udpPortRangeString: createPortRangeStringSchema(t),
            disableIcmp: z.boolean().optional(),
            providerIds: z.array(z.number().int().positive()).optional()
        })
        .superRefine((data, ctx) => {
            const isNativeSsh =
                data.mode === "ssh" && data.authDaemonMode === "native";
            const trimmedDestination = data.destination?.trim();
            if (
                data.mode !== "inference" &&
                (!data.siteIds || data.siteIds.length < 1)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("createInternalResourceDialogPleaseSelectSite"),
                    path: ["siteIds"]
                });
            }
            if (
                data.mode !== "ssh" &&
                data.mode !== "inference" &&
                (!trimmedDestination || trimmedDestination.length < 1)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: destinationRequired,
                    path: ["destination"]
                });
            }
            if (data.mode === "ssh" && !isNativeSsh) {
                if (!trimmedDestination || trimmedDestination.length < 1) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: destinationRequired,
                        path: ["destination"]
                    });
                }
                if (
                    data.destinationPort == null ||
                    !Number.isFinite(data.destinationPort) ||
                    data.destinationPort < 1
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("internalResourceHttpPortRequired"),
                        path: ["destinationPort"]
                    });
                }
            }
            if (data.mode === "http") {
                if (!data.scheme) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("internalResourceDownstreamSchemeRequired"),
                        path: ["scheme"]
                    });
                }
                if (
                    data.destinationPort == null ||
                    !Number.isFinite(data.destinationPort) ||
                    data.destinationPort < 1
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("internalResourceHttpPortRequired"),
                        path: ["destinationPort"]
                    });
                }
                if (!data.httpConfigDomainId) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("domainRequired"),
                        path: ["httpConfigDomainId"]
                    });
                }
            }
        });
}

function destinationRefine(
    data: {
        mode: PrivateResourceMode;
        destination?: string | null;
        authDaemonMode?: string | null;
        destinationPort?: number | null;
        scheme?: string;
        httpConfigDomainId?: string | null;
    },
    ctx: z.RefinementCtx,
    t: TranslateFn,
    destinationRequired?: string
) {
    const isNativeSsh = data.mode === "ssh" && data.authDaemonMode === "native";
    const trimmedDestination = data.destination?.trim();
    if (
        data.mode !== "inference" &&
        !isNativeSsh &&
        (!trimmedDestination || trimmedDestination.length < 1)
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: destinationRequired ?? "Destination is required",
            path: ["destination"]
        });
    }
    if (data.mode === "ssh" && !isNativeSsh) {
        if (
            data.destinationPort == null ||
            !Number.isFinite(data.destinationPort) ||
            data.destinationPort < 1
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: t("internalResourceHttpPortRequired"),
                path: ["destinationPort"]
            });
        }
    }
    if (data.mode === "http") {
        if (!data.scheme) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: t("internalResourceDownstreamSchemeRequired"),
                path: ["scheme"]
            });
        }
        if (
            data.destinationPort == null ||
            !Number.isFinite(data.destinationPort) ||
            data.destinationPort < 1
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: t("internalResourceHttpPortRequired"),
                path: ["destinationPort"]
            });
        }
        if (!data.httpConfigDomainId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: t("domainRequired"),
                path: ["httpConfigDomainId"]
            });
        }
    }
}

export function createHostFormSchema(t: TranslateFn) {
    return z
        .object({
            siteIds: z.array(z.number().int().positive()).min(1),
            mode: z.literal("host"),
            destination: z.string().nullish(),
            alias: z.string().nullish(),
            tcpPortRangeString: createPortRangeStringSchema(t),
            udpPortRangeString: createPortRangeStringSchema(t),
            disableIcmp: z.boolean().optional(),
            authDaemonMode: z
                .enum(["site", "remote", "native"])
                .optional()
                .nullable(),
            authDaemonPort: z.number().int().positive().optional().nullable()
        })
        .superRefine((data, ctx) => destinationRefine(data, ctx, t));
}

export function createInferenceFormSchema(t: TranslateFn) {
    return z
        .object({
            mode: z.literal("inference"),
            alias: z.string().nullish(),
            providerIds: z.array(z.number().int().positive()).optional()
        })
        .superRefine((data, ctx) => {
            const trimmedAlias = data.alias?.trim();
            if (!trimmedAlias) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("aiResourceAliasRequired"),
                    path: ["alias"]
                });
            }
        });
}

export function createCidrFormSchema(t: TranslateFn) {
    return z
        .object({
            siteIds: z.array(z.number().int().positive()).min(1),
            mode: z.literal("cidr"),
            destination: z.string().nullish(),
            tcpPortRangeString: createPortRangeStringSchema(t),
            udpPortRangeString: createPortRangeStringSchema(t),
            disableIcmp: z.boolean().optional()
        })
        .superRefine((data, ctx) => destinationRefine(data, ctx, t));
}

export function createHttpFormSchema(t: TranslateFn) {
    return z
        .object({
            siteIds: z.array(z.number().int().positive()).min(1),
            mode: z.literal("http"),
            destination: z.string().nullish(),
            destinationPort: z
                .number()
                .int()
                .min(1)
                .max(65535)
                .optional()
                .nullable(),
            scheme: z.enum(["http", "https"]).optional(),
            ssl: z.boolean().optional(),
            httpConfigSubdomain: z.string().nullish(),
            httpConfigDomainId: z.string().nullish(),
            httpConfigFullDomain: z.string().nullish()
        })
        .superRefine((data, ctx) => destinationRefine(data, ctx, t));
}

export function createSshFormSchema(
    t: TranslateFn,
    options?: { isNative?: boolean }
) {
    const isNative = options?.isNative ?? false;

    return z
        .object({
            siteIds: z.array(z.number().int().positive()).min(1),
            mode: z.literal("ssh"),
            destination: z.string().nullish(),
            alias: z.string().nullish(),
            destinationPort: z
                .number()
                .int()
                .min(1)
                .max(65535)
                .optional()
                .nullable(),
            pamMode: z.enum(["passthrough", "push"]),
            standardDaemonLocation: z.enum(["site", "remote"]),
            authDaemonPort: z.string()
        })
        .superRefine((data, ctx) => {
            destinationRefine(
                {
                    ...data,
                    authDaemonMode: isNative
                        ? "native"
                        : data.standardDaemonLocation
                },
                ctx,
                t
            );

            const showDaemonPort =
                !isNative &&
                data.pamMode === "push" &&
                data.standardDaemonLocation === "remote";

            if (showDaemonPort) {
                const port = Number(data.authDaemonPort);
                if (
                    !data.authDaemonPort.trim() ||
                    !Number.isInteger(port) ||
                    port < 1 ||
                    port > 65535
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("healthCheckPortInvalid"),
                        path: ["authDaemonPort"]
                    });
                }
            }
        });
}

export function mergeFormValuesWithResource(
    resource: SiteResourceData,
    partial: Partial<PrivateResourceFormValues>
): PrivateResourceFormValues {
    return {
        ...siteResourceToFormValues(resource),
        ...partial
    };
}
