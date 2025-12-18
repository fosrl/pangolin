"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
    Building2,
    Check,
    CheckCircle2,
    ChevronsUpDown,
    Zap
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toUnicode } from "punycode";
import { useCallback, useEffect, useMemo, useState } from "react";

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
        } | null
    ) => void;
    cols?: number;
    hideFreeDomain?: boolean;
    defaultFullDomain?: string | null;
    defaultSubdomain?: string | null;
    defaultDomainId?: string | null;
}

export default function DomainPicker({
    orgId,
    onDomainChange,
    cols = 2,
    hideFreeDomain = false,
    defaultSubdomain,
    defaultFullDomain,
    defaultDomainId
}: DomainPickerProps) {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const t = useTranslations();

    const { data = [], isLoading: loadingDomains } = useQuery(
        orgQueries.domains({ orgId })
    );

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

    useEffect(() => {
        if (!loadingDomains) {
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

                    onDomainChange?.({
                        domainId: firstOrExistingDomain.domainId,
                        type: "organization",
                        subdomain:
                            firstOrExistingDomain.type !== "cname"
                                ? defaultSubdomain || undefined
                                : undefined,
                        fullDomain: firstOrExistingDomain.baseDomain,
                        baseDomain: firstOrExistingDomain.baseDomain
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
        const sanitized = finalizeSubdomainSanitize(sub);

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
            domainType: base.domainType
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
        const raw = sanitizeInputRaw(value);
        setSubdomainInput(raw);
        setSelectedProvidedDomain(null);

        if (selectedBaseDomain?.type === "organization") {
            const fullDomain = raw
                ? `${raw}.${selectedBaseDomain.domain}`
                : selectedBaseDomain.domain;

            onDomainChange?.({
                domainId: selectedBaseDomain.domainId!,
                type: "organization",
                subdomain: raw || undefined,
                fullDomain,
                baseDomain: selectedBaseDomain.domain
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

        console.log({
            setSelectedBaseDomain: option
        });
        setSelectedBaseDomain(option);
        setOpen(false);

        if (option.domainType === "cname") {
            sub = "";
            setSubdomainInput("");
        }

        const fullDomain = sub ? `${sub}.${option.domain}` : option.domain;

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
                baseDomain: option.domain
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
                  domainType: selectedBaseDomain.domainType
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
    console.log({
        displayedProvidedOptions
    });

    const selectedDomainNamespaceId =
        selectedProvidedDomain?.domainNamespaceId ??
        displayedProvidedOptions.find(
            (opt) => opt.fullDomain === defaultFullDomain
        )?.domainNamespaceId;
    const hasMoreProvided =
        sortedAvailableOptions.length > providedDomainsShown;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="subdomain-input">
                        {t("domainPickerSubdomainLabel")}
                    </Label>
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
                                  ? ""
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
                        !isValidSubdomainStructure(subdomainInput) && (
                            <p className="text-sm text-red-500">
                                {t("domainPickerInvalidSubdomainStructure")}
                            </p>
                        )}
                </div>

                <div className="space-y-2">
                    <Label>{t("domainPickerBaseDomainLabel")}</Label>
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={open}
                                className="w-full justify-between"
                            >
                                {selectedBaseDomain ? (
                                    <div className="flex items-center gap-x-2 min-w-0 flex-1">
                                        {selectedBaseDomain.type ===
                                        "organization" ? null : (
                                            <Zap className="h-4 w-4 shrink-0" />
                                        )}
                                        <span className="truncate">
                                            {selectedBaseDomain.domain}
                                        </span>
                                        {selectedBaseDomain.verified && (
                                            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                                        )}
                                    </div>
                                ) : (
                                    t("domainPickerSelectBaseDomain")
                                )}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0" align="start">
                            <Command className="rounded-lg">
                                <CommandInput
                                    placeholder={t("domainPickerSearchDomains")}
                                    className="border-0 focus:ring-0"
                                />
                                <CommandEmpty className="py-6 text-center">
                                    <div className="text-muted-foreground text-sm">
                                        {t("domainPickerNoDomainsFound")}
                                    </div>
                                </CommandEmpty>

                                {organizationDomains.length > 0 && (
                                    <>
                                        <CommandGroup
                                            heading={t(
                                                "domainPickerOrganizationDomains"
                                            )}
                                            className="py-2"
                                        >
                                            <CommandList>
                                                {organizationDomains.map(
                                                    (orgDomain) => (
                                                        <CommandItem
                                                            key={`org-${orgDomain.domainId}`}
                                                            onSelect={() =>
                                                                handleBaseDomainSelect(
                                                                    {
                                                                        id: `org-${orgDomain.domainId}`,
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
                                                            className="mx-2 rounded-md"
                                                            disabled={
                                                                !orgDomain.verified
                                                            }
                                                        >
                                                            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted mr-3">
                                                                <Building2 className="h-4 w-4 text-muted-foreground" />
                                                            </div>
                                                            <div className="flex flex-col flex-1 min-w-0">
                                                                <span className="font-medium truncate">
                                                                    {
                                                                        orgDomain.baseDomain
                                                                    }
                                                                </span>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {orgDomain.type.toUpperCase()}{" "}
                                                                    •{" "}
                                                                    {orgDomain.verified
                                                                        ? t(
                                                                              "domainPickerVerified"
                                                                          )
                                                                        : t(
                                                                              "domainPickerUnverified"
                                                                          )}
                                                                </span>
                                                            </div>
                                                            <Check
                                                                className={cn(
                                                                    "h-4 w-4 text-primary",
                                                                    selectedBaseDomain?.id ===
                                                                        `org-${orgDomain.domainId}`
                                                                        ? "opacity-100"
                                                                        : "opacity-0"
                                                                )}
                                                            />
                                                        </CommandItem>
                                                    )
                                                )}
                                            </CommandList>
                                        </CommandGroup>
                                        {(build === "saas" ||
                                            build === "enterprise") &&
                                            !hideFreeDomain && (
                                                <CommandSeparator className="my-2" />
                                            )}
                                    </>
                                )}

                                {(build === "saas" || build === "enterprise") &&
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
                                            className="py-2"
                                        >
                                            <CommandList>
                                                <CommandItem
                                                    key="provided-search"
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
                                                    className="mx-2 rounded-md"
                                                >
                                                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 mr-3">
                                                        <Zap className="h-4 w-4 text-primary" />
                                                    </div>
                                                    <div className="flex flex-col flex-1 min-w-0">
                                                        <span className="font-medium truncate">
                                                            {build ===
                                                            "enterprise"
                                                                ? t(
                                                                      "domainPickerProvidedDomain"
                                                                  )
                                                                : t(
                                                                      "domainPickerFreeProvidedDomain"
                                                                  )}
                                                        </span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {t(
                                                                "domainPickerSearchForAvailableDomains"
                                                            )}
                                                        </span>
                                                    </div>
                                                    <Check
                                                        className={cn(
                                                            "h-4 w-4 text-primary",
                                                            selectedBaseDomain?.id ===
                                                                "provided-search"
                                                                ? "opacity-100"
                                                                : "opacity-0"
                                                        )}
                                                    />
                                                </CommandItem>
                                            </CommandList>
                                        </CommandGroup>
                                    )}
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

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
