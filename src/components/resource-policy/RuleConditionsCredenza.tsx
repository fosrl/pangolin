"use client";

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
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { toast } from "@app/hooks/useToast";
import {
    parseRuleConditions,
    serializeRuleConditions,
    type RuleCondition,
    type RuleConditionMatchType
} from "@server/lib/validators";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { RuleMethodSelect } from "./RuleMethodSelect";
import { validatePolicyRuleValue } from "./policy-access-rule-validation";

// The default a freshly added condition starts out with, per match type.
const DEFAULT_CONDITION_VALUES: Record<RuleConditionMatchType, string> = {
    PATH: "/",
    IP: "",
    CIDR: "",
    METHOD: "GET",
    COUNTRY: "US",
    COUNTRY_IS_NOT: "US",
    REGION: "021",
    ASN: "AS15169"
};

type RuleConditionsCredenzaProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    value: string;
    onChange: (value: string) => void;
    isMaxmindAvailable: boolean;
    isMaxmindAsnAvailable: boolean;
    includeRegionMatch: boolean;
};

export function RuleConditionsCredenza({
    open,
    setOpen,
    value,
    onChange,
    isMaxmindAvailable,
    isMaxmindAsnAvailable,
    includeRegionMatch
}: RuleConditionsCredenzaProps) {
    const t = useTranslations();
    const [conditions, setConditions] = useState<RuleCondition[]>([]);

    // reset the draft to the saved conditions every time the dialog opens, so
    // closing it without saving discards the edits
    useEffect(() => {
        if (open) {
            setConditions(parseRuleConditions(value) ?? []);
        }
    }, [open, value]);

    function updateCondition(index: number, update: Partial<RuleCondition>) {
        setConditions((current) =>
            current.map((condition, i) =>
                i === index ? { ...condition, ...update } : condition
            )
        );
    }

    function save() {
        if (conditions.length < 2) {
            toast({
                variant: "destructive",
                title: t("rulesErrorConditionsRequired"),
                description: t("rulesErrorConditionsRequiredDescription")
            });
            return;
        }

        for (const condition of conditions) {
            const result = validatePolicyRuleValue(
                t,
                condition.match,
                condition.value
            );
            if (!result.success) {
                toast({ variant: "destructive", ...result.toast });
                return;
            }
        }

        onChange(serializeRuleConditions(conditions));
        setOpen(false);
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("rulesConditionsTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("rulesConditionsDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <div className="space-y-2">
                        {conditions.map((condition, index) => (
                            <div
                                key={index}
                                className="flex items-center gap-2"
                            >
                                <Select
                                    value={condition.match}
                                    onValueChange={(
                                        match: RuleConditionMatchType
                                    ) =>
                                        updateCondition(index, {
                                            match,
                                            value: DEFAULT_CONDITION_VALUES[
                                                match
                                            ]
                                        })
                                    }
                                >
                                    <SelectTrigger className="w-36 shrink-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PATH">
                                            {t("path")}
                                        </SelectItem>
                                        <SelectItem value="METHOD">
                                            {t("method")}
                                        </SelectItem>
                                        <SelectItem value="IP">IP</SelectItem>
                                        <SelectItem value="CIDR">
                                            {t("ipAddressRange")}
                                        </SelectItem>
                                        {isMaxmindAvailable && (
                                            <>
                                                <SelectItem value="COUNTRY">
                                                    {t("country")}
                                                </SelectItem>
                                                <SelectItem value="COUNTRY_IS_NOT">
                                                    {t("countryIsNot")}
                                                </SelectItem>
                                            </>
                                        )}
                                        {includeRegionMatch &&
                                            isMaxmindAvailable && (
                                                <SelectItem value="REGION">
                                                    {t("region")}
                                                </SelectItem>
                                            )}
                                        {isMaxmindAsnAvailable && (
                                            <SelectItem value="ASN">
                                                ASN
                                            </SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>

                                {condition.match === "METHOD" ? (
                                    <RuleMethodSelect
                                        value={condition.value}
                                        disabled={false}
                                        placeholder={t("rulesSelectMethods")}
                                        onChange={(methods) =>
                                            updateCondition(index, {
                                                value: methods
                                            })
                                        }
                                    />
                                ) : (
                                    <Input
                                        value={condition.value}
                                        onChange={(e) =>
                                            updateCondition(index, {
                                                value: e.target.value
                                            })
                                        }
                                    />
                                )}

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0"
                                    aria-label={t("rulesConditionRemove")}
                                    onClick={() =>
                                        setConditions((current) =>
                                            current.filter(
                                                (_, i) => i !== index
                                            )
                                        )
                                    }
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}

                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() =>
                                setConditions((current) => [
                                    ...current,
                                    {
                                        match: "PATH",
                                        value: DEFAULT_CONDITION_VALUES.PATH
                                    }
                                ])
                            }
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            {t("rulesConditionAdd")}
                        </Button>
                    </div>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("cancel")}</Button>
                    </CredenzaClose>
                    <Button onClick={save}>{t("save")}</Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
