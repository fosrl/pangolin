
import { headers } from "next/headers";
import { priv } from "@app/lib/api";
import { GetMaintenanceInfoResponse } from "@server/routers/resource";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MaintenanceScreen() {
    let title = "Service Temporarily Unavailable";
    let message =
        "We are currently experiencing technical difficulties. Please check back soon.";
    let estimatedTime: string | null = null;

    // Check if we're in build mode
    const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build';

    if (!isBuildTime) {
        try {
            const headersList = await headers();
            const host = headersList.get("host") || "";
            const hostname = host.split(":")[0];

            const res = await priv.get<GetMaintenanceInfoResponse>(
                `/maintenance/info?fullDomain=${encodeURIComponent(hostname)}`
            );


            if (res && res.status === 200) {
                const maintenanceInfo = res.data;
                title = maintenanceInfo?.maintenanceTitle || title;
                message = maintenanceInfo?.maintenanceMessage || message;
                estimatedTime = maintenanceInfo?.maintenanceEstimatedTime || null;
            }
        } catch (err) {
            console.warn(
                "Failed to fetch maintenance info",
                err instanceof Error ? err.message : String(err)
            );
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="max-w-2xl w-full bg-white/10 backdrop-blur-lg rounded-3xl p-8 shadow-2xl border border-white/20">
                <div className="text-center">
                    <div className="text-6xl mb-6 animate-pulse">🔧</div>

                    <h1 className="text-4xl font-bold text-black mb-4">
                        {title}
                    </h1>

                    <p className="text-xl text-black/90 mb-6">{message}</p>

                    {estimatedTime && (
                        <div className="mt-8 p-4 bg-white/15 rounded-xl">
                            <p className="text-black font-semibold">
                                Estimated completion:
                            </p>
                            <p className="text-black/90 mt-2">
                                {estimatedTime}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}