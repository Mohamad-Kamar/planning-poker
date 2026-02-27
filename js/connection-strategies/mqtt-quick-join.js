import { connectGuestByRoomCode, startGuestQuickJoin } from "../guest.js";
import { startHostRecoveryRelayListener } from "../host-peers.js";
import { startHostSession } from "../host-session.js";
import { els } from "../ui.js";

function readRoomCodeAndPin() {
    return {
        roomCode: String(els.guestRoomCodeInput ? els.guestRoomCodeInput.value : "").trim(),
        pin: String(els.guestRoomPinInput ? els.guestRoomPinInput.value : "").trim()
    };
}

export const mqttQuickJoinStrategy = {
    id: "mqttQuickJoin",
    startHost(displayName) {
        startHostSession(displayName);
        startHostRecoveryRelayListener();
    },
    startGuest(displayName) {
        startGuestQuickJoin(displayName);
    },
    connectGuestPrimary() {
        const { roomCode, pin } = readRoomCodeAndPin();
        return connectGuestByRoomCode(roomCode, pin);
    },
    regenerateGuest() {
        // MQTT quick join has nothing to regenerate.
    }
};

