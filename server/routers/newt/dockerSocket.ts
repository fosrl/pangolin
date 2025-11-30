import { sendToClient } from "#dynamic/routers/ws";

export function fetchContainers(newtId: string) {
    const payload = {
        type: `newt/socket/fetch`,
        data: {}
    };
    sendToClient(newtId, payload);
}

export function dockerSocket(newtId: string) {
    const payload = {
        type: `newt/socket/check`,
        data: {}
    };
    sendToClient(newtId, payload);
}
