import { VOTE_VALUES, state } from "./state.js";
import { sanitizeText } from "./sanitize.js";

const SESSION_STORAGE_KEY = "planningPoker.session";
const SNAPSHOT_VERSION = 1;
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 40;
const MAX_ROUND_TITLE_LENGTH = 80;

function getSessionStorage() {
    try {
        return window.sessionStorage;
    } catch (_error) {
        return null;
    }
}

function normalizeId(value) {
    const id = String(value || "").trim();
    if (!id || id.length > 64) return "";
    return id;
}

function normalizeName(value, fallback = "") {
    return sanitizeText(value, MAX_NAME_LENGTH, fallback);
}

function normalizeRoundTitle(value) {
    return sanitizeText(value, MAX_ROUND_TITLE_LENGTH);
}

function normalizeVote(value) {
    if (value == null) return null;
    const vote = String(value);
    return VOTE_VALUES.includes(vote) ? vote : null;
}

function normalizeRoleView(role, view) {
    if (role === "host") {
        return view === "table" ? "table" : "hostLobby";
    }
    return view === "table" ? "table" : "guestConnect";
}

function normalizeHostPlayers(playersRaw, localId, displayName) {
    const players = {};
    if (playersRaw && typeof playersRaw === "object" && !Array.isArray(playersRaw)) {
        for (const [entryId, entry] of Object.entries(playersRaw)) {
            if (!entry || typeof entry !== "object") continue;
            const id = normalizeId(entry.id || entryId);
            if (!id) continue;
            players[id] = {
                id,
                name: normalizeName(entry.name, id === localId ? displayName : "Guest"),
                connected: id === localId,
                vote: normalizeVote(entry.vote),
                isHost: id === localId
            };
        }
    }

    const hostPlayer = players[localId] || {
        id: localId,
        vote: null
    };
    hostPlayer.id = localId;
    hostPlayer.name = normalizeName(hostPlayer.name, displayName || "Host");
    hostPlayer.connected = true;
    hostPlayer.isHost = true;
    hostPlayer.vote = normalizeVote(hostPlayer.vote);
    players[localId] = hostPlayer;

    return players;
}

function normalizeHostSession(sessionRaw, localId, displayName) {
    if (!sessionRaw || typeof sessionRaw !== "object" || Array.isArray(sessionRaw)) return null;
    const roundRaw = Number(sessionRaw.round);
    const round = Number.isFinite(roundRaw) && roundRaw > 0 ? Math.floor(roundRaw) : 1;

    return {
        round,
        roundTitle: normalizeRoundTitle(sessionRaw.roundTitle),
        started: !!sessionRaw.started,
        revealed: !!sessionRaw.revealed,
        players: normalizeHostPlayers(sessionRaw.players, localId, displayName)
    };
}

function normalizeGuestPlayers(playersRaw) {
    if (!Array.isArray(playersRaw)) return [];
    const normalized = [];
    for (const entry of playersRaw) {
        if (!entry || typeof entry !== "object") continue;
        const id = normalizeId(entry.id);
        if (!id) continue;
        const vote = normalizeVote(entry.vote);
        const voted = vote != null ? true : !!entry.voted;
        normalized.push({
            id,
            name: normalizeName(entry.name, "Guest"),
            connected: !!entry.connected,
            isHost: !!entry.isHost,
            voted,
            vote
        });
    }
    return normalized;
}

function normalizeGuestRemoteState(remoteStateRaw) {
    if (!remoteStateRaw || typeof remoteStateRaw !== "object" || Array.isArray(remoteStateRaw)) {
        return null;
    }
    const roundRaw = Number(remoteStateRaw.round);
    const round = Number.isFinite(roundRaw) && roundRaw > 0 ? Math.floor(roundRaw) : 1;
    return {
        round,
        roundTitle: normalizeRoundTitle(remoteStateRaw.roundTitle),
        started: !!remoteStateRaw.started,
        revealed: !!remoteStateRaw.revealed,
        players: normalizeGuestPlayers(remoteStateRaw.players)
    };
}

function buildSnapshotFromState() {
    const role = state.role === "host" ? "host" : state.role === "guest" ? "guest" : null;
    if (!role) return null;

    const localId = normalizeId(state.localId);
    if (!localId) return null;

    const displayName = normalizeName(state.displayName);
    const selectedVote = normalizeVote(state.selectedVote);

    if (role === "host") {
        const session = normalizeHostSession(state.session, localId, displayName);
        if (!session) return null;
        return {
            v: SNAPSHOT_VERSION,
            savedAt: Date.now(),
            role: "host",
            localId,
            displayName,
            currentView: normalizeRoleView("host", state.currentView),
            roomId: normalizeId(state.roomId || localId) || localId,
            selectedVote,
            session
        };
    }

    return {
        v: SNAPSHOT_VERSION,
        savedAt: Date.now(),
        role: "guest",
        localId,
        displayName,
        currentView: normalizeRoleView("guest", state.currentView),
        roomId: normalizeId(state.roomId) || null,
        selectedVote,
        guestRemoteState: normalizeGuestRemoteState(state.guestRemoteState)
    };
}

function normalizeLoadedSnapshot(snapshotRaw) {
    if (!snapshotRaw || typeof snapshotRaw !== "object" || Array.isArray(snapshotRaw)) return null;
    if (snapshotRaw.v !== SNAPSHOT_VERSION) return null;

    const savedAt = Number(snapshotRaw.savedAt);
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
    if (Date.now() - savedAt > SNAPSHOT_MAX_AGE_MS) return null;

    const role = snapshotRaw.role === "host" ? "host" : snapshotRaw.role === "guest" ? "guest" : null;
    if (!role) return null;

    const localId = normalizeId(snapshotRaw.localId);
    if (!localId) return null;
    const displayName = normalizeName(snapshotRaw.displayName);
    const selectedVote = normalizeVote(snapshotRaw.selectedVote);
    const roomId = normalizeId(snapshotRaw.roomId) || null;
    const currentView = normalizeRoleView(role, snapshotRaw.currentView);

    if (role === "host") {
        const session = normalizeHostSession(snapshotRaw.session, localId, displayName);
        if (!session) return null;
        return {
            role: "host",
            localId,
            displayName,
            currentView,
            roomId: roomId || localId,
            selectedVote,
            session
        };
    }

    return {
        role: "guest",
        localId,
        displayName,
        currentView,
        roomId,
        selectedVote,
        guestRemoteState: normalizeGuestRemoteState(snapshotRaw.guestRemoteState)
    };
}

export function saveSessionSnapshot() {
    const snapshot = buildSnapshotFromState();
    if (!snapshot) return;

    const storage = getSessionStorage();
    if (!storage) return;
    try {
        storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (_error) {
        // Storage can fail in private mode.
    }
}

export function loadSessionSnapshot() {
    const storage = getSessionStorage();
    if (!storage) return null;

    let raw;
    try {
        raw = storage.getItem(SESSION_STORAGE_KEY);
    } catch (_error) {
        return null;
    }
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        const normalized = normalizeLoadedSnapshot(parsed);
        if (!normalized) {
            clearSessionSnapshot();
            return null;
        }
        return normalized;
    } catch (_error) {
        clearSessionSnapshot();
        return null;
    }
}

export function clearSessionSnapshot() {
    const storage = getSessionStorage();
    if (!storage) return;
    try {
        storage.removeItem(SESSION_STORAGE_KEY);
    } catch (_error) {
        // Storage can fail in private mode.
    }
}
