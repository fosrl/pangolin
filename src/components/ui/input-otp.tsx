"use client";

import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { MinusIcon } from "lucide-react";
import { cn } from "@app/lib/cn";

// input-otp dispatches synthetic `input` events on its hidden input 0/10/50ms
// after every focus or value change, including right after it loses focus.
// When the user clicks a password manager's inline menu (e.g. Bitwarden's
// "Fill verification code"), focus moves into the menu's iframe, and those
// stray events make the manager think the field was typed into, so it drops
// the click and never fills. Swallow untrusted `input` events on an unfocused
// OTP input; real fills focus the field first, so they still get through.
function blockBlurredSyntheticOtpInput(e: Event) {
    const target = e.target;
    if (
        !e.isTrusted &&
        target instanceof HTMLInputElement &&
        target.hasAttribute("data-input-otp") &&
        document.activeElement !== target
    ) {
        e.stopImmediatePropagation();
    }
}

let otpInputGuardCount = 0;

function useBlurredSyntheticOtpInputGuard() {
    React.useEffect(() => {
        if (otpInputGuardCount++ === 0) {
            window.addEventListener(
                "input",
                blockBlurredSyntheticOtpInput,
                true
            );
        }
        return () => {
            if (--otpInputGuardCount === 0) {
                window.removeEventListener(
                    "input",
                    blockBlurredSyntheticOtpInput,
                    true
                );
            }
        };
    }, []);
}

function InputOTP({
    className,
    containerClassName,
    obscured = false,
    ...props
}: React.ComponentProps<typeof OTPInput> & {
    containerClassName?: string;
    obscured?: boolean;
}) {
    useBlurredSyntheticOtpInputGuard();

    return (
        <OTPInput
            data-slot="input-otp"
            containerClassName={cn(
                "flex items-center gap-2 has-disabled:opacity-50",
                containerClassName
            )}
            className={cn("disabled:cursor-not-allowed", className)}
            {...props}
        />
    );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="input-otp-group"
            className={cn("flex items-center", className)}
            {...props}
        />
    );
}

function InputOTPSlot({
    index,
    className,
    obscured = false,
    ...props
}: React.ComponentProps<"div"> & {
    index: number;
    obscured?: boolean;
}) {
    const inputOTPContext = React.useContext(OTPInputContext);
    const { char, hasFakeCaret, isActive } =
        inputOTPContext?.slots[index] ?? {};

    return (
        <div
            data-slot="input-otp-slot"
            data-active={isActive}
            className={cn(
                "data-[active=true]:border-ring data-[active=true]:ring-ring/50 data-[active=true]:aria-invalid:ring-destructive/20 dark:data-[active=true]:aria-invalid:ring-destructive/40 aria-invalid:border-destructive data-[active=true]:aria-invalid:border-destructive border-input relative flex h-9 w-9 items-center justify-center border-y border-r text-sm transition-all outline-none first:rounded-l-md first:border-l last:rounded-r-md data-[active=true]:z-10",
                className
            )}
            {...props}
        >
            {char && obscured ? "•" : char}
            {hasFakeCaret && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="animate-caret-blink bg-foreground h-4 w-px duration-1000" />
                </div>
            )}
        </div>
    );
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
    return (
        <div data-slot="input-otp-separator" role="separator" {...props}>
            <MinusIcon />
        </div>
    );
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
