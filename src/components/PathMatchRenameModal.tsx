import { Settings } from "lucide-react";
import {
    DescribedSelect,
    type DescribedSelectOption
} from "@app/components/DescribedSelect";

import { Badge } from "@app/components/ui/badge";
import { Label } from "@app/components/ui/label";
import { useEffect, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
    Credenza,
    CredenzaBody,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle,
    CredenzaTrigger
} from "./Credenza";
import { useTranslations } from "next-intl";

type PathMatchType = "prefix" | "exact" | "regex";
type RewritePathType = "prefix" | "exact" | "regex" | "stripPrefix";

const pathMatchTypes: PathMatchType[] = ["prefix", "exact", "regex"];

function isPathMatchType(
    value: string | null | undefined
): value is PathMatchType {
    return pathMatchTypes.includes(value as PathMatchType);
}

const rewritePathTypes: RewritePathType[] = [
    "prefix",
    "exact",
    "regex",
    "stripPrefix"
];

function isRewritePathType(
    value: string | null | undefined
): value is RewritePathType {
    return rewritePathTypes.includes(value as RewritePathType);
}

export function PathMatchModal({
    value,
    onChange,
    trigger
}: {
    value: { path: string | null; pathMatchType: string | null };
    onChange: (config: {
        path: string | null;
        pathMatchType: string | null;
    }) => void;
    trigger: React.ReactNode;
}) {
    const t = useTranslations();

    const [open, setOpen] = useState(false);
    const [matchType, setMatchType] = useState<PathMatchType>(
        isPathMatchType(value?.pathMatchType) ? value.pathMatchType : "prefix"
    );
    const [path, setPath] = useState(value?.path || "");

    const matchOptions: DescribedSelectOption<PathMatchType>[] = [
        {
            value: "prefix",
            title: t("pathMatchPrefix"),
            description: t("pathMatchPrefixHelp")
        },
        {
            value: "exact",
            title: t("pathMatchExact"),
            description: t("pathMatchExactHelp")
        },
        {
            value: "regex",
            title: t("pathMatchRegex"),
            description: t("pathMatchRegexHelp")
        }
    ];

    useEffect(() => {
        if (open) {
            setMatchType(
                isPathMatchType(value?.pathMatchType)
                    ? value.pathMatchType
                    : "prefix"
            );
            setPath(value?.path || "");
        }
    }, [open, value]);

    const handleSave = () => {
        onChange({ pathMatchType: matchType, path: path.trim() });
        setOpen(false);
    };

    const handleClear = () => {
        onChange({ pathMatchType: null, path: null });
        setOpen(false);
    };

    const getPlaceholder = () =>
        matchType === "regex"
            ? t("pathMatchRegexPlaceholder")
            : t("pathMatchDefaultPlaceholder");

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaTrigger asChild>{trigger}</CredenzaTrigger>
            <CredenzaContent className="sm:max-w-[500px]">
                <CredenzaHeader>
                    <CredenzaTitle>{t("pathMatchModalTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("pathMatchModalDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody className="grid gap-4 space-y-0">
                    <div className="grid gap-2">
                        <Label>{t("pathMatchType")}</Label>
                        <DescribedSelect<PathMatchType>
                            options={matchOptions}
                            value={matchType}
                            onChange={setMatchType}
                            searchPlaceholder={t("search")}
                            emptyMessage={t("noResults")}
                        />
                        <p className="text-sm text-muted-foreground">
                            {
                                matchOptions.find(
                                    (option) => option.value === matchType
                                )?.description
                            }
                        </p>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="path-value">
                            {t("pathMatchValue")}
                        </Label>
                        <Input
                            id="path-value"
                            placeholder={getPlaceholder()}
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                        />
                    </div>
                </CredenzaBody>
                <CredenzaFooter className="gap-2">
                    {/* {value?.path && (
                        )} */}
                    <Button variant="outline" onClick={handleClear}>
                        {t("clear")}
                    </Button>
                    <Button onClick={handleSave} disabled={!path.trim()}>
                        {t("saveChanges")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}

export function PathRewriteModal({
    value,
    onChange,
    trigger,
    disabled
}: {
    value: { rewritePath: string | null; rewritePathType: string | null };
    onChange: (config: {
        rewritePath: string | null;
        rewritePathType: string | null;
    }) => void;
    trigger: React.ReactNode;
    disabled?: boolean;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const [rewriteType, setRewriteType] = useState<RewritePathType>(
        isRewritePathType(value?.rewritePathType)
            ? value.rewritePathType
            : "prefix"
    );
    const [rewritePath, setRewritePath] = useState(value?.rewritePath || "");

    const rewriteOptions: DescribedSelectOption<RewritePathType>[] = [
        {
            value: "prefix",
            title: t("pathRewritePrefix"),
            description: t("pathRewritePrefixHelp")
        },
        {
            value: "exact",
            title: t("pathRewriteExact"),
            description: t("pathRewriteExactHelp")
        },
        {
            value: "regex",
            title: t("pathRewriteRegex"),
            description: t("pathRewriteRegexHelp")
        },
        {
            value: "stripPrefix",
            title: t("pathRewriteStripPrefix"),
            description: t("pathRewriteStripPrefixHelp")
        }
    ];

    useEffect(() => {
        if (open) {
            setRewriteType(
                isRewritePathType(value?.rewritePathType)
                    ? value.rewritePathType
                    : "prefix"
            );
            setRewritePath(value?.rewritePath || "");
        }
    }, [open, value]);

    const handleSave = () => {
        onChange({
            rewritePathType: rewriteType,
            rewritePath: rewritePath.trim()
        });
        setOpen(false);
    };

    const handleClear = () => {
        onChange({ rewritePathType: null, rewritePath: null });
        setOpen(false);
    };

    const getPlaceholder = () => {
        switch (rewriteType) {
            case "regex":
                return t("pathRewriteRegexPlaceholder");
            case "stripPrefix":
                return "";
            default:
                return t("pathRewriteDefaultPlaceholder");
        }
    };

    return (
        <Credenza open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
            <CredenzaTrigger asChild>{trigger}</CredenzaTrigger>
            <CredenzaContent className="sm:max-w-[500px]">
                <CredenzaHeader>
                    <CredenzaTitle>{t("pathRewriteModalTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("pathRewriteModalDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody className="grid gap-4 space-y-0">
                    <div className="grid gap-2">
                        <Label>{t("pathRewriteType")}</Label>
                        <DescribedSelect<RewritePathType>
                            options={rewriteOptions}
                            value={rewriteType}
                            onChange={setRewriteType}
                            searchPlaceholder={t("search")}
                            emptyMessage={t("noResults")}
                        />
                        <p className="text-sm text-muted-foreground">
                            {
                                rewriteOptions.find(
                                    (option) => option.value === rewriteType
                                )?.description
                            }
                        </p>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="rewrite-value">
                            {t("pathRewriteValue")}
                        </Label>
                        <Input
                            id="rewrite-value"
                            placeholder={getPlaceholder()}
                            value={rewritePath}
                            onChange={(e) => setRewritePath(e.target.value)}
                        />
                    </div>
                </CredenzaBody>
                <CredenzaFooter className="gap-2">
                    {value?.rewritePath && (
                        <Button variant="outline" onClick={handleClear}>
                            {t("clear")}
                        </Button>
                    )}
                    <Button
                        onClick={handleSave}
                        disabled={
                            rewriteType !== "stripPrefix" && !rewritePath.trim()
                        }
                    >
                        {t("saveChanges")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}

export function PathMatchDisplay({
    value
}: {
    value: { path: string | null; pathMatchType: string | null };
}) {
    const t = useTranslations();

    if (!value?.path) return null;

    const getTypeLabel = (type: string | null) => {
        const labels: Record<string, string> = {
            prefix: t("pathMatchPrefix"),
            exact: t("pathMatchExact"),
            regex: t("pathMatchRegex")
        };
        return labels[type || ""] || type;
    };

    return (
        <div className="flex items-center gap-2 w-full text-left">
            <Badge variant="secondary" className="text-xs shrink-0">
                {getTypeLabel(value.pathMatchType)}
            </Badge>
            <code className="text-sm flex-1 truncate" title={value.path}>
                {value.path}
            </code>
            <Settings className="h-4 w-4" />
        </div>
    );
}

export function PathRewriteDisplay({
    value
}: {
    value: { rewritePath: string | null; rewritePathType: string | null };
}) {
    const t = useTranslations();

    if (!value?.rewritePath && value?.rewritePathType !== "stripPrefix")
        return null;

    const getTypeLabel = (type: string | null) => {
        const labels: Record<string, string> = {
            prefix: t("pathRewritePrefix"),
            exact: t("pathRewriteExact"),
            regex: t("pathRewriteRegex"),
            stripPrefix: t("pathRewriteStrip")
        };
        return labels[type || ""] || type;
    };

    return (
        <div className="flex items-center gap-2 w-full text-left">
            <Badge variant="secondary" className="text-xs shrink-0">
                {getTypeLabel(value.rewritePathType)}
            </Badge>
            <code
                className="text-sm flex-1 truncate"
                title={value.rewritePath || ""}
            >
                {value.rewritePath || (
                    <span className="text-muted-foreground italic">
                        ({t("pathRewriteStripLabel")})
                    </span>
                )}
            </code>
            <Settings className="h-4 w-4" />
        </div>
    );
}
