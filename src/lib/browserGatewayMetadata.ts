import { getBrowserTargetForRequest } from "@app/lib/getBrowserTargetForRequest";
import type { Metadata } from "next";

export async function generateBrowserGatewayMetadata(
    protocol: "SSH" | "RDP" | "VNC"
): Promise<Metadata> {
    const { target } = await getBrowserTargetForRequest();
    return {
        title: target?.name
            ? `${protocol} - ${target.name}`
            : `${protocol} - Pangolin`
    };
}
