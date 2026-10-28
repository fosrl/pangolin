import { MessageHandler } from "@server/routers/ws";

export async function cleanUpOldSshSessionLogs(
    orgId: string,
    retentionDays: number
) {
    return;
}

export const handleSshSessionLogMessage: MessageHandler = async (context) => {
    return;
};
