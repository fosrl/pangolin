import React from "react";
import { Container, Img } from "@react-email/components";
import { build } from "@server/build";

// EmailContainer: Wraps the entire email layout
export function EmailContainer({ children }: { children: React.ReactNode }) {
    return (
        <Container className="bg-white border border-solid border-gray-200 max-w-lg mx-auto my-8 rounded-lg overflow-hidden shadow-sm">
            {children}
        </Container>
    );
}

// EmailLetterHead: For branding with logo on dark background
export function EmailLetterHead() {
    return (
        <div className="px-6 pt-8 pb-2 text-center">
            <Img
                src="https://fossorial-public-assets.s3.us-east-1.amazonaws.com/word_mark_black.png"
                alt="Pangolin Logo"
                width="120"
                height="auto"
                className="mx-auto"
            />
        </div>
    );
}

// EmailHeading: For the primary message or headline
export function EmailHeading({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-6 pt-4 pb-1">
            <h1 className="text-2xl font-semibold text-gray-900 text-center leading-tight">
                {children}
            </h1>
        </div>
    );
}

export function EmailGreeting({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-6">
            <p className="text-base text-gray-700 leading-relaxed">
                {children}
            </p>
        </div>
    );
}

// EmailText: For general text content
export function EmailText({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className="px-6">
            <p
                className={`text-base text-gray-700 leading-relaxed ${className}`}
            >
                {children}
            </p>
        </div>
    );
}

// EmailSection: For visually distinct sections (like OTP)
export function EmailSection({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`px-6 py-6 text-center ${className}`}>{children}</div>
    );
}

// EmailFooter: For closing or signature
export function EmailFooter({ children }: { children: React.ReactNode }) {
    return (
        <>
            {build === "saas" && (
                <div className="px-6 py-6 border-t border-gray-100 bg-gray-50">
                    {children}
                    <p className="text-xs text-gray-400 mt-4">
                        For any questions or support, please contact us at:
                        <br />
                        support@pangolin.net
                    </p>
                    <p className="text-xs text-gray-300 text-center mt-4">
                        &copy; {new Date().getFullYear()} Fossorial, Inc. All
                        rights reserved.
                    </p>
                </div>
            )}
        </>
    );
}

export function EmailSignature() {
    return (
        <div className="text-sm text-gray-600">
            <p className="mb-2">
                Best regards,
                <br />
                <strong>The Pangolin Team</strong>
            </p>
        </div>
    );
}

// EmailInfoSection: For structured key-value info (like resource details)
export function EmailInfoSection({
    title,
    items
}: {
    title?: string;
    items: { label: string; value: React.ReactNode }[];
}) {
    return (
        <div className="px-6 py-4">
            {title && (
                <div className="mb-2 font-semibold text-gray-900 text-base">
                    {title}
                </div>
            )}
            <table className="w-full text-sm text-left">
                <tbody>
                    {items.map((item, idx) => (
                        <tr key={idx}>
                            <td className="pr-4 py-1 text-gray-600 align-top whitespace-nowrap">
                                {item.label}
                            </td>
                            <td className="py-1 text-gray-900 break-all">
                                {item.value}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
