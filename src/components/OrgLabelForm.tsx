"use client";

import z from "zod";
import { Input } from "./ui/input";
import { useTranslations } from "use-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "./ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "./ui/select";
import { LABEL_COLORS } from "./labels-selector";

const labelFormSchema = z.object({
    name: z.string().nonempty(),
    color: z
        .string()
        .regex(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)
        .nonempty()
});

export type LabelFormData = z.infer<typeof labelFormSchema>;

export type OrgLabelFormProps = {
    onSubmit: (data: LabelFormData) => void;
    defaultValue?: LabelFormData;
    disabled?: boolean;
};

export function OrgLabelForm({
    onSubmit,
    defaultValue,
    disabled = false
}: OrgLabelFormProps) {
    const t = useTranslations();

    const colorValues = Object.values(LABEL_COLORS);
    const randomColor =
        colorValues[Math.floor(Math.random() * colorValues.length)];

    const form = useForm({
        resolver: zodResolver(labelFormSchema),
        defaultValues: {
            name: defaultValue?.name ?? "",
            color: defaultValue?.color ?? randomColor
        }
    });

    return (
        <Form {...form}>
            <form
                id="org-label-form"
                className="flex flex-col gap-4 px-0.5"
                action={async () => {
                    if (await form.trigger()) {
                        onSubmit(form.getValues());
                    }
                }}
            >
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t("labelNameField")}</FormLabel>
                            <FormControl>
                                <Input {...field} disabled={disabled} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="color"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t("labelColorField")}</FormLabel>
                            <Select
                                onValueChange={field.onChange}
                                value={field.value}
                                disabled={disabled}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue
                                        placeholder={t("selectColor")}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(LABEL_COLORS).map(
                                        ([color, value]) => (
                                            <SelectItem
                                                value={value}
                                                key={color}
                                                className="flex items-center gap-2"
                                            >
                                                <div
                                                    className="size-2 rounded-full bg-(--color) flex-none"
                                                    style={{
                                                        // @ts-expect-error css color
                                                        "--color": value
                                                    }}
                                                />
                                                <span data-name>
                                                    {color
                                                        .charAt(0)
                                                        .toUpperCase() +
                                                        color.slice(1)}
                                                </span>
                                            </SelectItem>
                                        )
                                    )}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </form>
        </Form>
    );
}
