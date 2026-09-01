import type { SelectedLabel } from "@app/components/labels-selector";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useState, useMemo } from "react";
import { toast } from "./useToast";
import { useEnvContext } from "./useEnvContext";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export type LabelToggleAction = {
    label: SelectedLabel;
    action: "attach" | "detach";
};

function computeLabelToggleActions(
    values: SelectedLabel[],
    actions: LabelToggleAction[]
) {
    let newValues = [...values];
    for (const { action, label } of actions) {
        if (action === "attach") {
            newValues = [...newValues, label];
        } else {
            newValues = newValues.filter((lb) => lb.labelId !== label.labelId);
        }
    }

    return newValues;
}

type UseOptimisticLabelsArgs = {
    serverLabels: SelectedLabel[] | undefined;
    orgId: string;
    entityId: number;
    entityIdField: string;
};

export function useOptimisticLabels({
    serverLabels,
    orgId,
    entityId,
    entityIdField
}: UseOptimisticLabelsArgs) {
    const router = useRouter();
    const labels = serverLabels ?? [];
    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    const [pendingActions, setPendingActions] = useState<LabelToggleAction[]>(
        []
    );

    const localLabels = useMemo(
        () => computeLabelToggleActions(labels ?? [], pendingActions),
        [labels, pendingActions]
    );

    async function toggleLabel(
        label: SelectedLabel,
        action: "attach" | "detach"
    ) {
        const oppositeAction = action === "attach" ? "detach" : "attach";
        const existingActionIndex = pendingActions.findIndex(
            (pending) =>
                pending.action === oppositeAction &&
                pending.label.labelId === label.labelId
        );

        // if there are two actions that cancel each-other
        // they should just be removed
        if (existingActionIndex !== -1) {
            setPendingActions((prevActions) =>
                prevActions.toSpliced(existingActionIndex, 1)
            );
        } else {
            setPendingActions((actions) => [...actions, { label, action }]);
        }

        try {
            if (action === "attach") {
                await api.put(`/org/${orgId}/label/${label.labelId}/attach`, {
                    [entityIdField]: entityId
                });
            } else {
                await api.put(`/org/${orgId}/label/${label.labelId}/detach`, {
                    [entityIdField]: entityId
                });
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e, t("errorOccurred")),
                variant: "destructive"
            });
        }
    }

    async function refresh() {
        // Only refresh if the labels have been modified
        if (pendingActions.length > 0) {
            router.refresh();
        }
        setPendingActions([]);
    }

    return { localLabels, toggleLabel, refresh };
}
