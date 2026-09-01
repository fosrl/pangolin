import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Create AI Provider"
};

export default function CreateAiProviderLayout({
    children
}: {
    children: React.ReactNode;
}) {
    return children;
}
