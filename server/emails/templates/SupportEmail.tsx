import React from "react";
import { Body, Head, Html, Preview, Tailwind } from "@react-email/components";
import { themeColors } from "./lib/theme";
import {
    EmailContainer,
    EmailGreeting,
    EmailLetterHead,
    EmailText
} from "./components/Email";

interface SupportEmailProps {
    email: string;
    username: string;
    subject: string;
    body: string;
}

export const SupportEmail = ({
    username,
    email,
    body,
    subject
}: SupportEmailProps) => {
    const previewText = subject;

    return (
        <Html>
            <Head />
            <Preview>{previewText}</Preview>
            <Tailwind config={themeColors}>
                <Body className="font-sans bg-gray-50">
                    <EmailContainer>
                        <EmailLetterHead />

                        <EmailGreeting>Hi support,</EmailGreeting>

                        <EmailText>
                            You have received a new support request from{" "}
                            <strong>{username}</strong> ({email}).
                        </EmailText>

                        <EmailText>
                            <strong>Subject:</strong> {subject}
                        </EmailText>

                        <EmailText>
                            <strong>Message:</strong> {body}
                        </EmailText>
                    </EmailContainer>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default SupportEmail;
