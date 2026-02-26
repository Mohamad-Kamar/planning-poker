import { state } from "./state.js";
import { log } from "./log.js";
import { decodeSignalCode, encodeSignalCode, validateSignalPayload } from "./signaling.js";
import { compactFromDescription, descriptionFromCompact } from "./sdp.js";
import {
    attemptIceRestart,
    closePeerEntry,
    createPeerConnection,
    logPeerConnectionDiagnostics,
    waitForIceComplete
} from "./webrtc.js";
import { els, setSignalCodeDisplay, showNotice } from "./ui.js";
import { upsertHostPlayer } from "./game.js";
import { renderHostLobby } from "./render.js";
import { saveSessionSnapshot } from "./persistence.js";
import { RELAY_FALLBACK_DELAY_MS, sanitizeHostName } from "./host-shared.js";
import {
    channelTransportType,
    onPeerChannelClose,
    onPeerTemporarilyDisconnected,
    setupHostDataChannel,
    startHostRelayFallback
} from "./host-peers.js";

export async function onAcceptGuestCode() {
    if (!state.session || state.role !== "host") {
        showNotice(els.hostLobbyNotice, "Create a room first.", "warn");
        return;
    }

    const rawCode = (els.hostIncomingJoinCode.value || "").trim();
    if (!rawCode) {
        showNotice(els.hostLobbyNotice, "Paste a guest join code first.", "warn");
        return;
    }

    try {
        showNotice(els.hostLobbyNotice, "Accepting guest code...", "info");
        const payload = await decodeSignalCode(rawCode);
        validateSignalPayload(payload, "offer");

        const guestId = payload.f || payload.from;
        if (!guestId) {
            throw new Error("Join code is missing guest identity.");
        }
        const guestName = sanitizeHostName(payload.n || payload.name || "Guest");
        const offerDescription = descriptionFromCompact(payload.d);
        log.info("host", "Guest code accepted", {
            guestId,
            guestName,
            offerSdpLength: (offerDescription.sdp || "").length
        });

        await acceptGuestOffer(guestId, guestName, offerDescription);
        els.hostIncomingJoinCode.value = "";
    } catch (error) {
        log.error("error", "Failed to accept guest code", { message: String(error.message || error) });
        showNotice(els.hostLobbyNotice, "Could not accept guest code: " + String(error.message || error), "error");
    }
}

export async function acceptGuestOffer(guestId, guestName, offerDescription) {
    if (!state.session) return;

    const existing = state.hostPeers.get(guestId);
    if (existing) {
        closePeerEntry(existing);
        state.hostPeers.delete(guestId);
    }

    const peerConnection = createPeerConnection();
    const peerEntry = {
        id: guestId,
        name: guestName,
        pc: peerConnection,
        dc: null,
        connected: false
    };
    let diagnosticsLogged = false;
    let restartTriggered = false;
    let relayFallbackTriggered = false;
    let relayFallbackTimer = null;
    const logDiagnosticsOnce = (trigger, failureState) => {
        if (diagnosticsLogged) return;
        diagnosticsLogged = true;
        void logPeerConnectionDiagnostics(peerConnection, "host", { guestId, trigger, failureState });
    };
    const clearRelayFallbackTimer = () => {
        if (!relayFallbackTimer) return;
        clearTimeout(relayFallbackTimer);
        relayFallbackTimer = null;
    };
    const triggerRelayFallback = (reason) => {
        if (relayFallbackTriggered) return;
        relayFallbackTriggered = true;
        clearRelayFallbackTimer();
        startHostRelayFallback(guestId);
        showNotice(
            els.hostLobbyNotice,
            "Direct path failed for " + peerEntry.name + ". Trying relay fallback...",
            "warn"
        );
        log.warn("host", "Host relay fallback starting", { guestId, reason });
    };

    state.hostPeers.set(guestId, peerEntry);
    upsertHostPlayer(guestId, guestName, false, sanitizeHostName);

    peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        peerEntry.dc = channel;
        setupHostDataChannel(guestId, channel);
    };
    peerConnection.oniceconnectionstatechange = () => {
        log.info("webrtc", "Host ICE state", {
            guestId,
            state: peerConnection.iceConnectionState
        });
        if (peerConnection.iceConnectionState === "failed") {
            logDiagnosticsOnce("iceconnectionstatechange", "failed");
        }
    };
    peerConnection.onconnectionstatechange = () => {
        const status = peerConnection.connectionState;
        log.info("webrtc", "Host connection state", { guestId, state: status });
        if (status === "connected") {
            clearRelayFallbackTimer();
            return;
        }
        if (status === "disconnected") {
            onPeerTemporarilyDisconnected(guestId, channelTransportType(peerEntry.dc));
        }
        if (status === "closed") {
            if (!peerEntry.dc || peerEntry.dc.transportType !== "mqtt-relay") {
                onPeerChannelClose(guestId);
            }
        }
        if (status === "failed") {
            logDiagnosticsOnce("connectionstatechange", "failed");
            onPeerTemporarilyDisconnected(guestId, channelTransportType(peerEntry.dc));
            if (!restartTriggered) {
                restartTriggered = attemptIceRestart(peerConnection, { role: "host", guestId });
                if (restartTriggered) {
                    showNotice(
                        els.hostLobbyNotice,
                        "Connection to " + peerEntry.name + " failed on direct path. Starting relay fallback shortly...",
                        "warn"
                    );
                    relayFallbackTimer = setTimeout(() => {
                        triggerRelayFallback("post-ice-restart-delay");
                    }, RELAY_FALLBACK_DELAY_MS);
                } else {
                    triggerRelayFallback("ice-restart-unavailable");
                }
                return;
            }
            triggerRelayFallback("repeat-failed-state");
        }
    };

    await peerConnection.setRemoteDescription(offerDescription);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceComplete(peerConnection);

    const responsePayload = {
        v: 1,
        f: state.localId,
        r: guestId,
        room: state.roomId || state.localId,
        d: compactFromDescription(peerConnection.localDescription)
    };
    const responseCode = await encodeSignalCode(responsePayload);
    state.hostResponseCodeRaw = responseCode;
    setSignalCodeDisplay(
        els.hostResponseCode,
        els.hostResponseCodeMeta,
        els.hostResponseCodeQuality,
        responseCode,
        "No response code yet."
    );
    showNotice(els.hostLobbyNotice, "Accepted " + guestName + ". Copy response code and send it back.", "info");
    renderHostLobby();
    saveSessionSnapshot();
    log.info("host", "Answer created", {
        guestId,
        codeLength: responseCode.length,
        iceGatheringState: peerConnection.iceGatheringState
    });
}
