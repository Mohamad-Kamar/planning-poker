import { state } from "./state.js";
import { log } from "./log.js";
import { shutdownGuest, shutdownHost } from "./webrtc.js";
import { els, setSignalCodeDisplay, showNotice, showView } from "./ui.js";
import { getHostPlayersAsArray, upsertHostPlayer } from "./game.js";
import { renderHostLobby, renderTable } from "./render.js";
import { saveSessionSnapshot } from "./persistence.js";
import { ROUND_TITLE_MAX_LENGTH, sanitizeHostName } from "./host-shared.js";
import { sendJson } from "./messaging.js";
import { EMPTY_HOST_RESPONSE_CODE_DISPLAY } from "./signal-display-presets.js";

export function startHostSession(displayName) {
    shutdownGuest();
    shutdownHost();

    state.role = "host";
    state.selectedVote = null;
    state.hostResponseCodeRaw = "";
    state.roomId = state.localId;
    state.hostPendingRejoinRequests = [];
    setSignalCodeDisplay(
        els.hostResponseCode,
        els.hostResponseCodeMeta,
        els.hostResponseCodeQuality,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.rawCode,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyText,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyMetaText,
        EMPTY_HOST_RESPONSE_CODE_DISPLAY.emptyQualityText
    );
    state.session = {
        round: 1,
        roundTitle: "",
        started: false,
        revealed: false,
        players: {}
    };
    upsertHostPlayer(state.localId, displayName, true, sanitizeHostName);
    renderHostLobby();
    showView("hostLobby");
    showNotice(els.hostLobbyNotice, "Room created. Ask a teammate to click Join Room and send you their join code.", "info");
    saveSessionSnapshot();
    log.info("host", "Room created", { hostId: state.localId, name: displayName });
}

export function onHostStartGame() {
    if (!state.session) return;
    state.session.started = true;
    broadcastState();
    renderHostLobby();
    showView("table");
    renderTable();
    saveSessionSnapshot();
    log.info("game", "Game started", { round: state.session.round });
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
    state.session.roundTitle = "";
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

export function onHostRoundTitleChange(title) {
    if (state.role !== "host" || !state.session) return;
    state.session.roundTitle = sanitizeRoundTitle(title);
    broadcastState();
    renderTable();
    log.info("game", "Round title updated", { round: state.session.round, hasTitle: !!state.session.roundTitle });
}

export function broadcastState() {
    if (!state.session || state.role !== "host") return;
    const payload = {
        t: "state",
        round: state.session.round,
        roundTitle: state.session.roundTitle || "",
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
    saveSessionSnapshot();
    log.info("host", "State broadcast", { players: payload.players.length, round: payload.round });
}

export function broadcastMessageToGuests(message) {
    const peers = Array.from(state.hostPeers.values());
    for (const peer of peers) {
        if (!peer.dc || peer.dc.readyState !== "open") continue;
        const outbound = message && Object.prototype.hasOwnProperty.call(message, "to")
            ? message
            : { ...message, to: peer.id };
        sendJson(peer.dc, outbound);
    }
}

function sanitizeRoundTitle(title) {
    // Keep one-space normalization but do not trim so host can type trailing spaces naturally.
    return String(title || "").replace(/\s+/g, " ").slice(0, ROUND_TITLE_MAX_LENGTH);
}
