"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEnvContext } from "@/hooks/useEnvContext";
import { toast } from "@/hooks/useToast";
import { createApiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
    finalizeSubdomainSanitize,
    isValidSubdomainStructure,
    isWildcardSubdomain,
    sanitizeInputRaw,
    validateByDomainType
} from "@/lib/subdomain-utils";
import { orgQueries } from "@app/lib/queries";
import { build } from "@server/build";
import { CheckDomainAvailabilityResponse } from "@server/routers/domain/types";
import { useQuery } from "@tanstack/react-query";
import { AxiosResponse } from "axios";
import {
    AlertCircle,
    CheckIcon,
    ChevronsUpDown,
    ExternalLink,
    Globe,
    KeyRound
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { usePaidStatus } from "@/hooks/usePaidStatus";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import { toUnicode } from "punycode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserContext } from "@app/hooks/useUserContext";

type AvailableOption = {
    domainNamespaceId: string;
    fullDomain: string;
    domainId: string;
};

type DomainOption = {
    id: string;
    domain: string;
    type: "organization" | "provided" | "provided-search";
    verified?: boolean;
    domainType?: "ns" | "cname" | "wildcard";
    domainId?: string;
    domainNamespaceId?: string;
};

interface DomainPickerProps {
    orgId: string;
    onDomainChange?: (
        domainInfo: {
            domainId: string;
            domainNamespaceId?: string;
            type: "organization" | "provided";
            subdomain?: string;
            fullDomain: string;
            baseDomain: string;
            wildcard?: boolean;
        } | null
    ) => void;
    cols?: number;
    hideFreeDomain?: boolean;
    defaultFullDomain?: string | null;
    defaultSubdomain?: string | null;
    defaultDomainId?: string | null;
    warnOnProvidedDomain?: boolean;
    allowWildcard?: boolean;
}

export default function DomainPicker({
    orgId,
    onDomainChange,
    cols = 2,
    hideFreeDomain = false,
    defaultSubdomain,
    defaultFullDomain,
    defaultDomainId,
    warnOnProvidedDomain = false,
    allowWildcard = false
}: DomainPickerProps) {
    const { env } = useEnvContext();
    const { user } = useUserContext();
    const api = createApiClient({ env });
    const t = useTranslations();
    const { hasSaasSubscription, isPaidUser } = usePaidStatus();

    const requiresPaywall =
        build === "saas" &&
        !hasSaasSubscription(tierMatrix[TierFeature.DomainNamespaces]) &&
        new Date(user.dateCreated) > new Date("2026-04-13");

    const wildcardAllowed =
        allowWildcard && isPaidUser(tierMatrix[TierFeature.WildcardSubdomain]);

    const { data = [], isLoading: loadingDomains } = useQuery(
        orgQueries.domains({ orgId })
    );

    // Wildcard mode is derived from the input itself — if the user types a
    // wildcard subdomain (e.g. *.foo) and allowWildcard is enabled, it's active.

    if (!env.flags.usePangolinDns) {
        hideFreeDomain = true;
    }

    const [subdomainInput, setSubdomainInput] = useState(
        defaultSubdomain ?? ""
    );

    const [selectedBaseDomain, setSelectedBaseDomain] =
        useState<DomainOption | null>(null);
    const [availableOptions, setAvailableOptions] = useState<AvailableOption[]>(
        []
    );

    // memoized to prevent reruning the effect that selects the initial domain indefinitely
    // removing this will break and cause an infinite rerender
    const organizationDomains = useMemo(() => {
        return data
            .filter(
                (domain) =>
                    domain.type === "ns" ||
                    domain.type === "cname" ||
                    domain.type === "wildcard"
            )
            .map((domain) => ({
                ...domain,
                baseDomain: toUnicode(domain.baseDomain),
                type: domain.type as "ns" | "cname" | "wildcard"
            }));
    }, [data]);

    const [open, setOpen] = useState(false);

    // Provided domain search states
    const [userInput, setUserInput] = useState<string>(defaultSubdomain ?? "");
    const [isChecking, setIsChecking] = useState(false);
    const [providedDomainsShown, setProvidedDomainsShown] = useState(3);
    const [selectedProvidedDomain, setSelectedProvidedDomain] =
        useState<AvailableOption | null>(null);

    // Only run the initial base-domain selection once the domains have
    // loaded. This must not re-run on later `defaultDomainId`/`defaultSubdomain`
    // changes, because selecting a provided (namespace) domain calls
    // onDomainChange(null), which the parent form echoes back as
    // defaultDomainId/defaultSubdomain becoming undefined — re-running this
    // effect on that change would immediately snap the selector back to the
    // organization domain, making provided domains unselectable whenever one
    // was already set.
    const didSelectInitialDomainRef = useRef(false);

    useEffect(() => {
        if (!loadingDomains && !didSelectInitialDomainRef.current) {
            didSelectInitialDomainRef.current = true;
            let domainOptionToSelect: DomainOption | null = null;
            if (organizationDomains.length > 0) {
                // Select the first organization domain or the one provided from props
                let firstOrExistingDomain = organizationDomains.find(
                    (domain) => domain.domainId === defaultDomainId
                );
                // if no default Domain
                if (!defaultDomainId) {
                    firstOrExistingDomain = organizationDomains[0];
                }

                if (firstOrExistingDomain) {
                    domainOptionToSelect = {
                        id: `org-${firstOrExistingDomain.domainId}`,
                        domain: firstOrExistingDomain.baseDomain,
                        type: "organization",
                        verified: firstOrExistingDomain.verified,
                        domainType: firstOrExistingDomain.type,
                        domainId: firstOrExistingDomain.domainId
                    };

                    const base = firstOrExistingDomain.baseDomain;
                    const sub =
                        firstOrExistingDomain.type !== "cname"
                            ? defaultSubdomain?.trim() || undefined
                            : undefined;
                    const isWc =
                        allowWildcard && !!sub && isWildcardSubdomain(sub);

                    onDomainChange?.({
                        domainId: firstOrExistingDomain.domainId,
                        type: "organization",
                        subdomain: sub,
                        fullDomain: sub ? `${sub}.${base}` : base,
                        baseDomain: base,
                        wildcard: isWc
                    });
                }
            }

            if (
                !domainOptionToSelect &&
                build !== "oss" &&
                !hideFreeDomain &&
                defaultDomainId !== undefined
            ) {
                // If no organization domains, select the provided domain option
                const domainOptionText =
                    build === "enterprise"
                        ? t("domainPickerProvidedDomain")
                        : t("domainPickerFreeProvidedDomain");
                // free domain option
                domainOptionToSelect = {
                    id: "provided-search",
                    domain: domainOptionText,
                    type: "provided-search"
                };
            }

            setSelectedBaseDomain(domainOptionToSelect);
        }
    }, [
        loadingDomains,
        organizationDomains,
        defaultSubdomain,
        hideFreeDomain,
        defaultDomainId
    ]);

    const checkAvailability = useCallback(
        async (input: string) => {
            if (!input.trim()) {
                setAvailableOptions([]);
                setIsChecking(false);
                return;
            }

            setIsChecking(true);
            try {
                const checkSubdomain = input
                    .toLowerCase()
                    .replace(/\./g, "-")
                    .replace(/[^a-z0-9-]/g, "")
                    .replace(/-+/g, "-") // Replace multiple consecutive dashes with single dash
                    .replace(/^-|-$/g, ""); // Remove leading/trailing dashes

                if (build != "oss") {
                    const response = await api.get<
                        AxiosResponse<CheckDomainAvailabilityResponse>
                    >(
                        `/domain/check-namespace-availability?subdomain=${encodeURIComponent(checkSubdomain)}`
                    );

                    if (response.status === 200) {
                        const { options } = response.data.data;
                        setAvailableOptions(options);
                    }
                }
            } catch (error) {
                console.error("Failed to check domain availability:", error);
                setAvailableOptions([]);
                toast({
                    variant: "destructive",
                    title: t("domainPickerError"),
                    description: t("domainPickerErrorCheckAvailability")
                });
            } finally {
                setIsChecking(false);
            }
        },
        [api]
    );

    const debouncedCheckAvailability = useCallback(
        debounce(checkAvailability, 500),
        [checkAvailability]
    );

    useEffect(() => {
        if (selectedBaseDomain?.type === "provided-search") {
            setProvidedDomainsShown(3);
            setSelectedProvidedDomain(null);

            if (userInput.trim()) {
                setIsChecking(true);
                debouncedCheckAvailability(userInput);
            } else {
                setAvailableOptions([]);
                setIsChecking(false);
            }
        }
    }, [userInput, debouncedCheckAvailability, selectedBaseDomain]);

    const finalizeSubdomain = (sub: string, base: DomainOption): string => {
        const wildcardMode = wildcardAllowed && isWildcardSubdomain(sub);
        const sanitized = finalizeSubdomainSanitize(sub, wildcardMode);

        if (!sanitized) {
            toast({
                variant: "destructive",
                title: t("domainPickerInvalidSubdomain"),
                description: t("domainPickerInvalidSubdomainRemoved", { sub })
            });
            return "";
        }

        const ok = validateByDomainType(sanitized, {
            type:
                base.type === "provided-search"
                    ? "provided-search"
                    : "organization",
            domainType: base.domainType,
            allowWildcard: wildcardMode
        });

        if (!ok) {
            toast({
                variant: "destructive",
                title: t("domainPickerInvalidSubdomain"),
                description: t("domainPickerInvalidSubdomainCannotMakeValid", {
                    sub,
                    domain: base.domain
                })
            });
            return "";
        }

        if (sub !== sanitized) {
            toast({
                title: t("domainPickerSubdomainSanitized"),
                description: t("domainPickerSubdomainCorrected", {
                    sub,
                    sanitized
                })
            });
        }

        return sanitized;
    };

    const handleSubdomainChange = (value: string) => {
        const raw = sanitizeInputRaw(value, allowWildcard);
        setSubdomainInput(raw);
        setSelectedProvidedDomain(null);

        if (selectedBaseDomain?.type === "organization") {
            const fullDomain = raw
                ? `${raw}.${selectedBaseDomain.domain}`
                : selectedBaseDomain.domain;
            const isWc = wildcardAllowed && isWildcardSubdomain(raw);

            onDomainChange?.({
                domainId: selectedBaseDomain.domainId!,
                type: "organization",
                subdomain: raw || undefined,
                fullDomain,
                baseDomain: selectedBaseDomain.domain,
                wildcard: isWc
            });
        }
    };

    const handleProvidedDomainInputChange = (value: string) => {
        setUserInput(value);
        if (selectedProvidedDomain) {
            setSelectedProvidedDomain(null);
            onDomainChange?.({
                domainId: "",
                type: "provided",
                subdomain: undefined,
                fullDomain: "",
                baseDomain: ""
            });
        }
    };

    const handleBaseDomainSelect = (option: DomainOption) => {
        let sub = subdomainInput;

        // If the selected domain doesn't support wildcards, strip any wildcard prefix.
        const supportsWildcard =
            wildcardAllowed &&
            option.type === "organization" &&
            option.domainType !== "cname";

        if (!supportsWildcard && isWildcardSubdomain(sub)) {
            sub = sub.replace(/^\*\./, "");
            setSubdomainInput(sub);
        }

        if (sub && sub.trim() !== "") {
            sub = finalizeSubdomain(sub, option) || "";
            setSubdomainInput(sub);
        } else {
            sub = "";
            setSubdomainInput("");
        }

        if (option.type === "provided-search") {
            setUserInput("");
            setAvailableOptions([]);
            setSelectedProvidedDomain(null);
        }

        setSelectedBaseDomain(option);
        setOpen(false);

        if (option.domainType === "cname") {
            sub = "";
            setSubdomainInput("");
        }

        const fullDomain = sub ? `${sub}.${option.domain}` : option.domain;
        const isWc = wildcardAllowed && !!sub && isWildcardSubdomain(sub);

        if (option.type === "provided-search") {
            onDomainChange?.(null); // prevent the modal from closing with `<subdomain>.Free Provided domain`
        } else {
            onDomainChange?.({
                domainId: option.domainId || "",
                domainNamespaceId: option.domainNamespaceId,
                type: "organization",
                subdomain:
                    option.domainType !== "cname"
                        ? sub || undefined
                        : undefined,
                fullDomain,
                baseDomain: option.domain,
                wildcard: isWc
            });
        }
    };

    const handleProvidedDomainSelect = (option: AvailableOption) => {
        setSelectedProvidedDomain(option);

        const parts = option.fullDomain.split(".");
        const subdomain = parts[0];
        const baseDomain = parts.slice(1).join(".");

        onDomainChange?.({
            domainId: option.domainId,
            domainNamespaceId: option.domainNamespaceId,
            type: "provided",
            subdomain,
            fullDomain: option.fullDomain,
            baseDomain
        });
    };

    const isSubdomainValid =
        selectedBaseDomain && subdomainInput
            ? validateByDomainType(subdomainInput, {
                  type:
                      selectedBaseDomain.type === "provided-search"
                          ? "provided-search"
                          : "organization",
                  domainType: selectedBaseDomain.domainType,
                  allowWildcard:
                      wildcardAllowed && isWildcardSubdomain(subdomainInput)
              })
            : true;

    const showSubdomainInput =
        selectedBaseDomain &&
        selectedBaseDomain.type === "organization" &&
        selectedBaseDomain.domainType !== "cname";

    const showProvidedDomainSearch =
        selectedBaseDomain?.type === "provided-search";

    const sortedAvailableOptions = [...availableOptions].sort((a, b) => {
        return a.fullDomain.localeCompare(b.fullDomain);
    });

    const displayedProvidedOptions = sortedAvailableOptions.slice(
        0,
        providedDomainsShown
    );

    const selectedDomainNamespaceId =
        selectedProvidedDomain?.domainNamespaceId ??
        displayedProvidedOptions.find(
            (opt) => opt.fullDomain === defaultFullDomain
        )?.domainNamespaceId;
    const hasMoreProvided =
        sortedAvailableOptions.length > providedDomainsShown;

    const noDomainsAvailable =
        !loadingDomains &&
        organizationDomains.length === 0 &&
        (build === "oss" || hideFreeDomain || requiresPaywall);

    if (noDomainsAvailable) {
        return (
            <Alert>
                <Globe className="h-4 w-4" />
                <AlertTitle>
                    {t("domainPickerNoDomainsAvailableTitle")}
                </AlertTitle>
                <AlertDescription className="space-y-3">
                    <p>{t("domainPickerNoDomainsAvailableDescription")}</p>
                    <Button asChild size="sm" variant="outline">
                        <Link href={`/${orgId}/settings/domains`}>
                            {t("domainPickerNoDomainsAvailableAction")}
                        </Link>
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="subdomain-input">
                            {t("domainPickerSubdomainLabel")}
                        </Label>
                    </div>
                    <Input
                        id="subdomain-input"
                        value={
                            selectedBaseDomain?.type === "provided-search"
                                ? userInput
                                : subdomainInput
                        }
                        placeholder={
                            showProvidedDomainSearch
                                ? ""
                                : showSubdomainInput
                                  ? wildcardAllowed
                                      ? "* or subdomain"
                                      : ""
                                  : t("domainPickerNotAvailableForCname")
                        }
                        disabled={
                            !showSubdomainInput && !showProvidedDomainSearch
                        }
                        className={cn(
                            !isSubdomainValid &&
                                subdomainInput &&
                                "border-red-500 focus:border-red-500"
                        )}
                        onChange={(e) => {
                            if (showProvidedDomainSearch) {
                                handleProvidedDomainInputChange(e.target.value);
                            } else {
                                handleSubdomainChange(e.target.value);
                            }
                        }}
                    />
                    {showSubdomainInput &&
                        subdomainInput &&
                        !isValidSubdomainStructure(
                            subdomainInput,
                            wildcardAllowed &&
                                isWildcardSubdomain(subdomainInput)
                        ) && (
                            <p className="text-sm text-red-500">
                                {t("domainPickerInvalidSubdomainStructure")}
                            </p>
                        )}
                    {allowWildcard &&
                        !wildcardAllowed &&
                        showSubdomainInput &&
                        isWildcardSubdomain(subdomainInput) && (
                            <>
                                <p className="text-sm text-red-500">
                                    {t(
                                        "domainPickerWildcardSubdomainNotAllowed"
                                    )}
                                </p>
                                <PaidFeaturesAlert
                                    tiers={
                                        tierMatrix[
                                            TierFeature.WildcardSubdomain
                                        ]
                                    }
                                />
                            </>
                        )}
                </div>

                <div className="space-y-2">
                    <Label>{t("domainPickerBaseDomainLabel")}</Label>
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={open}
                                className={cn(
                                    "h-9 w-full justify-between font-normal",
                                    !selectedBaseDomain &&
                                        "text-muted-foreground"
                                )}
                            >
                                <span className="truncate text-left">
                                    {selectedBaseDomain
                                        ? selectedBaseDomain.domain
                                        : t("domainPickerSelectBaseDomain")}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] p-0"
                            align="start"
                        >
                            <Command>
                                <CommandInput
                                    placeholder={t("domainPickerSearchDomains")}
                                />
                                <CommandList>
                                    <CommandEmpty>
                                        {t("domainPickerNoDomainsFound")}
                                    </CommandEmpty>
                                    {organizationDomains.length > 0 && (
                                        <CommandGroup
                                            heading={t(
                                                "domainPickerOrganizationDomains"
                                            )}
                                        >
                                            {organizationDomains.map(
                                                (orgDomain) => {
                                                    const description =
                                                        orgDomain.type ===
                                                        "wildcard"
                                                            ? t(
                                                                  "domainPickerManual"
                                                              )
                                                            : `${orgDomain.type.toUpperCase()} · ${
                                                                  orgDomain.verified
                                                                      ? t(
                                                                            "domainPickerVerified"
                                                                        )
                                                                      : t(
                                                                            "domainPickerUnverified"
                                                                        )
                                                              }`;
                                                    const optionId = `org-${orgDomain.domainId}`;

                                                    return (
                                                        <CommandItem
                                                            key={optionId}
                                                            value={`${orgDomain.baseDomain} ${description}`}
                                                            disabled={
                                                                !orgDomain.verified
                                                            }
                                                            onSelect={() =>
                                                                handleBaseDomainSelect(
                                                                    {
                                                                        id: optionId,
                                                                        domain: orgDomain.baseDomain,
                                                                        type: "organization",
                                                                        verified:
                                                                            orgDomain.verified,
                                                                        domainType:
                                                                            orgDomain.type,
                                                                        domainId:
                                                                            orgDomain.domainId
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            <CheckIcon
                                                                className={cn(
                                                                    "mr-2 h-4 w-4 shrink-0",
                                                                    selectedBaseDomain?.id ===
                                                                        optionId
                                                                        ? "opacity-100"
                                                                        : "opacity-0"
                                                                )}
                                                            />
                                                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                                <span className="truncate">
                                                                    {
                                                                        orgDomain.baseDomain
                                                                    }
                                                                </span>
                                                                <span className="text-muted-foreground text-xs leading-snug">
                                                                    {
                                                                        description
                                                                    }
                                                                </span>
                                                            </div>
                                                        </CommandItem>
                                                    );
                                                }
                                            )}
                                        </CommandGroup>
                                    )}
                                    {organizationDomains.length > 0 &&
                                        (build === "saas" ||
                                            build === "enterprise") &&
                                        !hideFreeDomain && <CommandSeparator />}
                                    {(build === "saas" ||
                                        build === "enterprise") &&
                                        !hideFreeDomain && (
                                            <CommandGroup
                                                heading={
                                                    build === "enterprise"
                                                        ? t(
                                                              "domainPickerProvidedDomains"
                                                          )
                                                        : t(
                                                              "domainPickerFreeDomains"
                                                          )
                                                }
                                            >
                                                <CommandItem
                                                    value={`${
                                                        build === "enterprise"
                                                            ? t(
                                                                  "domainPickerProvidedDomain"
                                                              )
                                                            : t(
                                                                  "domainPickerFreeProvidedDomain"
                                                              )
                                                    } ${t("domainPickerSearchForAvailableDomains")}`}
                                                    disabled={requiresPaywall}
                                                    onSelect={() =>
                                                        handleBaseDomainSelect({
                                                            id: "provided-search",
                                                            domain:
                                                                build ===
                                                                "enterprise"
                                                                    ? t(
                                                                          "domainPickerProvidedDomain"
                                                                      )
                                                                    : t(
                                                                          "domainPickerFreeProvidedDomain"
                                                                      ),
                                                            type: "provided-search"
                                                        })
                                                    }
                                                >
                                                    <CheckIcon
                                                        className={cn(
                                                            "mr-2 h-4 w-4 shrink-0",
                                                            selectedBaseDomain?.id ===
                                                                "provided-search"
                                                                ? "opacity-100"
                                                                : "opacity-0"
                                                        )}
                                                    />
                                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                        <span className="truncate">
                                                            {build ===
                                                            "enterprise"
                                                                ? t(
                                                                      "domainPickerProvidedDomain"
                                                                  )
                                                                : t(
                                                                      "domainPickerFreeProvidedDomain"
                                                                  )}
                                                        </span>
                                                        <span className="text-muted-foreground text-xs leading-snug">
                                                            {t(
                                                                "domainPickerSearchForAvailableDomains"
                                                            )}
                                                        </span>
                                                    </div>
                                                </CommandItem>
                                            </CommandGroup>
                                        )}
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            {requiresPaywall && !hideFreeDomain && (
                <Card className="mt-3 border-black-500/30 bg-linear-to-br from-black-500/10 via-background to-background overflow-hidden">
                    <CardContent className="py-3 px-4">
                        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                            <KeyRound className="size-4 shrink-0 text-black-500" />
                            <span>
                                {t("domainPickerFreeDomainsPaidFeature")}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/*showProvidedDomainSearch && build === "saas" && (
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        {t("domainPickerNotWorkSelfHosted")}
                    </AlertDescription>
                </Alert>
            )*/}

            {showProvidedDomainSearch && (
                <div className="space-y-4">
                    {warnOnProvidedDomain && (
                        <Alert variant="warning">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                {t("domainPickerRemoteExitNodeWarning")}
                            </AlertDescription>
                        </Alert>
                    )}
                    {isChecking && (
                        <div className="flex items-center justify-center p-8">
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                                <span>
                                    {t("domainPickerCheckingAvailability")}
                                </span>
                            </div>
                        </div>
                    )}

                    {!isChecking &&
                        sortedAvailableOptions.length === 0 &&
                        userInput.trim() && (
                            <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>
                                    {t("domainPickerNoMatchingDomains")}
                                </AlertDescription>
                            </Alert>
                        )}

                    {!isChecking && sortedAvailableOptions.length > 0 && (
                        <div className="space-y-3">
                            <RadioGroup
                                value={selectedDomainNamespaceId || ""}
                                defaultValue={selectedDomainNamespaceId}
                                onValueChange={(value) => {
                                    const option =
                                        displayedProvidedOptions.find(
                                            (opt) =>
                                                opt.domainNamespaceId === value
                                        );
                                    if (option) {
                                        handleProvidedDomainSelect(option);
                                    }
                                }}
                                style={{
                                    // @ts-expect-error CSS variable
                                    "--cols": `repeat(${cols}, minmax(0, 1fr))`
                                }}
                                className="grid gap-2 grid-cols-1 sm:grid-cols-(--cols)"
                            >
                                {displayedProvidedOptions.map((option) => {
                                    const isSelected =
                                        selectedDomainNamespaceId ===
                                        option.domainNamespaceId;
                                    return (
                                        <label
                                            key={option.domainNamespaceId}
                                            htmlFor={option.domainNamespaceId}
                                            data-state={
                                                isSelected
                                                    ? "checked"
                                                    : "unchecked"
                                            }
                                            className={cn(
                                                "relative flex rounded-lg border p-3 transition-colors cursor-pointer",
                                                isSelected
                                                    ? "border-primary bg-primary/10"
                                                    : "border-input hover:bg-accent"
                                            )}
                                        >
                                            <RadioGroupItem
                                                value={option.domainNamespaceId}
                                                id={option.domainNamespaceId}
                                                className="absolute left-3 top-3 h-4 w-4 border-primary text-primary"
                                            />
                                            <div className="flex items-center justify-between pl-7 flex-1">
                                                <div>
                                                    <p className="font-mono text-sm">
                                                        {option.fullDomain}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {t(
                                                            "domainPickerNamespace",
                                                            {
                                                                namespace:
                                                                    option.domainNamespaceId
                                                            }
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </RadioGroup>
                            {hasMoreProvided && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        setProvidedDomainsShown(
                                            (prev) => prev + 3
                                        )
                                    }
                                    className="w-full"
                                >
                                    {t("domainPickerShowMore")}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}
            {selectedBaseDomain?.domainType === "wildcard" &&
                isWildcardSubdomain(subdomainInput) && (
                    <p className="text-sm text-muted-foreground">
                        {t("domainPickerWildcardCertWarning")}{" "}
                        <a
                            href="https://docs.pangolin.net/manage/resources/public/wildcard-resources#requirements-for-wildcard-resources"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                            {t("domainPickerWildcardCertWarningLink")}
                            <ExternalLink className="size-3.5 shrink-0" />
                        </a>
                        .
                    </p>
                )}
        </div>
    );
}

function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;

    return (...args: Parameters<T>) => {
        if (timeout) clearTimeout(timeout);

        timeout = setTimeout(() => {
            func(...args);
        }, wait);
    };
}
