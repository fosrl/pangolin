import React from "react";
import { Body, Head, Html, Preview, Tailwind } from "@react-email/components";
import { themeColors } from "./lib/theme";
import {
    EmailContainer,
    EmailFooter,
    EmailGreeting,
    EmailHeading,
    EmailLetterHead,
    EmailSignature,
    EmailText
} from "./components/Email";

interface Props {
    email: string;
    orgName: string;
    trialEndsAt: string;
    daysRemaining: number | null;
    billingLink: string;
}

export const NotifyTrialExpiring = ({
    email,
    orgName,
    trialEndsAt,
    daysRemaining,
    billingLink
}: Props) => {
    const hasEnded = daysRemaining === null || daysRemaining === 0;
    const isLastDay = daysRemaining === 1;

    const previewText = hasEnded
        ? `Your cloud trial for ${orgName} has ended.`
        : isLastDay
          ? `Your cloud trial for ${orgName} ends tomorrow.`
          : `Your cloud trial for ${orgName} ends in ${daysRemaining} days.`;

    const heading = hasEnded
        ? "Your Cloud Trial Ended"
        : "Your Cloud Trial is Ending Soon";

    return (
        <Html>
            <Head />
            <Preview>{previewText}</Preview>
            <Tailwind config={themeColors}>
                <Body className="font-sans bg-gray-50">
                    <EmailContainer>
                        <EmailLetterHead />

                        <EmailHeading>{heading}</EmailHeading>

                        <EmailGreeting>Hi there,</EmailGreeting>

                        {hasEnded ? (
                            <>
                                <EmailText>
                                    Your cloud free trial for{" "}
                                    <strong>{orgName}</strong> ended on{" "}
                                    <strong>{trialEndsAt}</strong>. Your account
                                    has been moved to the free plan, which
                                    includes limited functionality.
                                </EmailText>

                                <EmailText>
                                    Some features and resources may now be
                                    restricted. To restore full access and
                                    continue using all the features you had
                                    during your trial, please upgrade to a paid
                                    plan. This does not effect any self hosted
                                    licenses.
                                </EmailText>

                                <EmailText>
                                    You can{" "}
                                    <a href={billingLink}>
                                        upgrade your plan here
                                    </a>{" "}
                                    to get back up and running right away.
                                </EmailText>
                            </>
                        ) : (
                            <>
                                <EmailText>
                                    Just a reminder that your free trial for{" "}
                                    <strong>{orgName}</strong> will end on{" "}
                                    <strong>{trialEndsAt}</strong>
                                    {isLastDay
                                        ? " - that's tomorrow!"
                                        : `, in ${daysRemaining} days`}
                                    .
                                </EmailText>

                                <EmailText>
                                    After your trial ends, your account will be
                                    moved to the free plan and some
                                    functionality may be restricted. This does
                                    not effect any self hosted licenses.
                                </EmailText>

                                <EmailText>
                                    To avoid any interruption to your service,
                                    we encourage you to upgrade before your
                                    trial expires. You can{" "}
                                    <a href={billingLink}>
                                        upgrade your plan here
                                    </a>
                                    .
                                </EmailText>
                            </>
                        )}

                        <EmailText>
                            If you have any questions or need assistance, please
                            don't hesitate to reach out to our support team.
                        </EmailText>

                        <EmailFooter>
                            <EmailSignature />
                        </EmailFooter>
                    </EmailContainer>
                </Body>
            </Tailwind>
        </Html>
    );
};

export default NotifyTrialExpiring;
