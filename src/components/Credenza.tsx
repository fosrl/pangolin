"use client";

import * as React from "react";

import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { DrawerClose } from "@/components/ui/drawer";
import { useMediaQuery } from "@app/hooks/useMediaQuery";
import { cn } from "@app/lib/cn";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger
} from "./ui/sheet";

interface BaseProps {
    children: React.ReactNode;
}

interface RootCredenzaProps extends BaseProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

interface CredenzaProps extends BaseProps {
    className?: string;
    asChild?: true;
}

const desktop = "(min-width: 768px)";

const Credenza = ({ children, ...props }: RootCredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);
    // const isDesktop = true;
    const Credenza = isDesktop ? Dialog : Sheet;

    return <Credenza {...props}>{children}</Credenza>;
};

const CredenzaTrigger = ({ className, children, ...props }: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);
    // const isDesktop = true;

    const CredenzaTrigger = isDesktop ? DialogTrigger : SheetTrigger;

    return (
        <CredenzaTrigger className={className} {...props}>
            {children}
        </CredenzaTrigger>
    );
};

const CredenzaClose = ({ className, children, ...props }: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);
    // const isDesktop = true;

    const CredenzaClose = isDesktop ? DialogClose : DrawerClose;

    return (
        <CredenzaClose className={cn("", className)} {...props}>
            {children}
        </CredenzaClose>
    );
};

const CredenzaContent = ({ className, children, ...props }: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);
    // const isDesktop = true;

    const CredenzaContent = isDesktop ? DialogContent : SheetContent;

    return (
        <CredenzaContent
            className={cn(
                "flex min-h-0 max-h-[100dvh] flex-col overflow-y-auto md:top-[clamp(1.5rem,12vh,200px)] md:max-h-[calc(100dvh-clamp(1.5rem,12vh,200px)-1.5rem)] md:translate-y-0 md:overflow-hidden",
                className
            )}
            {...props}
            side={"bottom"}
            onOpenAutoFocus={(e) => e.preventDefault()}
        >
            {children}
        </CredenzaContent>
    );
};

const CredenzaDescription = ({
    className,
    children,
    ...props
}: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);
    // const isDesktop = true;

    const CredenzaDescription = isDesktop
        ? DialogDescription
        : SheetDescription;

    return (
        <CredenzaDescription className={className} {...props}>
            {children}
        </CredenzaDescription>
    );
};

const CredenzaHeader = ({ className, children, ...props }: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);
    // const isDesktop = true;

    const CredenzaHeader = isDesktop ? DialogHeader : SheetHeader;

    return (
        <CredenzaHeader
            className={cn("shrink-0 -mx-6 px-6", className)}
            {...props}
        >
            {children}
        </CredenzaHeader>
    );
};

const CredenzaTitle = ({ className, children, ...props }: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);
    // const isDesktop = true;

    const CredenzaTitle = isDesktop ? DialogTitle : SheetTitle;

    return (
        <CredenzaTitle className={className} {...props}>
            {children}
        </CredenzaTitle>
    );
};

const CredenzaBody = ({ className, children, ...props }: CredenzaProps) => {
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

const CredenzaFooter = ({ className, children, ...props }: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);

    const CredenzaFooter = isDesktop ? DialogFooter : SheetFooter;

    return (
        <CredenzaFooter
            className={cn(
                "-mt-4 shrink-0 border-t border-border py-4 -mx-6 gap-2 px-6 bg-card md:-mb-4 md:gap-0",
                className
            )}
            {...props}
        >
            {children}
        </CredenzaFooter>
    );
};

export {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle,
    CredenzaTrigger
};
