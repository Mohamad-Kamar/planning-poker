import { VOTE_VALUES, state } from "./state.js";
import { els, escapeHtml, updateConnectionStatus } from "./ui.js";
import { getCurrentRevealFlag, getHostPlayersAsArray, getRenderablePlayersForUI, renderStatsValues } from "./game.js";

let voteSelectHandler = null;

export function setVoteSelectHandler(handler) {
    voteSelectHandler = handler;
}

export function renderHostLobby() {
    if (!state.session) return;
    renderConnectionStrategySections();
    const players = getHostPlayersAsArray(true);
    els.hostPlayerList.innerHTML = players.map((player) => {
        const roleTag = player.isHost ? "Host" : "Guest";
        const votedText = player.vote == null ? "Not voted" : "Voted";
        const dotClass = player.connected ? "online" : "offline";
        const kickButton = player.isHost
            ? ""
            : `<button class="btn btn-danger btn-small" data-kick-player="${escapeHtml(player.id)}">Kick</button>`;
        return `<div class="player-row">
            <div>
                <div class="player-name">${escapeHtml(player.name)}</div>
                <div class="player-meta">${roleTag} • ${votedText}</div>
            </div>
            <div class="row player-row-actions">
                <span class="status"><span class="status-dot ${dotClass}"></span>${player.connected ? "Online" : "Offline"}</span>
                ${kickButton}
            </div>
        </div>`;
    }).join("");

    const connectedCount = players.filter((p) => p.connected).length;
    const canStart = connectedCount >= 2;
    els.hostStartGameBtn.disabled = state.session.started ? false : !canStart;
    els.hostStartGameBtn.textContent = state.session.started ? "Return to Table" : "Start Game";
    els.copyHostResponseCodeBtn.disabled = !state.hostResponseCodeRaw;
    els.copyHostResponseCodeFormattedBtn.disabled = !state.hostResponseCodeRaw;

    const pending = Array.isArray(state.hostPendingRejoinRequests)
        ? state.hostPendingRejoinRequests
        : [];
    if (els.hostPendingRejoinPanel && els.hostPendingRejoinList) {
        els.hostPendingRejoinPanel.style.display = pending.length ? "block" : "none";
        els.hostPendingRejoinList.innerHTML = pending.map((request) => {
            const safeId = escapeHtml(request.id);
            const safeName = escapeHtml(request.name || "Guest");
            return `<div class="row-between">
                <div class="subtle">${safeName}</div>
                <div class="row">
                    <button class="btn btn-secondary" data-approve-rejoin="${safeId}">Approve</button>
                    <button class="btn btn-secondary" data-reject-rejoin="${safeId}">Reject</button>
                </div>
            </div>`;
        }).join("");
    }

    if (els.hostRoomCode) {
        const roomCode = String(state.roomId || state.localId || "");
        els.hostRoomCode.textContent = roomCode || "Not ready";
        const joinUrl = roomCode
            ? (window.location.origin + window.location.pathname + "?room=" + encodeURIComponent(roomCode))
            : "";
        if (els.hostRoomQrImage) {
            els.hostRoomQrImage.src = joinUrl
                ? ("https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=" + encodeURIComponent(joinUrl))
                : "";
        }
    }
    if (els.hostRoomPinInput && document.activeElement !== els.hostRoomPinInput) {
        els.hostRoomPinInput.value = state.hostRoomPin || "";
    }
}

export function renderConnectionStrategySections() {
    const manualMode = state.connectionStrategy === "manualWebRtc";
    if (els.hostRoomAccessPanel) {
        els.hostRoomAccessPanel.style.display = manualMode ? "none" : "";
    }
    if (els.hostManualFallbackDetails) {
        els.hostManualFallbackDetails.open = manualMode;
    }
    if (els.guestQuickJoinPanel) {
        els.guestQuickJoinPanel.style.display = manualMode ? "none" : "";
    }
    if (els.guestManualFallbackDetails) {
        els.guestManualFallbackDetails.open = manualMode;
    }
}

export function renderTable() {
    const isHost = state.role === "host";
    const isGuestConnected = !!(state.guestChannel && state.guestChannel.readyState === "open");
    const isRevealed = getCurrentRevealFlag();
    const roundInfo = getCurrentRoundInfo(isHost);

    els.tableRoleChip.textContent = isHost ? "Host" : "Guest";
    els.leaveSessionBtn.textContent = isHost ? "Back to Lobby" : (isGuestConnected ? "Leave" : "Reconnect");
    els.hostRevealBtn.style.display = isHost ? "inline-block" : "none";
    els.hostResetBtn.style.display = isHost ? "inline-block" : "none";
    els.hostRevealBtn.textContent = isRevealed ? "Conceal" : "Reveal";
    els.tableSubtitle.textContent = roundInfo.title
        ? "Round " + roundInfo.round + " - " + roundInfo.title
        : "Round " + roundInfo.round;
    if (els.hostRoundTitleInput) {
        if (isHost) {
            els.hostRoundTitleInput.style.display = "block";
            const nextRoundTitleValue = state.session ? (state.session.roundTitle || "") : "";
            const isEditingRoundTitle = document.activeElement === els.hostRoundTitleInput;
            if (!isEditingRoundTitle && els.hostRoundTitleInput.value !== nextRoundTitleValue) {
                els.hostRoundTitleInput.value = nextRoundTitleValue;
            }
        } else {
            els.hostRoundTitleInput.style.display = "none";
            els.hostRoundTitleInput.value = "";
        }
    }

    const players = getRenderablePlayersForUI();
    renderTablePlayers(players);
    renderStats(players, isRevealed);
    renderVotePalette();

    if (isHost) {
        const connected = players.filter((p) => p.connected).length;
        updateConnectionStatus(true, "Hosting " + Math.max(0, connected - 1) + " guest(s)");
        return;
    }
    updateConnectionStatus(isGuestConnected, isGuestConnected ? "Connected to host" : "Disconnected");
}

function getCurrentRoundInfo(isHost) {
    if (isHost && state.session) {
        return {
            round: state.session.round,
            title: state.session.roundTitle
        };
    }
    if (state.guestRemoteState) {
        return {
            round: state.guestRemoteState.round,
            title: state.guestRemoteState.roundTitle
        };
    }
    return {
        round: 1,
        title: ""
    };
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
    els.statAverage.textContent = values.average;
    els.statMedian.textContent = values.median;
    els.statMin.textContent = values.min;
    els.statMax.textContent = values.max;
    els.statConsensus.textContent = values.consensus;
}
