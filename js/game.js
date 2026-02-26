import { NUMERIC_VOTES, VOTE_VALUES, state } from "./state.js";
import { log } from "./log.js";

export function setLocalVote(vote, deps) {
    if (vote !== null && !VOTE_VALUES.includes(vote)) return;

    state.selectedVote = vote;
    deps.renderVotePalette();

    if (state.role === "host") {
        if (!state.session) return;
        hostApplyVote(state.localId, vote, deps);
        return;
    }

    if (state.role === "guest") {
        if (state.guestChannel && state.guestChannel.readyState === "open") {
            deps.sendJson(state.guestChannel, { t: "vote", v: vote });
            deps.showNotice(deps.els.tableNotice, vote == null ? "Vote cleared." : "Vote sent.", "info", 1200);
            log.info("game", "Vote sent", { role: "guest", vote });
        } else {
            deps.showNotice(deps.els.tableNotice, "Not connected yet. Vote will not be sent.", "warn");
            log.warn("game", "Vote skipped; guest channel unavailable");
        }
    }
}

export function hostApplyVote(playerId, vote, deps) {
    if (!state.session) return;
    const player = state.session.players[playerId];
    if (!player) return;
    if (state.session.revealed) return;
    player.vote = vote;
    deps.broadcastState();
    deps.renderTable();
    deps.renderHostLobby();
    log.info("game", "Vote applied", { playerId, vote });
}

export function getRenderablePlayersForUI() {
    if (state.role === "host" && state.session) {
        const revealed = state.session.revealed;
        return getHostPlayersAsArray(true).map((player) => ({
            id: player.id,
            name: player.name,
            connected: player.connected,
            vote: revealed ? player.vote : null,
            voted: player.vote != null
        }));
    }

    if (state.role === "guest" && state.guestRemoteState) {
        return state.guestRemoteState.players.map((player) => ({
            id: player.id,
            name: player.name,
            connected: !!player.connected,
            vote: state.guestRemoteState.revealed ? player.vote : null,
            voted: !!player.voted
        }));
    }

    return [];
}

export function getCurrentRevealFlag() {
    if (state.role === "host" && state.session) return state.session.revealed;
    if (state.role === "guest" && state.guestRemoteState) return !!state.guestRemoteState.revealed;
    return false;
}

export function upsertHostPlayer(id, name, connected, sanitizeName) {
    if (!state.session) return;
    const current = state.session.players[id] || {
        id,
        name: "Guest",
        connected: false,
        vote: null,
        isHost: false
    };
    current.name = sanitizeName(name || current.name);
    current.connected = !!connected;
    current.isHost = id === state.localId;
    state.session.players[id] = current;
}

export function getHostPlayersAsArray(includeVotes) {
    if (!state.session) return [];
    const players = Object.values(state.session.players).map((player) => {
        return {
            id: player.id,
            name: player.name,
            connected: !!player.connected,
            isHost: !!player.isHost,
            vote: includeVotes ? player.vote : null
        };
    });
    players.sort((a, b) => {
        if (a.isHost && !b.isHost) return -1;
        if (b.isHost && !a.isHost) return 1;
        return a.name.localeCompare(b.name);
    });
    return players;
}

export function renderStatsValues(players, revealed) {
    if (!revealed) {
        return {
            average: "-",
            median: "-",
            min: "-",
            max: "-",
            consensus: "-"
        };
    }

    const voted = players.filter((p) => p.vote != null);
    const voteValues = voted.map((p) => String(p.vote));
    const numeric = voteValues
        .filter((v) => NUMERIC_VOTES.has(v))
        .map((v) => Number(v))
        .sort((a, b) => a - b);

    return {
        average: numeric.length ? formatNumber(avg(numeric)) : "-",
        median: numeric.length ? formatNumber(median(numeric)) : "-",
        min: numeric.length ? String(numeric[0]) : "-",
        max: numeric.length ? String(numeric[numeric.length - 1]) : "-",
        consensus: hasConsensus(voteValues) ? "Yes" : "No"
    };
}

export function avg(numbers) {
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function median(numbers) {
    const mid = Math.floor(numbers.length / 2);
    if (numbers.length % 2 === 0) {
        return (numbers[mid - 1] + numbers[mid]) / 2;
    }
    return numbers[mid];
}

export function formatNumber(value) {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function hasConsensus(votes) {
    if (!votes.length) return false;
    const first = votes[0];
    return votes.every((vote) => vote === first);
}
