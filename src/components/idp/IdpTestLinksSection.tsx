"use client";

import CopyTextBox from "@app/components/CopyTextBox";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import Timestamp from "@app/components/Timestamp";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import type { OidcTestResult } from "@server/lib/idp/previewIdpLogin";
import type {
    CreateIdpTestLinkResponse,
    GetIdpTestLinkResponse,
    IdpTestLinkListItem,
    ListIdpTestLinksResponse
} from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

type IdpTestLinksSectionProps = {
    /** `/idp/:idpId` or `/org/:orgId/idp/:idpId`. */
    apiBase: string;
    onViewResult: (view: {
        label: string | null;
        result: OidcTestResult;
    }) => void;
};

const STATUS_VARIANT = {
    pending: "yellow",
    completed: "green",
    expired: "secondary"
} as const;

const STATUS_LABEL = {
    pending: "idpTestLinkStatusPending",
    completed: "idpTestLinkStatusCompleted",
    expired: "idpTestLinkStatusExpired"
} as const;

const WHEN_LABEL = {
    pending: "idpTestLinkExpiresIn",
    completed: "idpTestLinkCompletedAt",
    expired: "idpTestLinkExpiredAt"
} as const;

/** Create single-use test links for other people, and open their results. */
export default function IdpTestLinksSection({
    apiBase,
    onViewResult
}: IdpTestLinksSectionProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [links, setLinks] = useState<IdpTestLinkListItem[]>([]);
    const [creating, setCreating] = useState(false);
    const [createdUrl, setCreatedUrl] = useState<string | null>(null);
    const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

    const formSchema = z.object({
        label: z
            .string()
            .trim()
            .max(100, { message: t("idpTestLinkLabelTooLong") })
    });
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: { label: "" }
    });

    // opens results as links complete, without the parent re-creating loadLinks
    const onViewResultRef = useRef(onViewResult);
    onViewResultRef.current = onViewResult;
    // completed links already seen; null until the first load
    const seenCompletedRef = useRef<Set<string> | null>(null);

    const openResult = useCallback(
        async (linkId: string) => {
            const res = await api.get<AxiosResponse<GetIdpTestLinkResponse>>(
                `${apiBase}/oidc/test-links/${linkId}`
            );
            const { result, label } = res.data.data;
            if (result) {
                onViewResultRef.current({ label, result });
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [apiBase]
    );

    const loadLinks = useCallback(
        async ({ silent = false }: { silent?: boolean } = {}) => {
            try {
                const res = await api.get<
                    AxiosResponse<ListIdpTestLinksResponse>
                >(`${apiBase}/oidc/test-links`);
                const loaded = res.data.data.links;
                setLinks(loaded);

                // open the newest result: on the first load, or when a link just completed
                const completed = loaded
                    .filter((l) => l.status === "completed")
                    .sort(
                        (x, y) => (y.completedAt ?? 0) - (x.completedAt ?? 0)
                    );
                const seen = seenCompletedRef.current;
                const toOpen = seen
                    ? completed.find((l) => !seen.has(l.linkId))
                    : completed[0];
                seenCompletedRef.current = new Set(
                    completed.map((l) => l.linkId)
                );
                if (toOpen) {
                    await openResult(toOpen.linkId);
                }
            } catch (e) {
                if (!silent) {
                    toast({
                        title: t("error"),
                        description: formatAxiosError(e),
                        variant: "destructive"
                    });
                }
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [apiBase, openResult]
    );

    useEffect(() => {
        loadLinks();
    }, [loadLinks]);

    // pick up results when coming back from the tab where the link was opened
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                loadLinks({ silent: true });
            }
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        return () => {
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [loadLinks]);

    // and while someone else signs in somewhere else
    const hasPending = links.some((l) => l.status === "pending");
    useEffect(() => {
        if (!hasPending) {
            return;
        }
        const interval = setInterval(() => loadLinks({ silent: true }), 5000);
        return () => clearInterval(interval);
    }, [hasPending, loadLinks]);

    async function onSubmit(data: z.infer<typeof formSchema>) {
        setCreating(true);
        try {
            const res = await api.put<AxiosResponse<CreateIdpTestLinkResponse>>(
                `${apiBase}/oidc/test-links`,
                {
                    label: data.label || undefined
                }
            );
            setCreatedUrl(res.data.data.url);
            form.reset({ label: "" });
            await loadLinks();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setCreating(false);
        }
    }

    async function viewResult(link: IdpTestLinkListItem) {
        setBusyLinkId(link.linkId);
        try {
            await openResult(link.linkId);
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setBusyLinkId(null);
        }
    }

    async function deleteLink(link: IdpTestLinkListItem) {
        setBusyLinkId(link.linkId);
        try {
            await api.delete(`${apiBase}/oidc/test-links/${link.linkId}`);
            await loadLinks();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setBusyLinkId(null);
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("idpTestLinksTitle")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("idpTestLinksDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <Form {...form}>
                    <form
                        id="idp-test-link-form"
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-col gap-2 sm:flex-row sm:items-end"
                    >
                        <FormField
                            control={form.control}
                            name="label"
                            render={({ field }) => (
                                <FormItem className="flex-1">
                                    <FormLabel>
                                        {t("idpTestLinkLabel")}
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            placeholder={t(
                                                "idpTestLinkLabelPlaceholder"
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button
                            type="submit"
                            loading={creating}
                            disabled={creating}
                        >
                            {t("idpTestLinkCreate")}
                        </Button>
                    </form>
                </Form>

                {createdUrl && (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                            {t("idpTestLinkCreated")}
                        </p>
                        <CopyTextBox text={createdUrl} wrapText />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" size="sm" asChild>
                                <a
                                    href={createdUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    {t("idpTestLinkOpen")}
                                </a>
                            </Button>
                            <span className="text-xs text-muted-foreground">
                                {t("idpTestLinkOpenHint")}
                            </span>
                        </div>
                    </div>
                )}

                {links.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {t("idpTestLinksEmpty")}
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="px-3">
                                        {t("idpTestLinkLabel")}
                                    </TableHead>
                                    <TableHead className="px-3">
                                        {t("idpTestLinkCreatedBy")}
                                    </TableHead>
                                    <TableHead className="px-3">
                                        {t("status")}
                                    </TableHead>
                                    <TableHead className="px-3">
                                        {t("idpTestLinkUpdated")}
                                    </TableHead>
                                    <TableHead className="px-3" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {links.map((link) => (
                                    <TableRow key={link.linkId}>
                                        <TableCell className="px-3 font-medium">
                                            {link.label ?? (
                                                <span className="text-muted-foreground">
                                                    -
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="px-3 text-sm">
                                            {link.createdByName ?? "-"}
                                        </TableCell>
                                        <TableCell className="px-3">
                                            <Badge
                                                variant={
                                                    STATUS_VARIANT[link.status]
                                                }
                                            >
                                                {t(STATUS_LABEL[link.status])}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="px-3 text-sm">
                                            <span className="text-muted-foreground">
                                                {t(
                                                    WHEN_LABEL[link.status]
                                                )}{" "}
                                            </span>
                                            <Timestamp
                                                value={
                                                    link.status === "completed"
                                                        ? link.completedAt
                                                        : link.expiresAt
                                                }
                                                display={
                                                    link.status === "pending"
                                                        ? "duration"
                                                        : "relative"
                                                }
                                            />
                                        </TableCell>
                                        <TableCell className="px-3">
                                            <div className="flex justify-end gap-2">
                                                {link.status ===
                                                    "completed" && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() =>
                                                            viewResult(link)
                                                        }
                                                        disabled={
                                                            busyLinkId ===
                                                            link.linkId
                                                        }
                                                    >
                                                        {t(
                                                            "idpTestLinkViewResult"
                                                        )}
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        deleteLink(link)
                                                    }
                                                    disabled={
                                                        busyLinkId ===
                                                        link.linkId
                                                    }
                                                >
                                                    {t("delete")}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </SettingsSectionBody>
        </SettingsSection>
    );
}
