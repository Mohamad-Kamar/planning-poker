import { log } from "./log.js";

export function sendJson(channel, message) {
    try {
        channel.send(JSON.stringify(message));
        log.info("game", "Message sent", { type: message.t || "unknown" });
    } catch (_error) {
        // Ignore stale peer sends.
    }
}
