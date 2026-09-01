"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { LoaderIcon, SearchIcon } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle
} from "@/components/ui/sheet";
import { useMediaQuery } from "@app/hooks/useMediaQuery";
import { cn } from "@app/lib/cn";

const desktop = "(min-width: 768px)";

const commandSurfaceClassName =
    "transition duration-150 mt-0 [&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5";

function Command({
    className,
    ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
    return (
        <CommandPrimitive
            data-slot="command"
            className={cn(
                "bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md",
                className
            )}
            {...props}
        />
    );
}

function CommandDialog({
    title = "Command Palette",
    description = "Search for a command to run...",
    children,
    className,
    showCloseButton = true,
    commandProps,
    ...props
}: React.ComponentProps<typeof Dialog> & {
    title?: string;
    description?: string;
    className?: string;
    showCloseButton?: boolean;
    commandProps?: React.ComponentProps<typeof Command>;
}) {
    const isDesktop = useMediaQuery(desktop);

    const command = (
        <Command {...commandProps} className={commandSurfaceClassName}>
            {children}
        </Command>
    );

    if (!isDesktop) {
        return (
            <Sheet open={props.open} onOpenChange={props.onOpenChange}>
                <SheetContent
                    side="top"
                    className={cn(
                        "flex max-h-[85dvh] w-full flex-col gap-0 overflow-hidden rounded-none border-x-0 p-0 pt-[env(safe-area-inset-top,0px)]",
                        className
                    )}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                >
                    <SheetHeader className="sr-only">
                        <SheetTitle>{title}</SheetTitle>
                        <SheetDescription>{description}</SheetDescription>
                    </SheetHeader>
                    {command}
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Dialog {...props}>
            <DialogHeader className="sr-only">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <DialogContent
                className={cn(
                    "overflow-hidden p-0 place-items-start md:top-[clamp(1.5rem,12vh,200px)] md:max-h-[calc(100dvh-clamp(1.5rem,12vh,200px)-1.5rem)] md:translate-y-0",
                    className
                )}
            >
                {command}
            </DialogContent>
        </Dialog>
    );
}

function CommandInput({
    className,
    isLoading,
    trailing,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
    isLoading?: boolean;
    trailing?: React.ReactNode;
}) {
    return (
        <div
            data-slot="command-input-wrapper"
            className="flex h-9 items-center gap-2 border-b px-3"
        >
            {isLoading ? (
                <LoaderIcon className="animate-spin size-4 shrink-0 opacity-50" />
            ) : (
                <SearchIcon className="size-4 shrink-0 opacity-50" />
            )}
            <CommandPrimitive.Input
                data-slot="command-input"
                className={cn(
                    "placeholder:text-muted-foreground flex h-10 min-w-0 flex-1 rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                {...props}
            />
            {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </div>
    );
}

function CommandList({
    className,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
    return (
        <CommandPrimitive.List
            data-slot="command-list"
            className={cn(
                "max-h-[300px] scroll-py-1 overflow-x-clip overflow-y-auto",
                className
            )}
            {...props}
        />
    );
}

function CommandEmpty({
    className,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
    return (
        <CommandPrimitive.Empty
            data-slot="command-empty"
            className={cn("py-6 text-center text-sm", className)}
            {...props}
        />
    );
}

function CommandGroup({
    className,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
    return (
        <CommandPrimitive.Group
            data-slot="command-group"
            className={cn(
                "text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-y-auto p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
                className
            )}
            {...props}
        />
    );
}

function CommandSeparator({
    className,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
    return (
        <CommandPrimitive.Separator
            data-slot="command-separator"
            className={cn("bg-border -mx-1 h-px", className)}
            {...props}
        />
    );
}

function CommandItem({
    className,
    ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
    return (
        <CommandPrimitive.Item
            data-slot="command-item"
            className={cn(
                "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className
            )}
            {...props}
        />
    );
}

function CommandShortcut({
    className,
    ...props
}: React.ComponentProps<"span">) {
    return (
        <kbd
            data-slot="command-shortcut"
            className={cn(
                "text-muted-foreground ml-auto text-xs tracking-widest",
                "px-1 py-0.5 rounded-sm border-border bg-muted border",
                className
            )}
            {...props}
        />
    );
}

export {
    Command,
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
    CommandSeparator
};
