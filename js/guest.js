import { state } from "./state.js";
import { log } from "./log.js";
import { decodeSignalCode, encodeSignalCode, validateSignalPayload } from "./signaling.js";
import { compactFromDescription, descriptionFromCompact } from "./sdp.js";
import {
    attemptIceRestart,
    createPeerConnection,
    logPeerConnectionDiagnostics,
    resetGuestConnection,
    shutdownGuest,
    shutdownHost,
    waitForIceComplete
} from "./webrtc.js";
import { els, setGuestStep, setSignalCodeDisplay, showNotice, showView, updateConnectionStatus } from "./ui.js";
import { renderTable } from "./render.js";
import { createMqttRelayChannel } from "./mqtt-relay.js";

export function startGuestSession(displayName) {
    shutdownHost();
    shutdownGuest();

    state.role = "guest";
    state.selectedVote = null;
    state.guestRemoteState = null;
    state.displayName = displayName;
    state.guestResponseApplied = false;
    state.roomId = null;

    showView("guestConnect");
    onRegenerateGuestOffer();
    log.info("guest", "Join room clicked", { name: displayName });
}

export async function onRegenerateGuestOffer() {
    try {
        state.role = "guest";
        state.guestResponseApplied = false;
        els.connectGuestBtn.disabled = false;
        setGuestStep(1);
        showNotice(els.guestConnectNotice, "Generating join code...", "info");
        state.guestJoinCodeRaw = "";
        els.copyGuestJoinCodeBtn.disabled = true;
        els.copyGuestJoinCodeFormattedBtn.disabled = true;
        setSignalCodeDisplay(
            els.guestJoinCode,
            els.guestJoinCodeMeta,
            els.guestJoinCodeQuality,
            "",
            "Generating code...",
            "Preparing connection details.",
            "Shareability: waiting for code"
        );
        await createGuestOfferCode();
        showNotice(els.guestConnectNotice, "Share this join code with the host. Then paste the response code.", "info");
    } catch (error) {
        log.error("error", "Failed to generate guest offer", { message: String(error.message || error) });
        showNotice(els.guestConnectNotice, "Could not generate join code: " + String(error.message || error), "error");
    }
}

export async function onGuestConnectWithResponseCode() {
    if (!state.guestPeer) {
        showNotice(els.guestConnectNotice, "Join code is not ready yet. Regenerate first.", "warn");
        return;
    }
    const code = (els.guestResponseCodeInput.value || "").trim();
    if (!code) {
        showNotice(els.guestConnectNotice, "Paste a host response code first.", "warn");
        return;
    }
    if (state.guestResponseApplied) {
        showNotice(els.guestConnectNotice, "Response already applied. Waiting for data channel; regenerate only if you need a fresh join code.", "warn");
        return;
    }

    try {
        setGuestStep(2);
        showNotice(els.guestConnectNotice, "Applying response code...", "info");

        const payload = await decodeSignalCode(code);
        validateSignalPayload(payload, "answer");
        const responseTarget = payload.r || payload.to;
        if (responseTarget && responseTarget !== state.localId) {
            throw new Error("This response code is for a different guest.");
        }
        state.roomId = payload.room || payload.f || null;

        const answerDescription = descriptionFromCompact(payload.d);
        await state.guestPeer.setRemoteDescription(answerDescription);
        state.guestResponseApplied = true;
        els.connectGuestBtn.disabled = true;
        showNotice(els.guestConnectNotice, "Response accepted. Waiting for data channel...", "info");
        log.info("guest", "Response applied", {
            answerSdpLength: (answerDescription.sdp || "").length
        });
    } catch (error) {
        log.error("error", "Failed to apply host response", { message: String(error.message || error) });
        showNotice(els.guestConnectNotice, "Could not apply response code: " + String(error.message || error), "error");
    }
}

