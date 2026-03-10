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
                "overflow-y-auto max-h-[100dvh] md:max-h-[calc(100vh-clamp(3rem,24vh,400px))] md:top-[clamp(1.5rem,12vh,200px)] md:translate-y-0",
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
        <CredenzaHeader className={cn("-mx-6 px-6", className)} {...props}>
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
    // return (
    //     <div className={cn("px-4 md:px-0 mb-4", className)} {...props}>
    //         {children}
    //     </div>
    // );

    return (
        <div
            className={cn(
                "px-0 mb-4 space-y-4 overflow-x-hidden min-w-0",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
};

const CredenzaFooter = ({ className, children, ...props }: CredenzaProps) => {
    const isDesktop = useMediaQuery(desktop);

    const CredenzaFooter = isDesktop ? DialogFooter : SheetFooter;

    return (
        <CredenzaFooter
            className={cn(
                "mt-8 md:mt-0 -mx-6 md:-mb-4 px-6 py-4 border-t border-border gap-2 md:gap-0",
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
