"use client";

import {
    Credenza,
    CredenzaBody,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { Button } from "@app/components/ui/button";
import { CheckboxWithLabel } from "@app/components/ui/checkbox";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import {
    readLauncherLastView,
    writeLauncherLastView,
    type LauncherActiveViewId
} from "@app/lib/launcherLocalStorage";
import {
    buildLauncherPath,
    getLauncherUrlBaseConfig,
    isLauncherConfigEqual,
    parseLauncherUrlState,
    serializeLauncherUrlState
} from "@app/lib/launcherUrlState";
import { useToast } from "@app/hooks/useToast";
import { useEnvContext } from "@app/hooks/useEnvContext";
import {
    getEffectiveLauncherConfig,
    shouldShowFlatResourceList,
    shouldShowLauncherGroupList,
    shouldShowSearchFirstGate
} from "@app/lib/launcherScale";
import { launcherQueries } from "@app/lib/queries";
import {
    getEffectiveDefaultLauncherConfig,
    type LauncherDefaultViewOverrides,
    type LauncherGroup,
    type LauncherResource,
    type LauncherScaleInfo,
    type LauncherViewConfig,
    type LauncherViewRecord
} from "@server/routers/launcher/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useTransition
} from "react";
import { useDebouncedCallback } from "use-debounce";
import type { Selectedsite } from "@app/components/site-selector";
import type { SelectedLabel } from "@app/components/labels-selector";
import { useMediaQuery } from "@app/hooks/useMediaQuery";
import { cn } from "@app/lib/cn";
import { LauncherFilterPopover } from "./LauncherFilterPopover";
import { LauncherFlatResourceList } from "./LauncherFlatResourceList";
import { LauncherGroupList } from "./LauncherGroupList";
import { LauncherSearchFirstGate } from "./LauncherSearchFirstGate";
import { LauncherRefreshButton } from "./LauncherRefreshButton";
import { LauncherResourcePanel } from "./LauncherResourcePanel";
import { LauncherSettingsMenu } from "./LauncherSettingsMenu";
import { LauncherSortButton } from "./LauncherSortButton";
import { LauncherSaveViewMenu, LauncherViewTabs } from "./LauncherViewTabs";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";

type ResourceLauncherProps = {
    orgId: string;
    isAdmin: boolean;
    views: LauncherViewRecord[];
    defaultViewOverrides: LauncherDefaultViewOverrides;
    activeViewId: LauncherActiveViewId;
    config: LauncherViewConfig;
    savedConfig: LauncherViewConfig;
    scale: LauncherScaleInfo;
    groups: LauncherGroup[];
    groupsPagination: {
        total: number;
        page: number;
        pageSize: number;
    };
};

