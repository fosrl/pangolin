import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Create Block List"
};

export default function CreateDnsBlockListLayout({
    children
}: {
    children: React.ReactNode;
}) {
    return children;
}
