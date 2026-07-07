import { useEffect, useState, FC, useCallback, useMemo } from "react";
import {
    ColumnDef,
    getCoreRowModel,
    useReactTable,
    flexRender,
    getFilteredRowModel,
    VisibilityState
} from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
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
} from "@/components/Credenza";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuCheckboxItem
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, RefreshCw, Filter, Columns } from "lucide-react";
import { Container } from "@server/routers/site";
import { useTranslations } from "next-intl";
import { FaDocker } from "react-icons/fa";

interface ContainerSelectorProps {
    site: { siteId: number; name: string; type: string };
    containers: Container[];
    isAvailable: boolean;
    onContainerSelect?: (hostname: string, port?: number) => void;
    onRefresh?: () => void;
}

export const ContainersSelector: FC<ContainerSelectorProps> = ({
    site,
    containers,
    isAvailable,
    onContainerSelect,
    onRefresh
}) => {
    const [open, setOpen] = useState(false);

    const t = useTranslations();

    if (!site || !isAvailable || site.type !== "newt") {
        return null;
    }

    const handleContainerSelect = (container: Container, port?: number) => {
        // Extract hostname - prefer IP address from networks, fallback to container name
        const hostname = getContainerHostname(container);
        onContainerSelect?.(hostname, port);
        setOpen(false);
    };

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(true)}
                title={t("viewDockerContainers")}
                className="border-r rounded-r-none"
            >
                <FaDocker size={15} />
            </Button>
            <Credenza open={open} onOpenChange={setOpen}>
                <CredenzaContent className="max-w-[75vw] max-h-[75vh] flex flex-col">
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("containersIn", { siteName: site.name })}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("selectContainerDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <div className="flex-1 overflow-hidden min-h-0">
                            <DockerContainersTable
                                containers={containers}
                                onContainerSelect={handleContainerSelect}
                                onRefresh={onRefresh || (() => {})}
                            />
                        </div>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button variant="outline">{t("close")}</Button>
                        </CredenzaClose>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
};

