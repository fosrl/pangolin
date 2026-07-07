"use client";

import React from "react";
import confetti from "canvas-confetti";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";

export default function SupporterMessage({ tier }: { tier: string }) {
    const t = useTranslations();

    return (
        <></>
        // <div className="relative flex items-center space-x-2 whitespace-nowrap group">
        //     <span
        //         className="cursor-pointer"
        //         onClick={(e) => {
        //             // Get the bounding box of the element
        //             const rect = (
        //                 e.target as HTMLElement
        //             ).getBoundingClientRect();

        //             // Trigger confetti centered on the word "Pangolin"
        //             confetti({
        //                 particleCount: 100,
        //                 spread: 70,
        //                 origin: {
        //                     x: (rect.left + rect.width / 2) / window.innerWidth,
        //                     y: rect.top / window.innerHeight
        //                 },
        //                 colors: ["#FFA500", "#FF4500", "#FFD700"]
        //             });
        //         }}
        //     >
        //         Pangolin
        //     </span>
        //     <Star className="w-3 h-3" />
        //     <div className="absolute left-1/2 transform -translate-x-1/2 -top-10 hidden group-hover:block  text-primary text-sm rounded-md border shadow-md px-4 py-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        //         {t("componentsSupporterMessage", { tier: tier })}
        //     </div>
        // </div>
    );
}
