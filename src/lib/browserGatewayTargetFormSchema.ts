import { z } from "zod";

type TranslateFn = (key: string) => string;

export const selectedSiteSchema = z.object({
    siteId: z.number().int().positive(),
    name: z.string(),
    type: z.string()
});

export type SelectedSiteFormValue = z.infer<typeof selectedSiteSchema>;

export function createPortStringSchema(t: TranslateFn) {
    return z.string().refine(
        (val) => {
            if (!val) return false;
            const n = Number(val);
            return Number.isInteger(n) && n >= 1 && n <= 65535;
        },
        { message: t("healthCheckPortInvalid") }
    );
}

function createOptionalAuthDaemonPortSchema(t: TranslateFn) {
    return z.string().refine(
        (val) => {
            if (!val) return true;
            const n = Number(val);
            return Number.isInteger(n) && n >= 1 && n <= 65535;
        },
        { message: t("healthCheckPortInvalid") }
    );
}

export function createBrowserGatewayTargetFormSchema(t: TranslateFn) {
    return z.object({
        selectedSites: z.array(selectedSiteSchema).min(1, {
            message: t("siteRequired")
        }),
        destination: z.string().min(1, {
            message: t("destinationRequired")
        }),
        destinationPort: createPortStringSchema(t)
    });
}

export type BrowserGatewayTargetFormValues = z.infer<
    ReturnType<typeof createBrowserGatewayTargetFormSchema>
>;

export function createSshSettingsFormSchema(
    t: TranslateFn,
    options: { isNative: boolean }
) {
    const { isNative } = options;
    const portSchema = createPortStringSchema(t);
    const optionalAuthDaemonPortSchema = createOptionalAuthDaemonPortSchema(t);

    return z
        .object({
            pamMode: z.enum(["passthrough", "push"]),
            standardDaemonLocation: z.enum(["site", "remote"]),
            authDaemonPort: z.string(),
            selectedSites: z.array(selectedSiteSchema),
            selectedSite: selectedSiteSchema.nullable(),
            selectedNativeSite: selectedSiteSchema.nullable(),
            destination: z.string(),
            destinationPort: z.string()
        })
        .superRefine((data, ctx) => {
            if (isNative) {
                if (!data.selectedNativeSite) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["selectedNativeSite"],
                        message: t("siteRequired")
                    });
                }
                return;
            }

            const useMultiSite =
                data.standardDaemonLocation !== "site" ||
                data.pamMode === "passthrough";

            if (useMultiSite) {
                if (data.selectedSites.length === 0) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["selectedSites"],
                        message: t("siteRequired")
                    });
                }
            } else if (!data.selectedSite) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["selectedSite"],
                    message: t("siteRequired")
                });
            }

            if (!data.destination.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["destination"],
                    message: t("destinationRequired")
                });
            }

            const portResult = portSchema.safeParse(data.destinationPort);
            if (!portResult.success) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["destinationPort"],
                    message: t("healthCheckPortInvalid")
                });
            }

            const showDaemonPort =
                data.pamMode === "push" &&
                data.standardDaemonLocation === "remote";

            if (showDaemonPort) {
                const authPortResult = optionalAuthDaemonPortSchema.safeParse(
                    data.authDaemonPort
                );
                if (!data.authDaemonPort.trim() || !authPortResult.success) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["authDaemonPort"],
                        message: t("healthCheckPortInvalid")
                    });
                }
            }
        });
}

export type SshSettingsFormValues = z.infer<
    ReturnType<typeof createSshSettingsFormSchema>
>;