const DockerContainersTable: FC<{
    containers: Container[];
    onContainerSelect: (container: Container, port?: number) => void;
    onRefresh: () => void;
}> = ({ containers, onContainerSelect, onRefresh }) => {
    const [searchInput, setSearchInput] = useState("");
    const [globalFilter, setGlobalFilter] = useState("");
    const [hideContainersWithoutPorts, setHideContainersWithoutPorts] =
        useState(true);
    const [hideStoppedContainers, setHideStoppedContainers] = useState(false);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
        labels: true
    });

    const t = useTranslations();

    useEffect(() => {
        const timer = setTimeout(() => {
            setGlobalFilter(searchInput);
        }, 100);

        return () => clearTimeout(timer);
    }, [searchInput]);

    const getExposedPorts = useCallback((container: Container): number[] => {
        const ports: number[] = [];

        container.ports?.forEach((port) => {
            if (port.privatePort) {
                ports.push(port.privatePort);
            }
        });

        return [...new Set(ports)]; // Remove duplicates
    }, []);

    const globalFilterFunction = useCallback(
        (row: any, columnId: string, value: string) => {
            const container = row.original as Container;
            const searchValue = value.toLowerCase();

            // Search across all relevant fields
            const searchableFields = [
                container.name,
                container.image,
                container.state,
                container.status,
                getContainerHostname(container),
                ...Object.keys(container.networks),
                ...Object.values(container.networks)
                    .map((n) => n.ipAddress)
                    .filter(Boolean),
                ...getExposedPorts(container).map((p) => p.toString())
            ];

            return searchableFields.some((field) =>
                field?.toString().toLowerCase().includes(searchValue)
            );
        },
        [getExposedPorts]
    );

    const columns: ExtendedColumnDef<Container>[] = [
        {
            accessorKey: "name",
            friendlyName: t("containerName"),
            header: () => <span className="p-3">{t("containerName")}</span>,
            cell: ({ row }) => (
                <div className="font-medium">{row.original.name}</div>
            )
        },
        {
            accessorKey: "image",
            friendlyName: t("containerImage"),
            header: () => <span className="p-3">{t("containerImage")}</span>,
            cell: ({ row }) => (
                <div className="text-sm text-muted-foreground">
                    {row.original.image}
                </div>
            )
        },
        {
            accessorKey: "state",
            friendlyName: t("containerState"),
            header: () => <span className="p-3">{t("containerState")}</span>,
            cell: ({ row }) => (
                <Badge
                    variant={
                        row.original.state === "running"
                            ? "default"
                            : "secondary"
                    }
                >
                    {row.original.state}
                </Badge>
            )
        },
        {
            accessorKey: "networks",
            friendlyName: t("containerNetworks"),
            header: () => <span className="p-3">{t("containerNetworks")}</span>,
            cell: ({ row }) => {
                const networks = Object.keys(row.original.networks);
                return (
                    <div className="text-sm text-muted-foreground">
                        {networks.length > 0
                            ? networks.map((n) => (
                                  <Badge key={n} variant="outlinePrimary">
                                      {n}
                                  </Badge>
                              ))
                            : "-"}
                    </div>
                );
            }
        },
        {
            accessorKey: "hostname",
            friendlyName: t("containerHostnameIp"),
            header: () => (
                <span className="p-3">{t("containerHostnameIp")}</span>
            ),
            enableHiding: false,
            cell: ({ row }) => (
                <div className="text-sm font-mono">
                    {getContainerHostname(row.original)}
                </div>
            )
        },
        {
            accessorKey: "labels",
            friendlyName: t("containerLabels"),
            header: () => <span className="p-3">{t("containerLabels")}</span>,
            cell: ({ row }) => {
                const labels = row.original.labels || {};
                const labelEntries = Object.entries(labels);

                if (labelEntries.length === 0) {
                    return <span className="text-muted-foreground">-</span>;
                }

                return (
                    <Popover modal>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs hover:bg-muted"
                            >
                                {t("containerLabelsCount", {
                                    count: labelEntries.length
                                })}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="start">
                            <ScrollArea className="w-64 h-64">
                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm">
                                        {t("containerLabelsTitle")}
                                    </h4>
                                    <div className="space-y-1">
                                        {labelEntries.map(([key, value]) => (
                                            <div key={key} className="text-xs">
                                                <div className="font-mono font-medium text-foreground">
                                                    {key}
                                                </div>
                                                <div className="font-mono text-muted-foreground pl-2 break-all">
                                                    {value ||
                                                        t(
                                                            "containerLabelEmpty"
                                                        )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </ScrollArea>
                        </PopoverContent>
                    </Popover>
                );
            }
        },
        {
            accessorKey: "ports",
            header: () => <span className="p-3">{t("containerPorts")}</span>,
            enableHiding: false,
            cell: ({ row }) => {
                const ports = getExposedPorts(row.original);
                return (
                    <div className="flex flex-wrap items-center gap-1">
                        {ports.slice(0, 2).map((port) => (
                            <Button
                                key={port}
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() =>
                                    onContainerSelect(row.original, port)
                                }
                            >
                                {port}
                            </Button>
                        ))}
                        {ports.length > 2 && (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="link" size="sm">
                                        {t("containerPortsMore", {
                                            count: ports.length - 2
                                        })}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    side="top"
                                    className="w-auto"
                                    align="end"
                                >
                                    {ports.slice(2).map((port) => (
                                        <Button
                                            key={port}
                                            variant="outline"
                                            size="sm"
                                            className="h-6 px-2 text-xs"
                                            onClick={() =>
                                                onContainerSelect(
                                                    row.original,
                                                    port
                                                )
                                            }
                                        >
                                            {port}
                                        </Button>
                                    ))}
                                </PopoverContent>
                            </Popover>
                        )}
                    </div>
                );
            }
        },
        {
            id: "actions",
            header: () => <span className="p-3">{t("containerActions")}</span>,
            cell: ({ row }) => {
                const ports = getExposedPorts(row.original);
                return (
                    <Button
                        variant="default"
                        size="sm"
                        onClick={() =>
                            onContainerSelect(row.original, ports[0])
                        }
                        disabled={row.original.state !== "running"}
                    >
                        {t("select")}
                    </Button>
                );
            }
        }
    ];

    const initialFilters = useMemo(() => {
        let filtered = containers;

        // Filter by port visibility
        if (hideContainersWithoutPorts) {
            filtered = filtered.filter((container) => {
                const ports = getExposedPorts(container);
                return ports.length > 0; // Show only containers WITH ports
            });
        }

        // Filter by container state
        if (hideStoppedContainers) {
            filtered = filtered.filter((container) => {
                return container.state === "running";
            });
        }

        return filtered;
    }, [
        containers,
        hideContainersWithoutPorts,
        hideStoppedContainers,
        getExposedPorts
    ]);

    const table = useReactTable({
        data: initialFilters,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        globalFilterFn: globalFilterFunction,
        state: {
            globalFilter,
            columnVisibility
        },
        onGlobalFilterChange: setGlobalFilter,
        onColumnVisibilityChange: setColumnVisibility
    });

    if (initialFilters.length === 0) {
        return (
            <div className="rounded-md max-h-[500px] overflow-hidden flex flex-col">
                <div className="flex-1 flex items-center justify-center py-8">
                    <div className="text-center text-muted-foreground space-y-3">
                        {(hideContainersWithoutPorts ||
                            hideStoppedContainers) &&
                        containers.length > 0 ? (
                            <>
                                <p>{t("noContainersMatchingFilters")}</p>
                                <div className="space-x-2">
                                    {hideContainersWithoutPorts && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setHideContainersWithoutPorts(
                                                    false
                                                )
                                            }
                                        >
                                            {t("showContainersWithoutPorts")}
                                        </Button>
                                    )}
                                    {hideStoppedContainers && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                setHideStoppedContainers(false)
                                            }
                                        >
                                            {t("showStoppedContainers")}
                                        </Button>
                                    )}
                                </div>
                            </>
                        ) : (
                            <p>{t("noContainersFound")}</p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-md max-h-[500px] overflow-hidden flex flex-col">
            <div className="p-1 space-y-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder={t("searchContainersPlaceholder", {
                                count: initialFilters.length
                            })}
                            value={searchInput}
                            onChange={(event) =>
                                setSearchInput(event.target.value)
                            }
                            className="pl-8"
                        />
                        {searchInput &&
                            table.getFilteredRowModel().rows.length > 0 && (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                    {t("searchResultsCount", {
                                        count: table.getFilteredRowModel().rows
                                            .length
                                    })}
                                </div>
                            )}
                    </div>
                    <div className="flex items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                >
                                    <Filter className="h-4 w-4" />
                                    {t("filters")}
                                    {(hideContainersWithoutPorts ||
                                        hideStoppedContainers) && (
                                        <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 text-xs flex items-center justify-center">
                                            {Number(
                                                hideContainersWithoutPorts
                                            ) + Number(hideStoppedContainers)}
                                        </span>
                                    )}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-64">
                                <DropdownMenuLabel>
                                    {t("filterOptions")}
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuCheckboxItem
                                    checked={hideContainersWithoutPorts}
                                    onCheckedChange={
                                        setHideContainersWithoutPorts
                                    }
                                >
                                    {t("filterPorts")}
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuCheckboxItem
                                    checked={hideStoppedContainers}
                                    onCheckedChange={setHideStoppedContainers}
                                >
                                    {t("filterStopped")}
                                </DropdownMenuCheckboxItem>
                                {(hideContainersWithoutPorts ||
                                    hideStoppedContainers) && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <div className="p-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setHideContainersWithoutPorts(
                                                        false
                                                    );
                                                    setHideStoppedContainers(
                                                        false
                                                    );
                                                }}
                                                className="w-full text-xs"
                                            >
                                                {t("clearAllFilters")}
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                >
                                    <Columns className="h-4 w-4" />
                                    {t("columns")}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-48">
                                <DropdownMenuLabel>
                                    {t("toggleColumns")}
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {table
                                    .getAllColumns()
                                    .filter((column) => column.getCanHide())
                                    .map((column) => {
                                        return (
                                            <DropdownMenuCheckboxItem
                                                key={column.id}
                                                className="capitalize"
                                                checked={column.getIsVisible()}
                                                onCheckedChange={(value) =>
                                                    column.toggleVisibility(
                                                        !!value
                                                    )
                                                }
                                            >
                                                {column.id === "hostname"
                                                    ? t("containerHostnameIp")
                                                    : column.id}
                                            </DropdownMenuCheckboxItem>
                                        );
                                    })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={onRefresh}
                        title={t("refreshContainersList")}
                    >
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <div className="overflow-auto relative flex-1">
                <Table sticky>
                    <TableHeader sticky className="border-b">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id}>
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef
                                                      .header,
                                                  header.getContext()
                                              )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    className={
                                        row.original.state !== "running"
                                            ? "opacity-50"
                                            : ""
                                    }
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center"
                                >
                                    {searchInput && !globalFilter ? (
                                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                            {t("searching")}
                                        </div>
                                    ) : (
                                        t("noContainersFoundMatching", {
                                            filter: globalFilter
                                        })
                                    )}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};

function getContainerHostname(container: Container): string {
    // First, try to get IP from networks
    const networks = Object.values(container.networks);
    for (const network of networks) {
        if (network.ipAddress) {
            return network.ipAddress;
        }
    }

    // Fallback to container name (works in Docker networks)
    return container.name;
}
