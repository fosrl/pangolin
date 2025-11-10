import { headers } from 'next/headers';
import { db } from '@server/db';
import { resources } from '@server/db';
import { eq } from 'drizzle-orm';

export const dynamic = "force-dynamic";

export default async function MaintenanceScreen() {
    let resource = null;
    let title = 'Service Temporarily Unavailable';
    let message = 'We are currently experiencing technical difficulties. Please check back soon.';
    let estimatedTime;

    try {
        const headersList = await headers();
        const host = headersList.get('host') || '';
        const hostname = host.split(':')[0];

        const [res] = await db
            .select()
            .from(resources)
            .where(eq(resources.fullDomain, hostname))
            .limit(1);

        resource = res;
        title = resource?.maintenanceTitle || title;
        message = resource?.maintenanceMessage || message;
        estimatedTime = resource?.maintenanceEstimatedTime;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("Skipping DB lookup during build or missing config:", msg);
    }
    
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="max-w-2xl w-full bg-white/10 backdrop-blur-lg rounded-3xl p-8 shadow-2xl border border-white/20">
                <div className="text-center">
                    <div className="text-6xl mb-6 animate-pulse">
                        🔧
                    </div>

                    <h1 className="text-4xl font-bold text-black mb-4">
                        {title}
                    </h1>

                    <p className="text-xl text-black/90 mb-6">
                        {message}
                    </p>

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
