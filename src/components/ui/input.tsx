import * as React from "react";

import { cn } from "@app/lib/cn";
import { EyeOff, Eye } from "lucide-react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        const [showPassword, setShowPassword] = React.useState(false);
        const togglePasswordVisibility = () => setShowPassword(!showPassword);

        return type === "password" ? (
            <div className="relative">
                <input
                    type={showPassword ? "text" : "password"}
                    data-slot="input"
                    className={cn(
                        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
                        "focus-visible:border-ring focus-visible:ring-ring/50",
                        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
                        className
                    )}
                    ref={ref}
                    {...props}
                />
                <div className="absolute inset-y-0 right-0 flex cursor-pointer items-center pr-3 text-gray-400">
                    {showPassword ? (
                        <EyeOff
                            className="h-4 w-4"
                            onClick={togglePasswordVisibility}
                        />
                    ) : (
                        <Eye
                            className="h-4 w-4"
                            onClick={togglePasswordVisibility}
                        />
                    )}
                </div>
            </div>
        ) : (
            <input
                type={type}
                data-slot="input"
                className={cn(
                    "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
                    "read-only:opacity-50",
                    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
                    "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-offset-0",
                    className
                )}
                ref={ref}
                {...props}
            />
        );
    }
);
Input.displayName = "Input";

export { Input };
