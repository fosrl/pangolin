import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { orgQueries } from "@app/lib/queries";
import type { CreateOrEditLabelResponse } from "@server/routers/labels/types";
import { useQuery } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "./ui/command";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "./ui/select";

export type SelectedLabel = {
    name: string;
    color: string;
    labelId: number;
};

export type LabelsSelectorProps = {
    orgId: string;
    selectedLabels: SelectedLabel[];
    toggleLabel: (newlabel: SelectedLabel, action: "detach" | "attach") => void;
};

export function formatLabelsSelectorLabel(
    selectedLabels: SelectedLabel[],
    t: (key: string, values?: { count: number }) => string
): string {
    if (selectedLabels.length === 0) {
        return t("selectLabels");
    }
    if (selectedLabels.length === 1) {
        return selectedLabels[0]!.name;
    }
    return t("labelsSelectorLabelsCount", {
        count: selectedLabels.length
    });
}

export const LABEL_COLORS = {
    red: "#ff6467",
    green: "#05df72",
    blue: "#51a2ff",
    yellow: "#fdc744",
    orange: "#ff8905",
    purple: "#a684ff",
    gray: "#b4b4b4"
};

export function LabelsSelector({
    orgId,
    selectedLabels,
    toggleLabel
}: LabelsSelectorProps) {
    const t = useTranslations();
    const [labelSearchQuery, setlabelsSearchQuery] = useState("");
    const [debouncedQuery] = useDebounce(labelSearchQuery, 150);

    const api = createApiClient(useEnvContext());

    const { data: labels = [] } = useQuery(
        orgQueries.labels({
            orgId,
            query: debouncedQuery,
            perPage: 10
        })
    );

    const labelsShown = useMemo(() => {
        const base = [...labels];
        if (debouncedQuery.trim().length === 0 && selectedLabels.length > 0) {
            const selectedNotInBase = selectedLabels.filter(
                (sel) => !base.some((s) => s.labelId === sel.labelId)
            );
            return [...selectedNotInBase, ...base];
        }
        return base;
    }, [debouncedQuery, labels, selectedLabels]);

    const selectedIds = useMemo(
        () => new Set(selectedLabels.map((s) => s.labelId)),
        [selectedLabels]
    );

    const colorValues = Object.values(LABEL_COLORS);
    const randomColor =
        colorValues[Math.floor(Math.random() * colorValues.length)];

    const [, action, isPending] = useActionState(createLabel, null);
    const createFormRef = useRef<HTMLFormElement>(null);

    const trimmedQuery = labelSearchQuery.trim();
    const canCreateLabel =
        trimmedQuery.length > 0 && labelsShown.length === 0 && !isPending;

    async function createLabel(_: any, formData: FormData) {
        const name = formData.get("name")?.toString();
        const color = formData.get("color")?.toString();
        try {
            const res = await api.post<
                AxiosResponse<CreateOrEditLabelResponse>
            >(`/org/${orgId}/labels`, { name, color });

            const { label } = res.data.data;

            toggleLabel(
                {
                    labelId: label.labelId,
                    name: label.name,
                    color: label.color
                },
                "attach"
            );
        } catch (e: any) {
            if (e.response?.status === 409) {
                toast({
                    title: t("labelDuplicateError"),
                    description: t("labelDuplicateErrorDescription"),
                    variant: "destructive"
                });
            } else {
                toast({
                    title: t("error"),
                    description: formatAxiosError(e, t("errorOccurred")),
                    variant: "destructive"
                });
            }
        }
        setlabelsSearchQuery("");
    }

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("labelSearchOrCreate")}
                value={labelSearchQuery}
                onValueChange={setlabelsSearchQuery}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && canCreateLabel) {
                        e.preventDefault();
                        createFormRef.current?.requestSubmit();
                    }
                }}
            />
            <CommandList>
                <CommandEmpty className="px-3 py-6 text-center text-wrap">
                    {labelSearchQuery.trim().length > 0 ? (
                        <div className="flex flex-col gap-2 items-center">
                            <span className="max-w-34 break-words">
                                {t("createNewLabel", {
                                    label: labelSearchQuery.trim()
                                })}
                            </span>

                            <form
                                ref={createFormRef}
                                action={action}
                                className="flex items-center gap-2"
                            >
                                <input
                                    type="hidden"
                                    name="name"
                                    value={labelSearchQuery.trim()}
                                />

                                <Select defaultValue={randomColor} name="color">
                                    <SelectTrigger className="w-auto min-w-24">
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

                                <Button
                                    variant="outline"
                                    loading={isPending}
                                    type="submit"
                                >
                                    {t("create")}
                                </Button>
                            </form>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1 items-center">
                            <span className="text-muted-foreground">
                                {t("labelsNotFound")}
                            </span>
                            <span className="text-sm">
                                {t("labelsEmptyCreateHint")}
                            </span>
                        </div>
                    )}
                </CommandEmpty>
                <CommandGroup>
                    {labelsShown.map((label) => (
                        <CommandItem
                            key={label.labelId}
                            value={`${label.labelId}`}
                            onSelect={() => {
                                toggleLabel(
                                    label,
                                    selectedIds.has(label.labelId)
                                        ? "detach"
                                        : "attach"
                                );
                            }}
                        >
                            <Checkbox
                                className="shrink-0"
                                checked={selectedIds.has(label.labelId)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                }}
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                }}
                                onCheckedChange={(checked) => {
                                    toggleLabel(
                                        label,
                                        checked ? "attach" : "detach"
                                    );
                                }}
                                aria-hidden
                                tabIndex={-1}
                            />
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <span
                                    className="inline-block size-2 flex-none rounded-full bg-(--label-color)"
                                    style={{
                                        // @ts-expect-error CSS variable
                                        "--label-color": label.color
                                    }}
                                />
                                <span className="min-w-0 flex-1 truncate">
                                    {label.name}
                                </span>
                            </div>
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
