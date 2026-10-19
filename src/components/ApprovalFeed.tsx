"use client";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { formatFingerprintInfo } from "@app/lib/formatDeviceFingerprint";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import {
    approvalFiltersSchema,
    approvalQueries,
    type ApprovalItem
} from "@app/lib/queries";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Ban, Check, Loader, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useActionState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import { Label } from "./ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "./ui/select";
import { Separator } from "./ui/separator";
import { InfoPopup } from "./ui/info-popup";
import { ApprovalsEmptyState } from "./ApprovalsEmptyState";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";

export type ApprovalFeedProps = {
    orgId: string;
    hasApprovalsEnabled: boolean;
};

export function ApprovalFeed({
    orgId,
    hasApprovalsEnabled
}: ApprovalFeedProps) {
    const searchParams = useSearchParams();
    const path = usePathname();
    const t = useTranslations();

    const router = useRouter();

    const filters = approvalFiltersSchema.parse(
        Object.fromEntries(searchParams.entries())
    );

    const { isPaidUser } = usePaidStatus();

    const {
        data,
        isFetching,
        isLoading,
        refetch,
        hasNextPage,
        fetchNextPage,
        isFetchingNextPage
    } = useInfiniteQuery({
        ...approvalQueries.listApprovals(orgId, filters),
        enabled: isPaidUser(tierMatrix.deviceApprovals)
    });

    const approvals = data?.pages.flatMap((data) => data.approvals) ?? [];

    // Show empty state if no approvals are enabled for any role
    if (!hasApprovalsEnabled) {
        return <ApprovalsEmptyState orgId={orgId} />;
    }

    return (
        <div className="flex flex-col gap-5">
            <Card className="">
                <CardHeader className="flex flex-col sm:flex-row sm:items-end lg:items-end gap-2 ">
                    <div className="flex flex-col items-start gap-2 w-48 mb-0">
                        <Label htmlFor="approvalState">
                            {t("filterByApprovalState")}
                        </Label>
                        <Select
                            onValueChange={(newValue) => {
                                const newSearch = new URLSearchParams(
                                    searchParams
                                );
                                newSearch.set("approvalState", newValue);

                                router.replace(
                                    `${path}?${newSearch.toString()}`
                                );
                            }}
                            value={filters.approvalState ?? "pending"}
                        >
                            <SelectTrigger
                                id="approvalState"
                                className="w-full"
                            >
                                <SelectValue
                                    placeholder={t("selectApprovalState")}
                                />
                            </SelectTrigger>
                            <SelectContent className="w-full">
                                <SelectItem value="pending">
                                    {t("pending")}
                                </SelectItem>
                                <SelectItem value="approved">
                                    {t("approved")}
                                </SelectItem>
                                <SelectItem value="denied">
                                    {t("denied")}
                                </SelectItem>
                                <SelectItem value="all">{t("all")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        variant="outline"
                        onClick={() => {
                            refetch();
                        }}
                        disabled={isFetching || isLoading}
                        className="lg:static gap-2"
                    >
                        <RefreshCw
                            className={cn(
                                "size-4",
                                (isFetching || isLoading) && "animate-spin"
                            )}
                        />
                        {t("refresh")}
                    </Button>
                </CardHeader>
            </Card>
            <Card>
                <CardHeader>
                    <ul className="flex flex-col gap-4">
                        {approvals.map((approval, index) => (
                            <Fragment key={approval.approvalId}>
                                <li>
                                    <ApprovalRequest
                                        approval={approval}
                                        orgId={orgId}
                                        onSuccess={() => refetch()}
                                    />
                                </li>
                                {index < approvals.length - 1 && <Separator />}
                            </Fragment>
                        ))}

                        {approvals.length === 0 && (
                            <li className="flex justify-center items-center p-4 text-muted-foreground gap-2">
                                {isLoading
                                    ? t("loadingApprovals")
                                    : t("approvalListEmpty")}

                                {isLoading && (
                                    <Loader className="size-4 flex-none animate-spin" />
                                )}
                            </li>
                        )}
                    </ul>
                </CardHeader>
            </Card>
            {hasNextPage && (
                <Button
                    variant="secondary"
                    className="self-center"
                    size="lg"
                    loading={isFetchingNextPage}
                    onClick={() => fetchNextPage()}
                >
                    {t("approvalLoadMore")}
                </Button>
            )}
        </div>
    );
}

type ApprovalRequestProps = {
    approval: ApprovalItem;
    orgId: string;
    onSuccess?: () => void;
};

function ApprovalRequest({ approval, orgId, onSuccess }: ApprovalRequestProps) {
    const t = useTranslations();

    const [_, formAction, isSubmitting] = useActionState(onSubmit, null);
    const api = createApiClient(useEnvContext());

    async function onSubmit(_previousState: any, formData: FormData) {
        const decision = formData.get("decision");
        const res = await api
            .put(`/org/${orgId}/approvals/${approval.approvalId}`, { decision })
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("accessApprovalErrorUpdate"),
                    description: formatAxiosError(
                        e,
                        t("accessApprovalErrorUpdateDescription")
                    )
                });
            });
        if (res && res.status === 200) {
            const result = res.data.data;
            toast({
                variant: "default",
                title: t("accessApprovalUpdated"),
                description:
                    result.decision === "approved"
                        ? t("accessApprovalApprovedDescription")
                        : t("accessApprovalDeniedDescription")
            });

            onSuccess?.();
        }
    }

    return (
        <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="inline-flex items-start md:items-center gap-2">
                <span>
                    <Link
                        href={`/${orgId}/settings/access/users/${approval.user.userId}/general`}
                        className="text-primary hover:underline cursor-pointer"
                    >
                        {getUserDisplayName({
                            email: approval.user.email,
                            name: approval.user.name,
                            username: approval.user.username
                        })}
                    </Link>
                    &nbsp;
                    {approval.type === "user_device" && (
                        <span className="inline-flex items-center gap-1">
                            {approval.deviceName ? (
                                <>
                                    {t("requestingNewDeviceApproval")}:{" "}
                                    {approval.niceId ? (
                                        <Link
                                            href={`/${orgId}/settings/clients/user/${approval.niceId}/general`}
                                            className="text-primary hover:underline cursor-pointer"
                                        >
                                            {approval.deviceName}
                                        </Link>
                                    ) : (
                                        <span>{approval.deviceName}</span>
                                    )}
                                    {approval.fingerprint && (
                                        <InfoPopup>
                                            <div className="space-y-1 text-sm">
                                                <div className="font-semibold mb-2">
                                                    {t("deviceInformation")}
                                                </div>
                                                <div className="text-muted-foreground whitespace-pre-line">
                                                    {formatFingerprintInfo(
                                                        approval.fingerprint,
                                                        t
                                                    )}
                                                </div>
                                            </div>
                                        </InfoPopup>
                                    )}
                                </>
                            ) : (
                                <span>{t("requestingNewDeviceApproval")}</span>
                            )}
                        </span>
                    )}
                </span>
            </div>
            <div className="inline-flex gap-2">
                {approval.decision === "pending" && (
                    <form action={formAction} className="inline-flex gap-2">
                        <Button
                            value="approved"
                            name="decision"
                            className="gap-2"
                            type="submit"
                            loading={isSubmitting}
                        >
                            <Check className="size-4 flex-none" />
                            {t("approve")}
                        </Button>
                        <Button
                            value="denied"
                            name="decision"
                            variant="destructive"
                            className="gap-2"
                            type="submit"
                            loading={isSubmitting}
                        >
                            <Ban className="size-4 flex-none" />
                            {t("deny")}
                        </Button>
                    </form>
                )}
                {approval.decision === "approved" && (
                    <Badge variant="green">{t("approved")}</Badge>
                )}
                {approval.decision === "denied" && (
                    <Badge variant="red">{t("denied")}</Badge>
                )}
            </div>
        </div>
    );
}
