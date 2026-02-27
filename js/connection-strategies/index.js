import { state } from "../state.js";
import { manualWebRtcStrategy } from "./manual-webrtc.js";
import { mqttQuickJoinStrategy } from "./mqtt-quick-join.js";

const STRATEGIES = new Map([
    [mqttQuickJoinStrategy.id, mqttQuickJoinStrategy],
    [manualWebRtcStrategy.id, manualWebRtcStrategy]
]);

export function getStrategyById(id) {
    if (!STRATEGIES.has(id)) return mqttQuickJoinStrategy;
    return STRATEGIES.get(id);
}

export function getActiveStrategy() {
    return getStrategyById(state.connectionStrategy);
}

export function listStrategyIds() {
    return Array.from(STRATEGIES.keys());
}

