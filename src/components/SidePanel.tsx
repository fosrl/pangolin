"use client";

import * as React from "react";

import { useMediaQuery } from "@app/hooks/useMediaQuery";
import { cn } from "@app/lib/cn";
import {
    Sheet,
    SheetClose,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetOverlay,
    SheetPortal,
    SheetTitle,
    SheetTrigger
} from "./ui/sheet";
import * as SheetPrimitive from "@radix-ui/react-dialog";

type BaseProps = {
    children: React.ReactNode;
};

type RootSidePanelProps = BaseProps & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

type SidePanelProps = {
    className?: string;
    asChild?: true;
    children?: React.ReactNode;
};

const desktop = "(min-width: 768px)";

const SidePanel = ({ children, ...props }: RootSidePanelProps) => {
    return <Sheet {...props}>{children}</Sheet>;
};

const SidePanelTrigger = ({
    className,
    children,
    ...props
}: SidePanelProps) => {
    return (
        <SheetTrigger className={className} {...props}>
            {children}
        </SheetTrigger>
    );
};

const SidePanelClose = ({ className, children, ...props }: SidePanelProps) => {
    return (
        <SheetClose className={className} {...props}>
            {children}
        </SheetClose>
    );
};

const SidePanelContent = ({
    className,
    children,
    ...props
}: SidePanelProps) => {
    const isDesktop = useMediaQuery(desktop);

    return (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Content
                className={cn(
                    "fixed z-50 flex min-h-0 flex-col gap-4 overflow-hidden border bg-card px-6 pt-6 pb-1 shadow-lg transition ease-in-out",
                    "data-[state=open]:animate-in data-[state=closed]:animate-out",
                    "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
                    "data-[state=closed]:duration-200 data-[state=open]:duration-300",
                    isDesktop
                        ? "inset-y-0 right-0 h-full w-2/5 border-l"
                        : "inset-x-0 bottom-0 max-h-[85dvh] w-full border-t",
                    className
                )}
                {...props}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                {children}
            </SheetPrimitive.Content>
        </SheetPortal>
    );
};

const SidePanelDescription = ({
    className,
    children,
    ...props
}: SidePanelProps) => {
    return (
        <SheetDescription className={className} {...props}>
            {children}
        </SheetDescription>
    );
};

const SidePanelHeader = ({ className, children, ...props }: SidePanelProps) => {
    return (
        <SheetHeader
            className={cn("shrink-0 -mx-6 px-6", className)}
            {...props}
        >
            {children}
        </SheetHeader>
    );
};

const SidePanelTitle = ({ className, children, ...props }: SidePanelProps) => {
    return (
        <SheetTitle className={className} {...props}>
            {children}
        </SheetTitle>
    );
};

const SidePanelBody = ({ className, children, ...props }: SidePanelProps) => {
    return (
        <div
            className={cn(
                "relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-0",
                className
            )}
            {...props}
        >
            <div className="space-y-4">{children}</div>
            <div
                className="sticky bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-card to-transparent"
                aria-hidden
            />
        </div>
    );
};

const SidePanelFooter = ({ className, children, ...props }: SidePanelProps) => {
    return (
        <SheetFooter
            className={cn(
                "-mt-4 shrink-0 border-t border-border py-4 -mx-6 gap-2 px-6 bg-card",
                className
            )}
            {...props}
        >
            {children}
        </SheetFooter>
    );
};

export {
    SidePanel,
    SidePanelBody,
    SidePanelClose,
    SidePanelContent,
    SidePanelDescription,
    SidePanelFooter,
    SidePanelHeader,
    SidePanelTitle,
    SidePanelTrigger
};
