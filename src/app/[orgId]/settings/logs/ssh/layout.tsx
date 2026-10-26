import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
    title: "SSH Session Logs"
};

export default function Layout({ children }: { children: ReactNode }) {
    return children;
}
