import ThemeSwitcher from "@app/components/ThemeSwitcher";
import AuthFooter from "@app/components/AuthFooter";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: {
        template: `%s - ${process.env.BRANDING_APP_NAME || "Pangolin"}`,
        default: `Auth - ${process.env.BRANDING_APP_NAME || "Pangolin"}`
    },
    description: ""
};

type AuthLayoutProps = {
    children: React.ReactNode;
};

export default async function AuthLayout({ children }: AuthLayoutProps) {
    return (
        <div className="h-full flex flex-col">
            <div className="hidden md:flex justify-end items-center p-3 space-x-2">
                <ThemeSwitcher />
            </div>

            <div className="flex-1 flex md:items-center justify-center">
                <div className="w-full max-w-md p-3">{children}</div>
            </div>

            <AuthFooter />
        </div>
    );
}
