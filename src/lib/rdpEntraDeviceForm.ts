import { z } from "zod";

type TranslateFn = (key: string) => string;

const ENTRA_DEVICE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRdpEntraDeviceFormSchema(t: TranslateFn) {
    return z.object({
        // Empty means no device is set for the resource.
        rdpEntraDeviceId: z
            .string()
            .trim()
            .refine(
                (value) =>
                    value.length === 0 || ENTRA_DEVICE_ID_PATTERN.test(value),
                { message: t("rdpEntraDeviceIdInvalid") }
            )
    });
}

export type RdpEntraDeviceFormValues = z.infer<
    ReturnType<typeof createRdpEntraDeviceFormSchema>
>;