export async function createGuestOfferCode() {
    resetGuestConnection();
    const pc = createPeerConnection();
    const dc = pc.createDataChannel("poker");

    state.guestPeer = pc;
    state.guestChannel = dc;
    setupGuestPeerHandlers(pc, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceComplete(pc);

    const payload = {
        v: 1,
        f: state.localId,
        n: state.displayName,
        d: compactFromDescription(pc.localDescription)
    };
    const code = await encodeSignalCode(payload);
    state.guestJoinCodeRaw = code;
    setSignalCodeDisplay(
        els.guestJoinCode,
        els.guestJoinCodeMeta,
        els.guestJoinCodeQuality,
        code,
        "Generating code..."
    );
    els.copyGuestJoinCodeBtn.disabled = false;
    els.copyGuestJoinCodeFormattedBtn.disabled = false;
    els.guestResponseCodeInput.value = "";
    els.connectGuestBtn.disabled = false;

    log.info("guest", "Offer created", {
        codeLength: code.length,
        iceGatheringState: pc.iceGatheringState
    });
}

export function setupGuestPeerHandlers(pc, dc) {
    let diagnosticsLogged = false;
    let restartTriggered = false;
    let relayFallbackTriggered = false;
    const logDiagnosticsOnce = (trigger, failureState) => {
        if (diagnosticsLogged) return;
        diagnosticsLogged = true;
        void logPeerConnectionDiagnostics(pc, "guest", { trigger, failureState });
    };

    dc.onopen = () => {
        onHostChannelOpen(dc);
        log.info("webrtc", "DataChannel opened", { role: "guest", label: dc.label });
    };
    dc.onclose = () => {
        onHostChannelClose(dc);
        log.warn("webrtc", "DataChannel closed", { role: "guest", label: dc.label });
    };
    dc.onerror = () => {
        showNotice(els.guestConnectNotice, "Data channel error.", "warn");
        log.warn("webrtc", "DataChannel error", { role: "guest" });
    };
    dc.onmessage = (event) => {
        onHostChannelMessage(event.data, dc);
    };

    pc.oniceconnectionstatechange = () => {
        log.info("webrtc", "Guest ICE state", { state: pc.iceConnectionState });
        if (pc.iceConnectionState === "failed") {
            logDiagnosticsOnce("iceconnectionstatechange", "failed");
        }
    };
    pc.onconnectionstatechange = () => {
        const status = pc.connectionState;
        if (status === "connected") {
            updateConnectionStatus(true, "Connected to host");
            return;
        }
        if (status === "failed" || status === "disconnected" || status === "closed") {
            updateConnectionStatus(false, "Disconnected");
        }
        if (status === "failed") {
            logDiagnosticsOnce("connectionstatechange", "failed");
            if (!restartTriggered) {
                restartTriggered = attemptIceRestart(pc, { role: "guest" });
                if (restartTriggered) {
                    showNotice(els.guestConnectNotice, "Direct path failed. Retrying ICE before relay fallback...", "warn");
                    return;
                }
            }
            if (!relayFallbackTriggered && state.roomId) {
                relayFallbackTriggered = true;
                startGuestRelayFallback();
            }
            showNotice(
                els.guestConnectNotice,
                "Connection failed on direct path. Trying relay fallback...",
                "error"
            );
            if (state.currentView === "table") {
                showNotice(
                    els.tableNotice,
                    "Connection failed. Could not establish a direct peer-to-peer path.",
                    "error"
                );
            }
            setGuestStep(2);
        }
        log.info("webrtc", "Guest connection state", { state: status });
    };
}

export function onHostChannelOpen(channel) {
    if (state.guestChannel !== channel) return;
    updateConnectionStatus(true, "Connected to host");
    setGuestStep(3);
    showNotice(els.guestConnectNotice, "Connected. Entering table...", "info");
    sendJson(channel, { t: "name", n: state.displayName });
    if (state.selectedVote != null) {
        sendJson(channel, { t: "vote", v: state.selectedVote });
    }
    showView("table");
    renderTable();
    showNotice(els.tableNotice, "Connected. Pick your card.", "info", 1400);
}

export function onHostChannelClose(channel) {
    if (state.guestChannel !== channel) return;
    updateConnectionStatus(false, "Disconnected");
    if (state.role === "guest") {
        showNotice(els.tableNotice, "Connection closed.", "warn");
    }
}

export function onHostChannelMessage(rawData, channel) {
    if (state.guestChannel !== channel) return;
    handleGuestInboundMessage(rawData);
}

function startGuestRelayFallback() {
    const roomId = state.roomId;
    if (!roomId) return;
    const relayChannel = createMqttRelayChannel("guest", roomId, state.localId, {
        onOpen: (channel) => {
            state.guestChannel = channel;
            onHostChannelOpen(channel);
            showNotice(els.guestConnectNotice, "Relay fallback connected.", "info");
        },
        onClose: () => {
            onHostChannelClose(relayChannel);
        },
        onMessage: (payload) => {
            onHostChannelMessage(payload, relayChannel);
        }
    });
    state.guestChannel = relayChannel;
}

export function handleGuestInboundMessage(rawData) {
    let message;
    try {
        message = JSON.parse(rawData);
    } catch (_error) {
        return;
    }
    if (!message || typeof message !== "object") return;
    log.info("game", "Message received", { role: "guest", type: message.t || "unknown" });

    if (message.t === "state") {
        state.guestRemoteState = {
            round: message.round || 1,
            started: !!message.started,
            revealed: !!message.revealed,
            players: Array.isArray(message.players) ? message.players : []
        };
        if (state.guestRemoteState.started && state.currentView !== "table") {
            showView("table");
        }
        renderTable();
        return;
    }

    if (message.t === "reveal" && state.guestRemoteState) {
        state.guestRemoteState.revealed = true;
        if (Array.isArray(message.players)) {
            const byId = {};
            for (const player of state.guestRemoteState.players) byId[player.id] = player;
            for (const revealPlayer of message.players) {
                if (byId[revealPlayer.id]) {
                    byId[revealPlayer.id].vote = revealPlayer.vote;
                    byId[revealPlayer.id].voted = revealPlayer.vote != null;
                }
            }
            state.guestRemoteState.players = Object.values(byId);
        }
        renderTable();
        return;
    }

    if (message.t === "reset") {
        state.selectedVote = null;
        if (state.guestRemoteState) {
            state.guestRemoteState.round = message.round || state.guestRemoteState.round + 1;
            state.guestRemoteState.revealed = false;
            state.guestRemoteState.players = state.guestRemoteState.players.map((player) => ({
                ...player,
                voted: false,
                vote: null
            }));
        }
        renderTable();
    }
}

export function sendJson(channel, message) {
    try {
        channel.send(JSON.stringify(message));
        log.info("game", "Message sent", { role: "guest", type: message.t || "unknown" });
    } catch (_error) {
        // Ignore stale channel sends.
    }
}
