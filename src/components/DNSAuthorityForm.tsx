"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { formatAxiosError } from "@app/lib/api/formatAxiosError";
import { zodResolver } from "@hookform/resolvers/zod";
import { type GetResourceResponse } from "@server/routers/resource";
import { type ListTargetsResponse } from "@server/routers/target/listTargets";
import { type ListSitesResponse } from "@server/routers/site/listSites";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Info, Globe, Server, AlertTriangle, ExternalLink, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface DNSAuthorityFormProps {
    resource: GetResourceResponse;
    updateResource: (data: Partial<GetResourceResponse>) => void;
    targets: ListTargetsResponse["targets"];
    sites: ListSitesResponse["sites"];
}

const dnsAuthoritySchema = z.object({
    dnsAuthorityEnabled: z.boolean(),
    dnsAuthorityTtl: z.number().min(10).max(86400),
    dnsAuthorityRoutingPolicy: z.enum(["failover", "roundrobin", "priority", "intelligent"])
});

type DNSAuthorityFormData = z.infer<typeof dnsAuthoritySchema>;

export function DNSAuthorityForm({ resource, updateResource, targets, sites }: DNSAuthorityFormProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [isSubmitting, setIsSubmitting] = useState(false);

    const relevantSites = useMemo(() => {
        if (!targets || !sites) return [];
        const targetSiteIds = new Set(targets.map((t) => t.siteId));
        return sites.filter((site) => targetSiteIds.has(site.siteId));
    }, [targets, sites]);

    const hasHealthChecks = useMemo(() => {
        if (!targets || targets.length === 0) return false;
        return targets.some((t) => t.hcEnabled);
    }, [targets]);

    const canEnableDNSAuthority = useMemo(() => {
        if (!relevantSites || relevantSites.length < 1) return false;

        // Check if at least one relevant site has DNS Authority enabled with a Public IP
        const sitesWithAuth = relevantSites.filter(s => s.dnsAuthorityEnabled && s.publicIp);

        // We need at least 1 site with DNS Authority enabled to allow turning this on.
        // A second site can be added later without any downtime or reconfiguration.
        return sitesWithAuth.length >= 1;
    }, [relevantSites]);

    const defaultPolicy = (() => {
        const saved = resource.dnsAuthorityRoutingPolicy as "failover" | "roundrobin" | "priority" | "intelligent" | undefined;
        if (!hasHealthChecks && (saved === "failover" || saved === "priority" || saved === "intelligent" || !saved)) {
            return "roundrobin";
        }
        return saved ?? "failover";
    })();

    const form = useForm<DNSAuthorityFormData>({
        resolver: zodResolver(dnsAuthoritySchema),
        defaultValues: {
            dnsAuthorityEnabled: resource.dnsAuthorityEnabled ?? false,
            dnsAuthorityTtl: resource.dnsAuthorityTtl ?? 60,
            dnsAuthorityRoutingPolicy: defaultPolicy
        }
    });

    const dnsAuthorityEnabled = form.watch("dnsAuthorityEnabled");

    // Auto-switch to roundrobin when health-dependent policies are selected but no healthchecks exist
    useEffect(() => {
        const currentPolicy = form.getValues("dnsAuthorityRoutingPolicy");
        if (!hasHealthChecks && (currentPolicy === "failover" || currentPolicy === "priority" || currentPolicy === "intelligent")) {
            form.setValue("dnsAuthorityRoutingPolicy", "roundrobin");
        }
    }, [hasHealthChecks, form]);

    const onSubmit = async (data: DNSAuthorityFormData) => {
        setIsSubmitting(true);
        try {
            const res = await api.post(`/resource/${resource.resourceId}`, data);
            if (res.status === 200) {
                updateResource(data);
                toast({
                    title: t("dnsAuthorityUpdated"),
                    description: t("dnsAuthorityUpdatedDescription"),
                });
            }
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e, t("dnsAuthorityUpdateError")),
                variant: "destructive"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    <div className="flex flex-row items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                            <Globe className="h-5 w-5" />
                            {t("dnsAuthority")}
                        </div>
                        {dnsAuthorityEnabled && (
                            <Link
                                href="https://docs.pangolin.net/manage/dns-authority"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <Button type="button" variant="outline" size="sm" className="h-8 shrink-0">
                                    <ExternalLink className="h-3 w-3 mr-1" />
                                    {t("learnMore")}
                                </Button>
                            </Link>
                        )}
                    </div>
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("dnsAuthorityDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>

            <SettingsSectionBody>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <SettingsSectionForm>
                            <FormField
                                control={form.control}
                                name="dnsAuthorityEnabled"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center justify-between">
                                        <div className="space-y-0.5">
                                            <FormLabel>
                                                {t("dnsAuthorityEnable")}
                                            </FormLabel>
                                            <FormDescription>
                                                {t("dnsAuthorityEnableDescription")}
                                            </FormDescription>
                                        </div>
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                disabled={!canEnableDNSAuthority}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {!canEnableDNSAuthority && (
                                <Alert variant="default" className="border-yellow-500/50 bg-yellow-500/10">
                                    <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
                                    <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                                        To enable Intelligent DNS Routing, at least one target's site must have DNS Authority enabled with a Public IP configured.
                                    </AlertDescription>
                                </Alert>
                            )}

                            {dnsAuthorityEnabled && (
                                <>
                                    <FormField
                                        control={form.control}
                                        name="dnsAuthorityRoutingPolicy"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    <div className="flex items-center gap-2">
                                                        {t("dnsAuthorityRoutingPolicy")}
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Info className="h-4 w-4 text-muted-foreground" />
                                                                </TooltipTrigger>
                                                                <TooltipContent className="max-w-xs">
                                                                    <p>{t("dnsAuthorityRoutingPolicyTooltip")}</p>
                                                                    {!hasHealthChecks && (
                                                                        <p className="mt-2">
                                                                            {t("dnsAuthorityPolicyNoHealthChecks")}
                                                                        </p>
                                                                    )}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                </FormLabel>
                                                <Select
                                                    value={field.value}
                                                    onValueChange={field.onChange}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="failover" disabled={!hasHealthChecks}>
                                                            {t("dnsAuthorityPolicyFailover")}
                                                        </SelectItem>
                                                        <SelectItem value="roundrobin">
                                                            {t("dnsAuthorityPolicyRoundRobin")}
                                                        </SelectItem>
                                                        <SelectItem value="priority" disabled={!hasHealthChecks}>
                                                            {t("dnsAuthorityPolicyPriority")}
                                                        </SelectItem>
                                                        <SelectItem value="intelligent" disabled={!hasHealthChecks}>
                                                            Intelligent (Lowest Latency + Healthy)
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormDescription>
                                                    {field.value === "failover" && t("dnsAuthorityPolicyFailoverDescription")}
                                                    {field.value === "roundrobin" && t("dnsAuthorityPolicyRoundRobinDescription")}
                                                    {field.value === "priority" && t("dnsAuthorityPolicyPriorityDescription")}
                                                    {field.value === "intelligent" && t("dnsAuthorityPolicyIntelligentDescription")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="dnsAuthorityTtl"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("dnsAuthorityTtl")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={10}
                                                        max={86400}
                                                        {...field}
                                                        onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t("dnsAuthorityTtlDescription")}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <div className="rounded-lg border p-4 space-y-2">
                                        <div className="flex items-center gap-2 font-medium">
                                            <Server className="h-4 w-4" />
                                            {t("dnsAuthorityNsRecords")}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {t("dnsAuthorityNsRecordsDescription")}
                                        </p>
                                        <div className="bg-muted rounded p-3 font-mono text-sm space-y-2">
                                            {relevantSites.filter(s => s.dnsAuthorityEnabled && s.publicIp).map((site, index) => (
                                                <div key={site.siteId}>
                                                    <div>{resource.fullDomain} NS ns{index + 1}.{resource.fullDomain}</div>
                                                    <div>ns{index + 1}.{resource.fullDomain} A {site.publicIp}</div>
                                                </div>
                                            ))}
                                            {(!relevantSites.some(s => s.dnsAuthorityEnabled && s.publicIp)) && (
                                                <div className="text-muted-foreground italic">No DNS Authority sites configured</div>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {t("dnsAuthorityNsRecordsNote")}
                                        </p>
                                    </div>
                                </>
                            )}
                        </SettingsSectionForm>

                        <Button
                            type="submit"
                            disabled={isSubmitting}
                            loading={isSubmitting}
                        >
                            {t("saveChanges")}
                        </Button>
                    </form>
                </Form>
            </SettingsSectionBody>
        </SettingsSection>
    );
}
