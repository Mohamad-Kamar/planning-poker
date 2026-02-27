import { onGuestConnectWithResponseCode, onRegenerateGuestOffer, startGuestSession } from "../guest.js";
import { startHostSession } from "../host-session.js";

export const manualWebRtcStrategy = {
    id: "manualWebRtc",
    startHost(displayName) {
        startHostSession(displayName);
    },
    startGuest(displayName) {
        startGuestSession(displayName);
    },
    connectGuestPrimary() {
        return onGuestConnectWithResponseCode();
    },
    regenerateGuest() {
        return onRegenerateGuestOffer();
    }
};

