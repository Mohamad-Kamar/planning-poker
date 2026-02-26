import { state } from "./state.js";
import { log } from "./log.js";
import { decodeSignalCode, encodeSignalCode, validateSignalPayload } from "./signaling.js";
import { compactFromDescription, descriptionFromCompact } from "./sdp.js";
import {
    attemptIceRestart,
    closePeerEntry,
    createPeerConnection,
    logPeerConnectionDiagnostics,
    shutdownGuest,
    shutdownHost,
    waitForIceComplete
} from "./webrtc.js";
import { els, setSignalCodeDisplay, showNotice, showView } from "./ui.js";
import { getHostPlayersAsArray, hostApplyVote, upsertHostPlayer } from "./game.js";
import { renderHostLobby, renderTable } from "./render.js";
import { createMqttRelayChannel } from "./mqtt-relay.js";

let sanitizeNameFn = (name) => String(name || "").trim();

export function configureHost(deps) {
    if (deps && typeof deps.sanitizeName === "function") {
        sanitizeNameFn = deps.sanitizeName;
    }
}

export function startHostSession(displayName) {
    shutdownGuest();
    shutdownHost();

    state.role = "host";
    state.selectedVote = null;
    state.hostResponseCodeRaw = "";
    state.roomId = state.localId;
    setSignalCodeDisplay(
        els.hostResponseCode,
        els.hostResponseCodeMeta,
        els.hostResponseCodeQuality,
        "",
        "No response code yet.",
        "Waiting for guest join code.",
        "Shareability: waiting for code"
    );
    state.session = {
        round: 1,
        started: false,
        revealed: false,
        players: {}
    };
    upsertHostPlayer(state.localId, displayName, true, sanitizeNameFn);
    renderHostLobby();
    showView("hostLobby");
    showNotice(els.hostLobbyNotice, "Room created. Ask a teammate to click Join Room and send you their join code.", "info");
    log.info("host", "Room created", { hostId: state.localId, name: displayName });
}

export function onHostStartGame() {
    if (!state.session) return;
    state.session.started = true;
    broadcastState();
    renderHostLobby();
    showView("table");
    renderTable();
    log.info("game", "Game started", { round: state.session.round });
}

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
        const guestName = sanitizeNameFn(payload.n || payload.name || "Guest");
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

export function onHostRevealVotes() {
    if (state.role !== "host" || !state.session) return;
    if (state.session.revealed) return;
    state.session.revealed = true;
    broadcastMessageToGuests({
        t: "reveal",
        round: state.session.round,
        players: getHostPlayersAsArray(true)
    });
    broadcastState();
    renderTable();
    log.info("game", "Reveal triggered", { round: state.session.round });
}

