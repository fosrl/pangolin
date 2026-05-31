import { build } from "@server/build";
import {
    handleNewtRegisterMessage,
    handleReceiveBandwidthMessage,
    handleNewtGetConfigMessage,
    handleDockerStatusMessage,
    handleDockerContainersMessage,
    handleNewtPingRequestMessage,
    handleApplyBlueprintMessage,
    handleNewtPingMessage,
    startNewtOfflineChecker,
    handleNewtDisconnectingMessage
} from "../newt";
import { startPingAccumulator } from "../newt/pingAccumulator";
import {
    handleOlmRegisterMessage,
    handleOlmRelayMessage,
    handleOlmPingMessage,
    startOlmOfflineChecker,
    handleOlmServerPeerAddMessage,
    handleOlmUnRelayMessage,
    handleOlmDisconnectingMessage,
    handleOlmServerInitAddPeerHandshake
} from "../olm";
import { handleHealthcheckStatusMessage } from "../target";
import { startLocalHealthChecker } from "../target/localHealthChecker";
import { handleRoundTripMessage } from "./handleRoundTripMessage";
import { MessageHandler } from "./types";

export const messageHandlers: Record<string, MessageHandler> = {
    "olm/wg/server/peer/add": handleOlmServerPeerAddMessage,
    "olm/wg/server/peer/init": handleOlmServerInitAddPeerHandshake,
    "olm/wg/register": handleOlmRegisterMessage,
    "olm/wg/relay": handleOlmRelayMessage,
    "olm/wg/unrelay": handleOlmUnRelayMessage,
    "olm/ping": handleOlmPingMessage,
    "olm/disconnecting": handleOlmDisconnectingMessage,
    "newt/disconnecting": handleNewtDisconnectingMessage,
    "newt/ping": handleNewtPingMessage,
    "newt/wg/register": handleNewtRegisterMessage,
    "newt/wg/get-config": handleNewtGetConfigMessage,
    "newt/receive-bandwidth": handleReceiveBandwidthMessage,
    "newt/socket/status": handleDockerStatusMessage,
    "newt/socket/containers": handleDockerContainersMessage,
    "newt/ping/request": handleNewtPingRequestMessage,
    "newt/blueprint/apply": handleApplyBlueprintMessage,
    "newt/healthcheck/status": handleHealthcheckStatusMessage,
    "ws/round-trip/complete": handleRoundTripMessage
};

// Start the ping accumulator for all builds - it batches per-site online/lastPing
// updates into periodic bulk writes, preventing connection pool exhaustion.
startPingAccumulator();

if (build != "saas") {
    startOlmOfflineChecker(); // this is to handle the offline check for olms
    startNewtOfflineChecker(); // this is to handle the offline check for newts
}

// Local sites have no Newt agent to run probes for them, so the server
// itself polls their healthchecks. Safe to run in every build because it
// no-ops when there are no enabled local healthchecks.
startLocalHealthChecker();
