import {
    Popover,
    PopoverAnchor,
    PopoverContent,
    PopoverTrigger
} from "../ui/popover";
import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from "react";
import { TagInputStyleClassesProps, type Tag as TagType } from "./tag-input";
import { TagList, TagListProps } from "./tag-list";
import { Button } from "../ui/button";
import { cn } from "@app/lib/cn";
import { useTranslations } from "next-intl";

type TagPopoverProps = {
    children: React.ReactNode;
    tags: TagType[];
    customTagRenderer?: (tag: TagType, isActiveTag: boolean) => React.ReactNode;
    activeTagIndex?: number | null;
    setActiveTagIndex?: (index: number | null) => void;
    classStyleProps: {
        popoverClasses: TagInputStyleClassesProps["tagPopover"];
        tagListClasses: TagInputStyleClassesProps["tagList"];
        tagClasses: TagInputStyleClassesProps["tag"];
    };
    disabled?: boolean;
    usePortal?: boolean;
} & TagListProps;

export const TagPopover: React.FC<TagPopoverProps> = ({
    children,
    tags,
    customTagRenderer,
    activeTagIndex,
    setActiveTagIndex,
    classStyleProps,
    disabled,
    usePortal,
    ...tagProps
}) => {
    const triggerContainerRef = useRef<HTMLDivElement | null>(null);
    const popoverContentRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const [popoverWidth, setPopoverWidth] = useState<number>(0);
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [inputFocused, setInputFocused] = useState(false);

    const t = useTranslations();

    useLayoutEffect(() => {
        const handleResize = () => {
            if (triggerContainerRef.current) {
                setPopoverWidth(triggerContainerRef.current.offsetWidth);
            }
        };

        handleResize();

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Close the popover when clicking outside of it
    useEffect(() => {
        const handleOutsideClick = (
            event: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent
        ) => {
            if (
                isPopoverOpen &&
                triggerContainerRef.current &&
                popoverContentRef.current &&
                !triggerContainerRef.current.contains(event.target as Node) &&
                !popoverContentRef.current.contains(event.target as Node)
            ) {
                setIsPopoverOpen(false);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [isPopoverOpen]);

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (open && triggerContainerRef.current) {
                setPopoverWidth(triggerContainerRef.current.offsetWidth);
            }

            if (open) {
                inputRef.current?.focus();
                setIsPopoverOpen(open);
            }
        },
        [inputFocused]
    );

    const handleInputFocus = (
        event:
            | React.FocusEvent<HTMLInputElement>
            | React.FocusEvent<HTMLTextAreaElement>
    ) => {
        // Only set inputFocused to true if the popover is already open.
        // This will prevent the popover from opening due to an input focus if it was initially closed.
        if (isPopoverOpen) {
            setInputFocused(true);
        }

        const userOnFocus = (children as React.ReactElement<any>).props.onFocus;
        if (userOnFocus) userOnFocus(event);
    };

    const handleInputBlur = (
        event:
            | React.FocusEvent<HTMLInputElement>
            | React.FocusEvent<HTMLTextAreaElement>
    ) => {
        setInputFocused(false);

        // Allow the popover to close if no other interactions keep it open
        if (!isPopoverOpen) {
            setIsPopoverOpen(false);
        }

        const userOnBlur = (children as React.ReactElement<any>).props.onBlur;
        if (userOnBlur) userOnBlur(event);
    };

    return (
        <Popover
            open={isPopoverOpen}
            onOpenChange={handleOpenChange}
            modal={usePortal}
        >
            <PopoverAnchor asChild>
                <div
                    className="relative flex items-center rounded-md border border-input bg-transparent pr-3"
                    ref={triggerContainerRef}
                >
                    {React.cloneElement(children as React.ReactElement<any>, {
                        onFocus: handleInputFocus,
                        onBlur: handleInputBlur,
                        ref: inputRef
                    })}
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            role="combobox"
                            className={cn(
                                `hover:bg-transparent`,
                                classStyleProps?.popoverClasses?.popoverTrigger
                            )}
                            onClick={() => setIsPopoverOpen(!isPopoverOpen)}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`lucide lucide-chevron-down h-4 w-4 shrink-0 opacity-50 ${isPopoverOpen ? "rotate-180" : "rotate-0"}`}
                            >
                                <path d="m6 9 6 6 6-6"></path>
                            </svg>
                        </Button>
                    </PopoverTrigger>
                </div>
            </PopoverAnchor>
            <PopoverContent
                ref={popoverContentRef}
                align="start"
                side="bottom"
                className={cn(
                    `w-full space-y-3`,
                    classStyleProps?.popoverClasses?.popoverContent
                )}
                style={{
                    width: `${popoverWidth}px`
                }}
            >
                <div className="space-y-1">
                    <h4 className="text-sm font-medium leading-none">
                        {t("tagsEntered")}
                    </h4>
                    <p className="text-sm text-muted-foregrounsd text-left">
                        {t("tagsEnteredDescription")}
                    </p>
                </div>
                <TagList
                    tags={tags}
                    customTagRenderer={customTagRenderer}
                    activeTagIndex={activeTagIndex}
                    setActiveTagIndex={setActiveTagIndex}
                    classStyleProps={{
                        tagListClasses: classStyleProps?.tagListClasses,
                        tagClasses: classStyleProps?.tagClasses
                    }}
                    {...tagProps}
                    disabled={disabled}
                />
            </PopoverContent>
        </Popover>
    );
};