export function onHostNewRound() {
    if (state.role !== "host" || !state.session) return;
    state.session.round += 1;
    state.session.revealed = false;
    const playerIds = Object.keys(state.session.players);
    for (const id of playerIds) {
        state.session.players[id].vote = null;
    }
    state.selectedVote = null;
    broadcastMessageToGuests({ t: "reset", round: state.session.round });
    broadcastState();
    renderTable();
    log.info("game", "Round reset", { round: state.session.round });
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
    const logDiagnosticsOnce = (trigger, failureState) => {
        if (diagnosticsLogged) return;
        diagnosticsLogged = true;
        void logPeerConnectionDiagnostics(peerConnection, "host", { guestId, trigger, failureState });
    };

    state.hostPeers.set(guestId, peerEntry);
    upsertHostPlayer(guestId, guestName, false, sanitizeNameFn);

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
        if (status === "disconnected" || status === "failed" || status === "closed") {
            if (!peerEntry.dc || peerEntry.dc.transportType !== "mqtt-relay") {
                onPeerChannelClose(guestId);
            }
        }
        if (status === "failed") {
            logDiagnosticsOnce("connectionstatechange", "failed");
            if (!restartTriggered) {
                restartTriggered = attemptIceRestart(peerConnection, { role: "host", guestId });
                if (restartTriggered) {
                    showNotice(
                        els.hostLobbyNotice,
                        "Connection to " + peerEntry.name + " failed. Retrying ICE once before relay fallback...",
                        "warn"
                    );
                    return;
                }
            }
            if (!relayFallbackTriggered) {
                relayFallbackTriggered = true;
                startHostRelayFallback(guestId);
            }
            showNotice(
                els.hostLobbyNotice,
                "Connection to " + peerEntry.name + " failed on direct path. Trying relay fallback...",
                "warn"
            );
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
    log.info("host", "Answer created", {
        guestId,
        codeLength: responseCode.length,
        iceGatheringState: peerConnection.iceGatheringState
    });
}

export function setupHostDataChannel(guestId, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;

    channel.onopen = () => {
        onPeerChannelOpen(guestId, channel);
        log.info("webrtc", "DataChannel opened", { role: "host", guestId, label: channel.label });
    };
    channel.onclose = () => {
        onPeerChannelClose(guestId, channel);
        log.warn("webrtc", "DataChannel closed", { role: "host", guestId, label: channel.label });
    };
    channel.onerror = () => {
        showNotice(els.hostLobbyNotice, "A peer data channel encountered an error.", "warn");
        log.warn("webrtc", "DataChannel error", { role: "host", guestId });
    };
    channel.onmessage = (event) => {
        onPeerChannelMessage(guestId, event.data, channel);
    };
}

export function onPeerChannelOpen(guestId, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    if (channel && entry.dc !== channel) return;
    entry.connected = true;
    upsertHostPlayer(guestId, entry.name, true, sanitizeNameFn);
    broadcastState();
    renderHostLobby();
    renderTable();
}

export function onPeerChannelClose(guestId, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    if (channel && entry.dc !== channel) return;
    entry.connected = false;
    upsertHostPlayer(guestId, entry.name, false, sanitizeNameFn);
    broadcastState();
    renderHostLobby();
    renderTable();
}

export function onPeerChannelMessage(guestId, rawData, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    if (channel && entry.dc !== channel) return;
    handleHostInboundMessage(guestId, rawData);
}

function startHostRelayFallback(guestId) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;
    const roomId = state.roomId || state.localId;
    const relayChannel = createMqttRelayChannel("host", roomId, guestId, {
        onOpen: (channel) => {
            entry.dc = channel;
            onPeerChannelOpen(guestId, channel);
            showNotice(els.hostLobbyNotice, "Relay fallback connected for " + entry.name + ".", "info");
        },
        onClose: () => {
            onPeerChannelClose(guestId, relayChannel);
        },
        onMessage: (payload, fromGuestId) => {
            if (fromGuestId !== guestId) return;
            onPeerChannelMessage(guestId, payload, relayChannel);
        }
    });
    entry.dc = relayChannel;
}

export function handleHostInboundMessage(guestId, rawData) {
    if (!state.session) return;
    let message;
    try {
        message = JSON.parse(rawData);
    } catch (_error) {
        return;
    }
    if (!message || typeof message !== "object") return;

    log.info("game", "Message received", { from: guestId, type: message.t || "unknown" });

    if (message.t === "name") {
        const newName = sanitizeNameFn(message.n || "Guest");
        const peer = state.hostPeers.get(guestId);
        if (peer) peer.name = newName;
        upsertHostPlayer(guestId, newName, true, sanitizeNameFn);
        broadcastState();
        renderHostLobby();
        renderTable();
        return;
    }

    if (message.t === "vote") {
        const vote = message.v == null ? null : String(message.v);
        const deps = { broadcastState, renderTable, renderHostLobby };
        hostApplyVote(guestId, vote, deps);
    }
}

export function broadcastState() {
    if (!state.session || state.role !== "host") return;
    const payload = {
        t: "state",
        round: state.session.round,
        started: state.session.started,
        revealed: state.session.revealed,
        players: getHostPlayersAsArray(false).map((player) => {
            const hostPlayer = state.session.players[player.id];
            return {
                id: player.id,
                name: player.name,
                connected: player.connected,
                isHost: player.isHost,
                voted: hostPlayer.vote != null,
                vote: state.session.revealed ? hostPlayer.vote : null
            };
        })
    };
    broadcastMessageToGuests(payload);
    log.info("host", "State broadcast", { players: payload.players.length, round: payload.round });
}

export function broadcastMessageToGuests(message) {
    const peers = Array.from(state.hostPeers.values());
    const sentRelayKeys = new Set();
    for (const peer of peers) {
        if (peer.dc && peer.dc.readyState === "open") {
            if (peer.dc.transportType === "mqtt-relay") {
                const relayKey = peer.dc.relayKey || "mqtt-relay";
                if (sentRelayKeys.has(relayKey)) continue;
                sentRelayKeys.add(relayKey);
            }
            sendJson(peer.dc, message);
        }
    }
}

export function sendJson(channel, message) {
    try {
        channel.send(JSON.stringify(message));
        log.info("game", "Message sent", { type: message.t || "unknown" });
    } catch (_error) {
        // Ignore stale peer sends.
    }
}