export default function ResourceLauncher({
    orgId,
    isAdmin,
    views,
    defaultViewOverrides,
    activeViewId,
    config,
    savedConfig,
    scale: initialScale,
    groups,
    groupsPagination
}: ResourceLauncherProps) {
    const t = useTranslations();
    const { toast } = useToast();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();
    const router = useRouter();
    const { navigate, isNavigating, searchParams } = useNavigationContext();
    const [isRefreshing, startRefreshTransition] = useTransition();
    const hasRestoredLastView = useRef(false);

    const [searchInputResetKey, setSearchInputResetKey] = useState(0);
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [newViewName, setNewViewName] = useState("");
    const [saveOrgWide, setSaveOrgWide] = useState(false);
    const [selectedResource, setSelectedResource] =
        useState<LauncherResource | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);

    const isDesktop = useMediaQuery("(min-width: 768px)");

    const scaleFilters = useMemo(
        () => ({
            query: config.query,
            groupBy: config.groupBy,
            siteIds: config.siteIds,
            labelIds: config.labelIds,
            sort_by: config.sortBy,
            order: config.order
        }),
        [
            config.groupBy,
            config.labelIds,
            config.order,
            config.query,
            config.siteIds,
            config.sortBy
        ]
    );

    const { data: scale = initialScale } = useQuery({
        ...launcherQueries.scale(orgId, scaleFilters),
        initialData: initialScale
    });

    const showGroupList = shouldShowLauncherGroupList(scale, config);
    const showSearchFirstGate = shouldShowSearchFirstGate(scale, config);
    const showFlatResourceList = shouldShowFlatResourceList(scale, config);
    const effectiveConfig = useMemo(
        () => getEffectiveLauncherConfig(scale, config),
        [config, scale]
    );

    const configRef = useRef(config);
    configRef.current = config;
    const searchInputRef = useRef(config.query);
    const activeViewIdRef = useRef(activeViewId);
    activeViewIdRef.current = activeViewId;

    useEffect(() => {
        if (hasRestoredLastView.current) {
            return;
        }
        hasRestoredLastView.current = true;

        const parsed = parseLauncherUrlState(searchParams);
        if (parsed.hasAnyLauncherParams) {
            return;
        }

        const lastView = readLauncherLastView(orgId);
        if (lastView === null || lastView === activeViewId) {
            return;
        }

        const isValid =
            lastView === "default" ||
            views.some((view) => view.viewId === lastView);
        if (!isValid) {
            return;
        }

        const baseConfig = getLauncherUrlBaseConfig(
            lastView,
            views,
            defaultViewOverrides
        );
        const params = serializeLauncherUrlState({
            viewId: lastView,
            config: baseConfig
        });
        navigate({ searchParams: params, replace: true });
    }, [
        activeViewId,
        defaultViewOverrides,
        navigate,
        orgId,
        searchParams,
        views
    ]);

    const navigateToConfig = useCallback(
        (viewId: LauncherActiveViewId, nextConfig: LauncherViewConfig) => {
            const params = serializeLauncherUrlState({
                viewId,
                config: nextConfig
            });
            navigate({ searchParams: params });
        },
        [navigate]
    );

    const debouncedNavigateSearch = useDebouncedCallback(
        (viewId: LauncherActiveViewId, query: string) => {
            navigateToConfig(viewId, { ...configRef.current, query });
        },
        300
    );

    const selectView = useCallback(
        (viewId: LauncherActiveViewId) => {
            writeLauncherLastView(orgId, viewId);
            const baseConfig = getLauncherUrlBaseConfig(
                viewId,
                views,
                defaultViewOverrides
            );
            navigateToConfig(viewId, baseConfig);
        },
        [defaultViewOverrides, navigateToConfig, orgId, views]
    );

    const activeSavedView = useMemo(
        () =>
            activeViewId === "default"
                ? null
                : views.find((view) => view.viewId === activeViewId),
        [activeViewId, views]
    );

    const isDefaultView = activeViewId === "default";
    const isOrgWideView = Boolean(activeSavedView?.isOrgWide);
    const hasUnsavedChanges = !isLauncherConfigEqual(config, savedConfig);
    const canResetSystemDefault =
        isDefaultView &&
        (Boolean(defaultViewOverrides.personal) ||
            (isAdmin && Boolean(defaultViewOverrides.orgWide)));

    const selectedSites: Selectedsite[] = useMemo(
        () =>
            config.siteIds.map((siteId) => ({
                siteId,
                name: String(siteId),
                type: "newt"
            })),
        [config.siteIds]
    );

    const selectedLabels: SelectedLabel[] = useMemo(
        () =>
            config.labelIds.map((labelId) => ({
                labelId,
                name: String(labelId),
                color: "#a1a1aa"
            })),
        [config.labelIds]
    );

    const createViewMutation = useMutation({
        mutationFn: async (payload: {
            name: string;
            config: LauncherViewConfig;
            orgWide: boolean;
        }) => {
            const res = await api.post(`/org/${orgId}/launcher/views`, payload);
            return res.data.data as LauncherViewRecord;
        },
        onSuccess: (view) => {
            writeLauncherLastView(orgId, view.viewId);
            const params = serializeLauncherUrlState({
                viewId: view.viewId,
                config: view.config
            });
            navigate({ searchParams: params, replace: true });
            router.refresh();
            setSaveDialogOpen(false);
            setNewViewName("");
            toast({
                title: t("resourceLauncherViewSaved"),
                description: t("resourceLauncherViewSavedDescription")
            });
        },
        onError: (error) => {
            toast({
                variant: "destructive",
                title: t("resourceLauncherViewSaveFailed"),
                description: formatAxiosError(
                    error,
                    t("resourceLauncherViewSaveFailedDescription")
                )
            });
        }
    });

    const updateViewMutation = useMutation({
        mutationFn: async (payload: {
            viewId: number;
            name?: string;
            config?: LauncherViewConfig;
            orgWide?: boolean;
        }) => {
            const { viewId, ...body } = payload;
            const res = await api.put(
                `/org/${orgId}/launcher/views/${viewId}`,
                body
            );
            return res.data.data as LauncherViewRecord;
        },
        onSuccess: (view) => {
            const params = serializeLauncherUrlState({
                viewId: view.viewId,
                config: view.config
            });
            navigate({ searchParams: params, replace: true });
            router.refresh();
            toast({
                title: t("resourceLauncherViewSaved"),
                description: t("resourceLauncherViewSavedDescription")
            });
        },
        onError: (error) => {
            toast({
                variant: "destructive",
                title: t("resourceLauncherViewSaveFailed"),
                description: formatAxiosError(
                    error,
                    t("resourceLauncherViewSaveFailedDescription")
                )
            });
        }
    });

    const saveDefaultViewMutation = useMutation({
        mutationFn: async (payload: {
            config: LauncherViewConfig;
            orgWide: boolean;
        }) => {
            const res = await api.put(
                `/org/${orgId}/launcher/default-view`,
                payload
            );
            return res.data.data as LauncherViewRecord;
        },
        onSuccess: () => {
            writeLauncherLastView(orgId, "default");
            const params = serializeLauncherUrlState({
                viewId: "default",
                config
            });
            navigate({ searchParams: params, replace: true });
            router.refresh();
            toast({
                title: t("resourceLauncherViewSaved"),
                description: t("resourceLauncherViewSavedDescription")
            });
        },
        onError: (error) => {
            toast({
                variant: "destructive",
                title: t("resourceLauncherViewSaveFailed"),
                description: formatAxiosError(
                    error,
                    t("resourceLauncherViewSaveFailedDescription")
                )
            });
        }
    });

    const resetSystemDefaultMutation = useMutation({
        mutationFn: async () => {
            const resetAll = isAdmin && Boolean(defaultViewOverrides.orgWide);
            await api.delete(`/org/${orgId}/launcher/default-view`, {
                data: resetAll ? { all: true } : { orgWide: false }
            });
        },
        onSuccess: () => {
            writeLauncherLastView(orgId, "default");
            const nextOverrides: LauncherDefaultViewOverrides = {
                personal: null,
                orgWide:
                    isAdmin && defaultViewOverrides.orgWide
                        ? null
                        : defaultViewOverrides.orgWide
            };
            const targetConfig =
                getEffectiveDefaultLauncherConfig(nextOverrides);
            searchInputRef.current = targetConfig.query;
            setSearchInputResetKey((key) => key + 1);
            const params = serializeLauncherUrlState({
                viewId: "default",
                config: targetConfig
            });
            navigate({ searchParams: params, replace: true });
            router.refresh();
            toast({
                title: t("resourceLauncherSystemDefaultRestored"),
                description: t(
                    "resourceLauncherSystemDefaultRestoredDescription"
                )
            });
        },
        onError: (error) => {
            toast({
                variant: "destructive",
                title: t("resourceLauncherViewSaveFailed"),
                description: formatAxiosError(
                    error,
                    t("resourceLauncherViewSaveFailedDescription")
                )
            });
        }
    });

    const deleteViewMutation = useMutation({
        mutationFn: async (viewId: number) => {
            await api.delete(`/org/${orgId}/launcher/views/${viewId}`);
        },
        onSuccess: () => {
            writeLauncherLastView(orgId, "default");
            const params = serializeLauncherUrlState({
                viewId: "default",
                config: getLauncherUrlBaseConfig(
                    "default",
                    views,
                    defaultViewOverrides
                )
            });
            navigate({ searchParams: params, replace: true });
            router.refresh();
            toast({
                title: t("resourceLauncherViewDeleted"),
                description: t("resourceLauncherViewDeletedDescription")
            });
        },
        onError: (error) => {
            toast({
                variant: "destructive",
                title: t("resourceLauncherViewDeleteFailed"),
                description: formatAxiosError(
                    error,
                    t("resourceLauncherViewDeleteFailedDescription")
                )
            });
        }
    });

    const applyConfigPatch = useCallback(
        (patch: Partial<LauncherViewConfig>) => {
            const nextConfig = {
                ...configRef.current,
                ...patch,
                query: searchInputRef.current
            };
            navigateToConfig(activeViewIdRef.current, nextConfig);
        },
        [navigateToConfig]
    );

    const handleClearFilters = useCallback(() => {
        searchInputRef.current = "";
        setSearchInputResetKey((key) => key + 1);
        navigateToConfig(activeViewIdRef.current, {
            ...configRef.current,
            query: "",
            siteIds: [],
            labelIds: []
        });
    }, [navigateToConfig]);

    const handleResetView = useCallback(() => {
        searchInputRef.current = savedConfig.query;
        setSearchInputResetKey((key) => key + 1);
        navigateToConfig(activeViewIdRef.current, savedConfig);
    }, [navigateToConfig, savedConfig]);

    const handleResetSystemDefault = useCallback(() => {
        resetSystemDefaultMutation.mutate();
    }, [resetSystemDefaultMutation]);

    const refreshData = () => {
        startRefreshTransition(async () => {
            try {
                await api.post(`/org/${orgId}/launcher/invalidate-cache`);
                await queryClient.invalidateQueries({
                    queryKey: ["ORG", orgId, "LAUNCHER"]
                });
                router.refresh();
            } catch {
                toast({
                    title: t("error"),
                    description: t("refreshError"),
                    variant: "destructive"
                });
            }
        });
    };

    const handleSaveToCurrent = () => {
        if (isDefaultView) {
            saveDefaultViewMutation.mutate({
                config,
                orgWide: false
            });
            return;
        }
        if (isOrgWideView && !isAdmin) {
            return;
        }
        updateViewMutation.mutate({
            viewId: activeViewId,
            config
        });
    };

    const handleSaveAsNew = () => {
        setSaveOrgWide(false);
        setNewViewName("");
        setSaveDialogOpen(true);
    };

    const handleSaveForEveryone = () => {
        if (isDefaultView) {
            saveDefaultViewMutation.mutate({
                config,
                orgWide: true
            });
            return;
        }
        updateViewMutation.mutate({
            viewId: activeViewId,
            orgWide: true
        });
    };

    const handleMakePersonal = () => {
        if (isDefaultView) {
            return;
        }
        updateViewMutation.mutate({
            viewId: activeViewId,
            orgWide: false
        });
    };

    const handleCreateView = () => {
        if (!newViewName.trim()) {
            return;
        }
        createViewMutation.mutate({
            name: newViewName.trim(),
            config,
            orgWide: saveOrgWide && isAdmin
        });
    };

    const handleResourceSelect = useCallback((resource: LauncherResource) => {
        setSelectedResource(resource);
        setPanelOpen(true);
    }, []);

    const handlePanelOpenChange = useCallback((open: boolean) => {
        setPanelOpen(open);
        if (!open) {
            setSelectedResource(null);
        }
    }, []);

    const savedViewTabs = views.map((view) => ({
        viewId: view.viewId,
        name: view.name
    }));

    const renderToolbarSearch = (searchClassName: string) => (
        <div className={cn("relative shrink-0", searchClassName)}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
                key={`${activeViewId}-${searchInputResetKey}`}
                defaultValue={config.query}
                onChange={(event) => {
                    const value = event.currentTarget.value;
                    searchInputRef.current = value;
                    debouncedNavigateSearch(activeViewIdRef.current, value);
                }}
                placeholder={t("resourceLauncherSearchPlaceholder")}
                className="pl-8"
                type="search"
            />
        </div>
    );

    const renderToolbarFilterSort = () => (
        <>
            <LauncherFilterPopover
                orgId={orgId}
                selectedSites={selectedSites}
                selectedLabels={selectedLabels}
                onSitesChange={(sites) =>
                    applyConfigPatch({
                        siteIds: sites.map((site) => site.siteId)
                    })
                }
                onLabelsChange={(labels) =>
                    applyConfigPatch({
                        labelIds: labels.map((label) => label.labelId)
                    })
                }
            />
            <LauncherSortButton
                order={config.order}
                onToggle={() =>
                    applyConfigPatch({
                        order: config.order === "asc" ? "desc" : "asc"
                    })
                }
            />
        </>
    );

    const renderToolbarActions = () => (
        <>
            <LauncherSaveViewMenu
                isDefaultView={isDefaultView}
                isAdmin={isAdmin}
                isOrgWideView={isOrgWideView}
                hasUnsavedChanges={hasUnsavedChanges}
                canResetSystemDefault={canResetSystemDefault}
                onSaveToCurrent={handleSaveToCurrent}
                onSaveAsNew={handleSaveAsNew}
                onSaveForEveryone={handleSaveForEveryone}
                onMakePersonal={handleMakePersonal}
                onResetView={handleResetView}
                onResetSystemDefault={handleResetSystemDefault}
                onDeleteView={() => setDeleteDialogOpen(true)}
            />
            <LauncherSettingsMenu
                config={config}
                capabilities={scale.capabilities}
                isCompactMode={scale.mode === "compact"}
                selectedGroupBy={effectiveConfig.groupBy}
                onConfigChange={applyConfigPatch}
            />
            <LauncherRefreshButton
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isNavigating}
            />
        </>
    );

    const renderToolbarViews = () => (
        <LauncherViewTabs
            activeViewId={activeViewId}
            savedViews={savedViewTabs}
            onSelectView={selectView}
        />
    );

    return (
        <div className="flex flex-col" aria-busy={isNavigating}>
            <SettingsSectionTitle
                title={t("resourceLauncherTitle")}
                description={t("resourceLauncherDescription")}
            />

            {isDesktop ? (
                <div className="mb-6 flex w-full min-w-0 items-center gap-3">
                    {renderToolbarSearch("w-64")}
                    <div className="flex shrink-0 items-center gap-2">
                        {renderToolbarFilterSort()}
                    </div>
                    <div className="min-w-0 flex-1 overflow-x-auto">
                        {renderToolbarViews()}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {renderToolbarActions()}
                    </div>
                </div>
            ) : (
                <div className="mb-6 flex flex-col gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        {renderToolbarActions()}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            {renderToolbarSearch("w-full")}
                        </div>
                        {renderToolbarFilterSort()}
                    </div>
                    <div className="overflow-x-auto">
                        {renderToolbarViews()}
                    </div>
                </div>
            )}

            {showSearchFirstGate ? (
                <LauncherSearchFirstGate layout={config.layout} />
            ) : showGroupList ? (
                <LauncherGroupList
                    orgId={orgId}
                    activeViewId={activeViewId}
                    config={effectiveConfig}
                    initialGroups={groups}
                    groupsPagination={groupsPagination}
                    onClearFilters={handleClearFilters}
                    onResourceSelect={handleResourceSelect}
                />
            ) : showFlatResourceList ? (
                <LauncherFlatResourceList
                    orgId={orgId}
                    activeViewId={activeViewId}
                    config={effectiveConfig}
                    onClearFilters={handleClearFilters}
                    onResourceSelect={handleResourceSelect}
                />
            ) : null}

            <LauncherResourcePanel
                open={panelOpen}
                onOpenChange={handlePanelOpenChange}
                resource={selectedResource}
                orgId={orgId}
                isAdmin={isAdmin}
            />

            {activeSavedView ? (
                <ConfirmDeleteDialog
                    open={deleteDialogOpen}
                    setOpen={setDeleteDialogOpen}
                    string={activeSavedView.name}
                    title={t("resourceLauncherDeleteViewTitle")}
                    buttonText={t("resourceLauncherDeleteViewConfirm")}
                    dialog={<p>{t("resourceLauncherDeleteViewQuestion")}</p>}
                    onConfirm={async () => {
                        await deleteViewMutation.mutateAsync(
                            activeSavedView.viewId
                        );
                    }}
                />
            ) : null}

            <Credenza open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("resourceLauncherSaveAsNewView")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("resourceLauncherSaveAsNewViewDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <div className="space-y-2">
                            <Label htmlFor="new-view-name">
                                {t("resourceLauncherViewNameLabel")}
                            </Label>
                            <Input
                                id="new-view-name"
                                value={newViewName}
                                onChange={(event) =>
                                    setNewViewName(event.target.value)
                                }
                            />
                        </div>
                        {isAdmin ? (
                            <div className="mt-4">
                                <CheckboxWithLabel
                                    id="save-org-wide"
                                    aria-describedby="save-org-wide-desc"
                                    label={t("resourceLauncherSaveForEveryone")}
                                    checked={saveOrgWide}
                                    onCheckedChange={(checked) =>
                                        setSaveOrgWide(checked === true)
                                    }
                                />
                                <p
                                    id="save-org-wide-desc"
                                    className="text-sm text-muted-foreground mt-2"
                                >
                                    {t(
                                        "resourceLauncherSaveForEveryoneDescription"
                                    )}
                                </p>
                            </div>
                        ) : null}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <Button
                            variant="outline"
                            onClick={() => setSaveDialogOpen(false)}
                        >
                            {t("cancel")}
                        </Button>
                        <Button
                            onClick={handleCreateView}
                            loading={createViewMutation.isPending}
                        >
                            {t("save")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </div>
    );
}
