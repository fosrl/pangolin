"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { useTranslations } from "next-intl";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { ListUserOlmsResponse } from "@server/routers/olm";
import { ResponseT } from "@server/types/Response";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import { Loader2, RefreshCw } from "lucide-react";
import moment from "moment";
import { useUserContext } from "@app/hooks/useUserContext";

type ViewDevicesDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
};

type Device = {
    olmId: string;
    dateCreated: string;
    version: string | null;
    name: string | null;
    clientId: number | null;
    userId: string | null;
    archived: boolean;
};

export default function ViewDevicesDialog({
    open,
    setOpen
}: ViewDevicesDialogProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { user } = useUserContext();

    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchDevices = async () => {
        setLoading(true);
        try {
            const res = await api.get<ResponseT<ListUserOlmsResponse>>(
                `/user/${user?.userId}/olms`
            );
            if (res.data.success && res.data.data) {
                setDevices(res.data.data.olms);
            }
        } catch (error: any) {
            console.error("Error fetching devices:", error);
            toast({
                variant: "destructive",
                title: t("errorLoadingDevices") || "Error loading devices",
                description: formatAxiosError(
                    error,
                    t("failedToLoadDevices") || "Failed to load devices"
                )
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            fetchDevices();
        }
    }, [open]);

    const archiveDevice = async (olmId: string) => {
        try {
            await api.post(`/user/${user?.userId}/olm/${olmId}/archive`);
            toast({
                title: t("deviceArchived") || "Device archived",
                description:
                    t("deviceArchivedDescription") ||
                    "The device has been successfully archived."
            });
            // Update the device's archived status in the local state
            setDevices(
                devices.map((d) =>
                    d.olmId === olmId ? { ...d, archived: true } : d
                )
            );
        } catch (error: any) {
            console.error("Error archiving device:", error);
            toast({
                variant: "destructive",
                title: t("errorArchivingDevice"),
                description: formatAxiosError(error, t("failedToArchiveDevice"))
            });
        }
    };

    const unarchiveDevice = async (olmId: string) => {
        try {
            await api.post(`/user/${user?.userId}/olm/${olmId}/unarchive`);
            toast({
                title: t("deviceUnarchived") || "Device unarchived",
                description:
                    t("deviceUnarchivedDescription") ||
                    "The device has been successfully unarchived."
            });
            // Update the device's archived status in the local state
            setDevices(
                devices.map((d) =>
                    d.olmId === olmId ? { ...d, archived: false } : d
                )
            );
        } catch (error: any) {
            console.error("Error unarchiving device:", error);
            toast({
                variant: "destructive",
                title:
                    t("errorUnarchivingDevice") || "Error unarchiving device",
                description: formatAxiosError(
                    error,
                    t("failedToUnarchiveDevice") || "Failed to unarchive device"
                )
            });
        }
    };

    function reset() {
        setDevices([]);
    }

    return (
        <>
            <Credenza
                open={open}
                onOpenChange={(val) => {
                    setOpen(val);
                    if (!val) {
                        reset();
                    }
                }}
            >
                <CredenzaContent className="max-w-4xl">
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("viewDevices") || "View Devices"}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("viewDevicesDescription") ||
                                "Manage your connected devices"}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                        ) : (
                            <HorizontalTabs
                                clientSide
                                defaultTab={0}
                                items={[
                                    {
                                        title: `${t("available") || "Available"} (${devices.filter((d) => !d.archived).length})`,
                                        href: "#available"
                                    },
                                    {
                                        title: `${t("archived") || "Archived"} (${devices.filter((d) => d.archived).length})`,
                                        href: "#archived"
                                    }
                                ]}
                            >
                                <div>
                                    {devices.filter((d) => !d.archived)
                                        .length === 0 ? (
                                        <div className="text-center py-8 text-muted-foreground">
                                            {t("noDevices") ||
                                                "No devices found"}
                                        </div>
                                    ) : (
                                        <div className="w-full min-w-0 overflow-hidden rounded-lg border bg-card">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="pl-3">
                                                            {t("name") ||
                                                                "Name"}
                                                        </TableHead>
                                                        <TableHead>
                                                            {t("dateCreated") ||
                                                                "Date Created"}
                                                        </TableHead>
                                                        <TableHead>
                                                            {t("actions") ||
                                                                "Actions"}
                                                        </TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {devices
                                                        .filter(
                                                            (d) => !d.archived
                                                        )
                                                        .map((device) => (
                                                            <TableRow
                                                                key={
                                                                    device.olmId
                                                                }
                                                            >
                                                                <TableCell className="font-medium">
                                                                    {device.name ||
                                                                        t(
                                                                            "unnamedDevice"
                                                                        ) ||
                                                                        "Unnamed Device"}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {moment(
                                                                        device.dateCreated
                                                                    ).format(
                                                                        "lll"
                                                                    )}
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Button
                                                                        variant="outline"
                                                                        onClick={() => {
                                                                            archiveDevice(
                                                                                device.olmId
                                                                            );
                                                                        }}
                                                                    >
                                                                        {t(
                                                                            "archive"
                                                                        ) ||
                                                                            "Archive"}
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    {devices.filter((d) => d.archived)
                                        .length === 0 ? (
                                        <div className="text-center py-8 text-muted-foreground">
                                            {t("noArchivedDevices") ||
                                                "No archived devices found"}
                                        </div>
                                    ) : (
                                        <div className="w-full min-w-0 overflow-hidden rounded-lg border bg-card">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="pl-3">
                                                            {t("name") ||
                                                                "Name"}
                                                        </TableHead>
                                                        <TableHead>
                                                            {t("dateCreated") ||
                                                                "Date Created"}
                                                        </TableHead>
                                                        <TableHead>
                                                            {t("actions") ||
                                                                "Actions"}
                                                        </TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {devices
                                                        .filter(
                                                            (d) => d.archived
                                                        )
                                                        .map((device) => (
                                                            <TableRow
                                                                key={
                                                                    device.olmId
                                                                }
                                                            >
                                                                <TableCell className="font-medium">
                                                                    {device.name ||
                                                                        t(
                                                                            "unnamedDevice"
                                                                        ) ||
                                                                        "Unnamed Device"}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {moment(
                                                                        device.dateCreated
                                                                    ).format(
                                                                        "lll"
                                                                    )}
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Button
                                                                        variant="outline"
                                                                        onClick={() => {
                                                                            unarchiveDevice(
                                                                                device.olmId
                                                                            );
                                                                        }}
                                                                    >
                                                                        {t(
                                                                            "unarchive"
                                                                        ) ||
                                                                            "Unarchive"}
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </div>
                            </HorizontalTabs>
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">
                                {t("close") || "Close"}
                            </Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
