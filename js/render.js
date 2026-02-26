import { VOTE_VALUES, state } from "./state.js";
import { els, escapeHtml, updateConnectionStatus } from "./ui.js";
import { getCurrentRevealFlag, getHostPlayersAsArray, getRenderablePlayersForUI, renderStatsValues } from "./game.js";

let voteSelectHandler = null;

export function setVoteSelectHandler(handler) {
    voteSelectHandler = handler;
}

export function renderHostLobby() {
    if (!state.session) return;
    const players = getHostPlayersAsArray(true);
    els.hostPlayerList.innerHTML = players.map((player) => {
        const roleTag = player.isHost ? "Host" : "Guest";
        const votedText = player.vote == null ? "Not voted" : "Voted";
        const dotClass = player.connected ? "online" : "offline";
        return `<div class="player-row">
            <div>
                <div class="player-name">${escapeHtml(player.name)}</div>
                <div class="player-meta">${roleTag} • ${votedText}</div>
            </div>
            <span class="status"><span class="status-dot ${dotClass}"></span>${player.connected ? "Online" : "Offline"}</span>
        </div>`;
    }).join("");

    const connectedCount = players.filter((p) => p.connected).length;
    const canStart = connectedCount >= 2;
    els.hostStartGameBtn.disabled = state.session.started ? false : !canStart;
    els.hostStartGameBtn.textContent = state.session.started ? "Return to Table" : "Start Game";
    els.copyHostResponseCodeBtn.disabled = !state.hostResponseCodeRaw;
    els.copyHostResponseCodeFormattedBtn.disabled = !state.hostResponseCodeRaw;
}

export function renderTable() {
    const isHost = state.role === "host";
    els.tableRoleChip.textContent = isHost ? "Host" : "Guest";
    els.leaveSessionBtn.textContent = isHost ? "Back to Lobby" : "Leave";
    els.hostRevealBtn.style.display = isHost ? "inline-block" : "none";
    els.hostResetBtn.style.display = isHost ? "inline-block" : "none";

    const currentRound = isHost && state.session
        ? state.session.round
        : state.guestRemoteState
            ? state.guestRemoteState.round
            : 1;
    const currentRoundTitle = isHost && state.session
        ? state.session.roundTitle
        : state.guestRemoteState
            ? state.guestRemoteState.roundTitle
            : "";
    els.tableSubtitle.textContent = currentRoundTitle
        ? "Round " + currentRound + " - " + currentRoundTitle
        : "Round " + currentRound;
    if (els.hostRoundTitleInput) {
        if (isHost) {
            els.hostRoundTitleInput.style.display = "block";
            els.hostRoundTitleInput.value = state.session ? (state.session.roundTitle || "") : "";
        } else {
            els.hostRoundTitleInput.style.display = "none";
            els.hostRoundTitleInput.value = "";
        }
    }

    const players = getRenderablePlayersForUI();
    renderTablePlayers(players);
    renderStats(players, getCurrentRevealFlag());
    renderVotePalette();

    if (isHost) {
        const connected = players.filter((p) => p.connected).length;
        updateConnectionStatus(true, "Hosting " + Math.max(0, connected - 1) + " guest(s)");
    }
}

export function renderTablePlayers(players) {
    if (!players.length) {
        els.tablePlayersGrid.innerHTML = "<div class=\"subtle\">No players connected yet.</div>";
        return;
    }

    const revealed = getCurrentRevealFlag();
    els.tablePlayersGrid.innerHTML = players.map((player) => {
        const hasVote = revealed ? player.vote != null : !!player.voted;
        const showBack = revealed && player.vote != null;
        const faceVote = hasVote ? "<div class=\"vote-check\">Voted</div>" : "<div class=\"vote-placeholder\">-</div>";
        const backVote = hasVote ? escapeHtml(String(player.vote)) : "<span class=\"vote-placeholder\">-</span>";
        const dotClass = player.connected ? "online" : "offline";
        return `<div class="player-card ${showBack ? "revealed" : ""}">
            <div class="player-card-face">
                <div class="row-between">
                    <div class="player-name">${escapeHtml(player.name)}</div>
                    <span class="status-dot ${dotClass}"></span>
                </div>
                <div>${faceVote}</div>
                <div class="vote-label">${player.connected ? "Online" : "Offline"}</div>
            </div>
            <div class="player-card-face player-card-back">
                <div class="player-name">${escapeHtml(player.name)}</div>
                <div class="vote-value">${backVote}</div>
                <div class="vote-label">Revealed</div>
            </div>
        </div>`;
    }).join("");
}

export function renderVotePalette() {
    els.votePalette.innerHTML = VOTE_VALUES.map((value) => {
        const selected = state.selectedVote === value ? "selected" : "";
        const label = value === "coffee" ? "coffee" : value;
        return `<button class="vote-card ${selected}" data-vote="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    }).join("");

    const buttons = els.votePalette.querySelectorAll("[data-vote]");
    for (const button of buttons) {
        button.addEventListener("click", () => {
            const vote = button.getAttribute("data-vote");
            if (typeof voteSelectHandler === "function") {
                voteSelectHandler(vote);
            }
        });
    }
}

export function renderStats(players, revealed) {
    const values = renderStatsValues(players, revealed);
    if (!revealed) {
        els.statsBar.classList.remove("visible");
    } else {
        els.statsBar.classList.add("visible");
    }
    els.statAverage.textContent = values.average;
    els.statMedian.textContent = values.median;
    els.statMin.textContent = values.min;
    els.statMax.textContent = values.max;
    els.statConsensus.textContent = values.consensus;
}
