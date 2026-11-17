import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Block List"
};

export default function DnsBlockListLayout({
    children
}: {
    children: React.ReactNode;
}) {
    return children;
}
