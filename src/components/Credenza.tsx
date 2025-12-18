"use client";

import * as React from "react";

import { cn } from "@app/lib/cn";
import { useMediaQuery } from "@app/hooks/useMediaQuery";
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
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger
} from "@/components/ui/drawer";
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
        <CredenzaClose
            className={cn("mb-3 mt-3 md:mt-0 md:mb-0", className)}
            {...props}
        >
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
            className={cn("overflow-y-auto max-h-screen", className)}
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
    // const isDesktop = true;

    const CredenzaFooter = isDesktop ? DialogFooter : SheetFooter;

    return (
        <CredenzaFooter
            className={cn(
                "mt-8 md:mt-0 -mx-6 px-6 pt-4 border-t border-border",
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
    CredenzaTrigger,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaHeader,
    CredenzaTitle,
    CredenzaBody,
    CredenzaFooter
};
