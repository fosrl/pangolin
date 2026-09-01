import {
    handleNewtRegisterMessage,
    handleReceiveBandwidthMessage,
    handleNewtGetConfigMessage,
    handleDockerStatusMessage,
    handleDockerContainersMessage,
    handleNewtExitNodesRequestMessage,
    handleApplyBlueprintMessage,
    handleNewtPingMessage,
    handleNewtDisconnectingMessage,
    handleRequestLogMessage
} from "../newt";
import {
    handleOlmRegisterMessage,
    handleOlmRelayMessage,
    handleOlmPingMessage,
    handleOlmServerPeerAddMessage,
    handleOlmUnRelayMessage,
    handleOlmDisconnectingMessage,
    handleOlmServerInitAddPeerHandshake,
    handleOlmLocalMessage,
    handleOlmUnLocalMessage,
    handleOlmExitNodesRequestMessage
} from "../olm";
import { handleHealthcheckStatusMessage } from "../target";
import { handleRoundTripMessage } from "./handleRoundTripMessage";
import { MessageHandler } from "./types";

export const messageHandlers: Record<string, MessageHandler> = {
    "olm/wg/server/peer/add": handleOlmServerPeerAddMessage,
    "olm/wg/server/peer/init": handleOlmServerInitAddPeerHandshake,
    "olm/wg/register": handleOlmRegisterMessage,
    "olm/wg/relay": handleOlmRelayMessage,
    "olm/wg/unrelay": handleOlmUnRelayMessage,
    "olm/wg/local": handleOlmLocalMessage,
    "olm/wg/unlocal": handleOlmUnLocalMessage,
    "olm/ping": handleOlmPingMessage,
    "olm/ping/request": handleOlmExitNodesRequestMessage,
    "olm/disconnecting": handleOlmDisconnectingMessage,
    "newt/disconnecting": handleNewtDisconnectingMessage,
    "newt/ping": handleNewtPingMessage,
    "newt/wg/register": handleNewtRegisterMessage,
    "newt/wg/get-config": handleNewtGetConfigMessage,
    "newt/receive-bandwidth": handleReceiveBandwidthMessage,
    "newt/socket/status": handleDockerStatusMessage,
    "newt/socket/containers": handleDockerContainersMessage,
    "newt/ping/request": handleNewtExitNodesRequestMessage,
    "newt/blueprint/apply": handleApplyBlueprintMessage,
    "newt/healthcheck/status": handleHealthcheckStatusMessage,
    "newt/request-log": handleRequestLogMessage,
    "ws/round-trip/complete": handleRoundTripMessage
};
