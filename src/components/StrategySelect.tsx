"use client";

import { cn } from "@app/lib/cn";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { useState, ReactNode } from "react";

export interface StrategyOption<TValue extends string> {
    id: TValue;
    title: string;
    description: string | ReactNode;
    disabled?: boolean;
    icon?: ReactNode;
}

interface StrategySelectProps<TValue extends string> {
    options: ReadonlyArray<StrategyOption<TValue>>;
    value?: TValue | null;
    defaultValue?: TValue;
    onChange?: (value: TValue) => void;
    cols?: number;
}

export function StrategySelect<TValue extends string>({
    options,
    value: controlledValue,
    defaultValue,
    onChange,
    cols = 1
}: StrategySelectProps<TValue>) {
    const [uncontrolledSelected, setUncontrolledSelected] = useState<
        TValue | undefined
    >(defaultValue);
    const isControlled = controlledValue !== undefined;
    const selected = isControlled
        ? (controlledValue ?? undefined)
        : uncontrolledSelected;

    return (
        <RadioGroup
            value={selected ?? ""}
            onValueChange={(value: string) => {
                const typedValue = value as TValue;
                if (!isControlled) setUncontrolledSelected(typedValue);
                onChange?.(typedValue);
            }}
            style={{
                // @ts-expect-error
                "--cols": `repeat(${cols}, 1fr)`
            }}
            className="grid md:grid-cols-(--cols) gap-4"
        >
            {options.map((option: StrategyOption<TValue>) => (
                <label
                    key={option.id}
                    htmlFor={option.id}
                    data-state={
                        selected === option.id ? "checked" : "unchecked"
                    }
                    className={cn(
                        "relative flex rounded-lg border p-4 transition-colors cursor-pointer",
                        option.disabled
                            ? "border-input text-muted-foreground cursor-not-allowed opacity-50"
                            : selected === option.id
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-input hover:bg-accent"
                    )}
                >
                    <RadioGroupItem
                        value={option.id}
                        id={option.id}
                        disabled={option.disabled}
                        className="absolute left-4 top-5 h-4 w-4 border-primary text-primary"
                    />
                    <div className="flex gap-3 pl-7">
                        {option.icon && (
                            <div className="mt-1">{option.icon}</div>
                        )}
                        <div className="flex-1">
                            <div className="font-medium">{option.title}</div>
                            <div className="text-sm text-muted-foreground">
                                {typeof option.description === "string"
                                    ? option.description
                                    : option.description}
                            </div>
                        </div>
                    </div>
                </label>
            ))}
        </RadioGroup>
    );
}
