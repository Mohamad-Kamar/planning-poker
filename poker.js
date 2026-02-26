"use strict";

const STORAGE_NAME_KEY = "planningPoker.displayName";
const VOTE_VALUES = ["0", "1", "2", "3", "5", "8", "13", "21", "?", "coffee"];
const NUMERIC_VOTES = new Set(["0", "1", "2", "3", "5", "8", "13", "21"]);

const state = {
    role: "idle", // idle | host | guest
    localId: createShortId(),
    displayName: "",
    selectedVote: null,
    session: null, // host authoritative state
    hostPeers: new Map(),
    guestPeer: null,
    guestChannel: null,
    guestRemoteState: null,
    guestJoinCodeRaw: "",
    hostResponseCodeRaw: "",
    currentView: "homeView"
};

const els = {
    views: {
        home: document.getElementById("homeView"),
        hostLobby: document.getElementById("hostLobbyView"),
        guestConnect: document.getElementById("guestConnectView"),
        table: document.getElementById("tableView")
    },
    displayNameInput: document.getElementById("displayNameInput"),
    createRoomBtn: document.getElementById("createRoomBtn"),
    joinRoomBtn: document.getElementById("joinRoomBtn"),
    homeNotice: document.getElementById("homeNotice"),
    hostPlayerList: document.getElementById("hostPlayerList"),
    hostIncomingJoinCode: document.getElementById("hostIncomingJoinCode"),
    acceptGuestBtn: document.getElementById("acceptGuestBtn"),
    clearHostJoinCodeBtn: document.getElementById("clearHostJoinCodeBtn"),
    hostResponseCode: document.getElementById("hostResponseCode"),
    hostResponseCodeMeta: document.getElementById("hostResponseCodeMeta"),
    hostResponseCodeQuality: document.getElementById("hostResponseCodeQuality"),
    copyHostResponseCodeBtn: document.getElementById("copyHostResponseCodeBtn"),
    copyHostResponseCodeFormattedBtn: document.getElementById("copyHostResponseCodeFormattedBtn"),
    hostLobbyNotice: document.getElementById("hostLobbyNotice"),
    hostStartGameBtn: document.getElementById("hostStartGameBtn"),
    hostBackHomeBtn: document.getElementById("hostBackHomeBtn"),
    guestStep1: document.getElementById("guestStep1"),
    guestStep2: document.getElementById("guestStep2"),
    guestStep3: document.getElementById("guestStep3"),
    guestJoinCode: document.getElementById("guestJoinCode"),
    guestJoinCodeMeta: document.getElementById("guestJoinCodeMeta"),
    guestJoinCodeQuality: document.getElementById("guestJoinCodeQuality"),
    copyGuestJoinCodeBtn: document.getElementById("copyGuestJoinCodeBtn"),
    copyGuestJoinCodeFormattedBtn: document.getElementById("copyGuestJoinCodeFormattedBtn"),
    regenerateGuestJoinCodeBtn: document.getElementById("regenerateGuestJoinCodeBtn"),
    guestResponseCodeInput: document.getElementById("guestResponseCodeInput"),
    connectGuestBtn: document.getElementById("connectGuestBtn"),
    guestBackHomeBtn: document.getElementById("guestBackHomeBtn"),
    guestConnectNotice: document.getElementById("guestConnectNotice"),
    tableSubtitle: document.getElementById("tableSubtitle"),
    tableRoleChip: document.getElementById("tableRoleChip"),
    leaveSessionBtn: document.getElementById("leaveSessionBtn"),
    statsBar: document.getElementById("statsBar"),
    statAverage: document.getElementById("statAverage"),
    statMedian: document.getElementById("statMedian"),
    statMin: document.getElementById("statMin"),
    statMax: document.getElementById("statMax"),
    statConsensus: document.getElementById("statConsensus"),
    tablePlayersGrid: document.getElementById("tablePlayersGrid"),
    votePalette: document.getElementById("votePalette"),
    connectionStatusDot: document.getElementById("connectionStatusDot"),
    connectionStatusText: document.getElementById("connectionStatusText"),
    clearVoteBtn: document.getElementById("clearVoteBtn"),
    hostRevealBtn: document.getElementById("hostRevealBtn"),
    hostResetBtn: document.getElementById("hostResetBtn"),
    tableNotice: document.getElementById("tableNotice")
};

init();

function init() {
    state.displayName = loadStoredDisplayName();
    els.displayNameInput.value = state.displayName;
    renderVotePalette();
    wireEvents();
    els.copyGuestJoinCodeBtn.disabled = true;
    els.copyGuestJoinCodeFormattedBtn.disabled = true;
    els.copyHostResponseCodeBtn.disabled = true;
    els.copyHostResponseCodeFormattedBtn.disabled = true;
    setSignalCodeDisplay(
        els.guestJoinCode,
        els.guestJoinCodeMeta,
        els.guestJoinCodeQuality,
        "",
        "Generating code...",
        "Preparing connection details.",
        "Shareability: waiting for code"
    );
    setSignalCodeDisplay(
        els.hostResponseCode,
        els.hostResponseCodeMeta,
        els.hostResponseCodeQuality,
        "",
        "No response code yet.",
        "Waiting for guest join code.",
        "Shareability: waiting for code"
    );
    updateConnectionStatus(false, "Not connected");
    showView("home");
}

function wireEvents() {
    els.createRoomBtn.addEventListener("click", onCreateRoom);
    els.joinRoomBtn.addEventListener("click", onJoinRoom);
    els.acceptGuestBtn.addEventListener("click", onAcceptGuestCode);
    els.clearHostJoinCodeBtn.addEventListener("click", () => {
        els.hostIncomingJoinCode.value = "";
    });
    els.copyHostResponseCodeBtn.addEventListener("click", async () => {
        await copyTextWithFeedback(state.hostResponseCodeRaw, els.copyHostResponseCodeBtn, "Copied");
    });
    els.copyHostResponseCodeFormattedBtn.addEventListener("click", async () => {
        const formatted = formatSignalCodeForDisplay(state.hostResponseCodeRaw);
        await copyTextWithFeedback(formatted, els.copyHostResponseCodeFormattedBtn, "Copied");
    });
    els.hostStartGameBtn.addEventListener("click", () => {
        if (!state.session) return;
        state.session.started = true;
        broadcastState();
        renderHostLobby();
        showView("table");
        renderTable();
    });
    els.hostBackHomeBtn.addEventListener("click", () => {
        shutdownHost("Session closed.");
        showView("home");
    });

    els.copyGuestJoinCodeBtn.addEventListener("click", async () => {
        await copyTextWithFeedback(state.guestJoinCodeRaw, els.copyGuestJoinCodeBtn, "Copied");
    });
    els.copyGuestJoinCodeFormattedBtn.addEventListener("click", async () => {
        const formatted = formatSignalCodeForDisplay(state.guestJoinCodeRaw);
        await copyTextWithFeedback(formatted, els.copyGuestJoinCodeFormattedBtn, "Copied");
    });
    els.regenerateGuestJoinCodeBtn.addEventListener("click", onRegenerateGuestOffer);
    els.connectGuestBtn.addEventListener("click", onGuestConnectWithResponseCode);
    els.guestBackHomeBtn.addEventListener("click", () => {
        shutdownGuest("Join canceled.");
        showView("home");
    });

    els.leaveSessionBtn.addEventListener("click", onLeaveOrBack);
    els.clearVoteBtn.addEventListener("click", () => setLocalVote(null));
    els.hostRevealBtn.addEventListener("click", onHostRevealVotes);
    els.hostResetBtn.addEventListener("click", onHostNewRound);
    els.displayNameInput.addEventListener("input", () => {
        state.displayName = sanitizeName(els.displayNameInput.value);
        storeDisplayName(state.displayName);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            if (state.currentView === "guestConnect") {
                shutdownGuest("Join canceled.");
                showView("home");
                return;
            }
            if (state.currentView === "hostLobby") {
                shutdownHost("Session closed.");
                showView("home");
                return;
            }
            if (state.currentView === "table" && state.role === "guest") {
                onLeaveOrBack();
            }
        }

        if (event.key === "Enter" && !event.shiftKey) {
            if (document.activeElement === els.hostIncomingJoinCode) {
                event.preventDefault();
                onAcceptGuestCode();
            }
            if (document.activeElement === els.guestResponseCodeInput) {
                event.preventDefault();
                onGuestConnectWithResponseCode();
            }
        }
    });
}

function onCreateRoom() {
    const name = ensureDisplayName();
    if (!name) return;

    shutdownGuest();
    shutdownHost();

    state.role = "host";
    state.selectedVote = null;
    state.hostResponseCodeRaw = "";
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
    upsertHostPlayer(state.localId, name, true);
    renderHostLobby();
    showView("hostLobby");
    showNotice(els.hostLobbyNotice, "Room created. Ask a teammate to click Join Room and send you their join code.", "info");
}

function onJoinRoom() {
    const name = ensureDisplayName();
    if (!name) return;

    shutdownHost();
    shutdownGuest();

    state.role = "guest";
    state.selectedVote = null;
    state.guestRemoteState = null;
    showView("guestConnect");
    onRegenerateGuestOffer();
}

async function onRegenerateGuestOffer() {
    try {
        state.role = "guest";
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
        showNotice(els.guestConnectNotice, "Could not generate join code: " + String(error.message || error), "error");
    }
}

async function onGuestConnectWithResponseCode() {
    if (!state.guestPeer) {
        showNotice(els.guestConnectNotice, "Join code is not ready yet. Regenerate first.", "warn");
        return;
    }
    const code = (els.guestResponseCodeInput.value || "").trim();
    if (!code) {
        showNotice(els.guestConnectNotice, "Paste a host response code first.", "warn");
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

        const answerDescription = descriptionFromCompact(payload.d);
        await state.guestPeer.setRemoteDescription(answerDescription);
        showNotice(els.guestConnectNotice, "Response accepted. Waiting for data channel...", "info");
    } catch (error) {
        showNotice(els.guestConnectNotice, "Could not apply response code: " + String(error.message || error), "error");
    }
}

async function onAcceptGuestCode() {
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
        const guestName = sanitizeName(payload.n || payload.name || "Guest");
        const offerDescription = descriptionFromCompact(payload.d);

        await acceptGuestOffer(guestId, guestName, offerDescription);
        els.hostIncomingJoinCode.value = "";
    } catch (error) {
        showNotice(els.hostLobbyNotice, "Could not accept guest code: " + String(error.message || error), "error");
    }
}

function onHostRevealVotes() {
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
}

function onHostNewRound() {
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
}

function onLeaveOrBack() {
    if (state.role === "host") {
        if (state.currentView === "table") {
            showView("hostLobby");
            renderHostLobby();
            return;
        }
        shutdownHost("Session closed.");
        showView("home");
        return;
    }

    shutdownGuest("Disconnected.");
    showView("home");
}

function ensureDisplayName() {
    const name = sanitizeName(els.displayNameInput.value || "");
    if (!name) {
        showNotice(els.homeNotice, "Please enter your display name.", "warn");
        els.displayNameInput.focus();
        return "";
    }
    state.displayName = name;
    storeDisplayName(name);
    els.displayNameInput.value = name;
    return name;
}

function showView(viewKey) {
    const map = els.views;
    for (const key of Object.keys(map)) {
        map[key].classList.toggle("active", key === viewKey);
    }
    state.currentView = viewKey;

    if (viewKey === "home") {
        showNotice(els.homeNotice, "", "info");
    }
    if (viewKey === "table") {
        renderTable();
    }
}

function renderHostLobby() {
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

function renderTable() {
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
    els.tableSubtitle.textContent = "Round " + currentRound;

    const players = getRenderablePlayersForUI();
    renderTablePlayers(players);
    renderStats(players, getCurrentRevealFlag());
    renderVotePalette();

    if (isHost) {
        const connected = players.filter((p) => p.connected).length;
        updateConnectionStatus(true, "Hosting " + Math.max(0, connected - 1) + " guest(s)");
    }
}

function renderTablePlayers(players) {
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

function renderVotePalette() {
    els.votePalette.innerHTML = VOTE_VALUES.map((value) => {
        const selected = state.selectedVote === value ? "selected" : "";
        const label = value === "coffee" ? "coffee" : value;
        return `<button class="vote-card ${selected}" data-vote="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    }).join("");

    const buttons = els.votePalette.querySelectorAll("[data-vote]");
    for (const button of buttons) {
        button.addEventListener("click", () => {
            const vote = button.getAttribute("data-vote");
            setLocalVote(vote);
        });
    }
}

function setLocalVote(vote) {
    if (vote !== null && !VOTE_VALUES.includes(vote)) return;

    state.selectedVote = vote;
    renderVotePalette();

    if (state.role === "host") {
        if (!state.session) return;
        hostApplyVote(state.localId, vote);
        return;
    }

    if (state.role === "guest") {
        if (state.guestChannel && state.guestChannel.readyState === "open") {
            sendJson(state.guestChannel, { t: "vote", v: vote });
            showNotice(els.tableNotice, vote == null ? "Vote cleared." : "Vote sent.", "info", 1200);
        } else {
            showNotice(els.tableNotice, "Not connected yet. Vote will not be sent.", "warn");
        }
    }
}

function hostApplyVote(playerId, vote) {
    if (!state.session) return;
    const player = state.session.players[playerId];
    if (!player) return;
    if (state.session.revealed) return;
    player.vote = vote;
    broadcastState();
    renderTable();
    renderHostLobby();
}

function renderStats(players, revealed) {
    if (!revealed) {
        els.statsBar.classList.remove("visible");
        els.statAverage.textContent = "-";
        els.statMedian.textContent = "-";
        els.statMin.textContent = "-";
        els.statMax.textContent = "-";
        els.statConsensus.textContent = "-";
        return;
    }

    const voted = players.filter((p) => p.vote != null);
    const voteValues = voted.map((p) => String(p.vote));
    const numeric = voteValues
        .filter((v) => NUMERIC_VOTES.has(v))
        .map((v) => Number(v))
        .sort((a, b) => a - b);

    els.statsBar.classList.add("visible");
    els.statAverage.textContent = numeric.length ? formatNumber(avg(numeric)) : "-";
    els.statMedian.textContent = numeric.length ? formatNumber(median(numeric)) : "-";
    els.statMin.textContent = numeric.length ? String(numeric[0]) : "-";
    els.statMax.textContent = numeric.length ? String(numeric[numeric.length - 1]) : "-";
    els.statConsensus.textContent = hasConsensus(voteValues) ? "Yes" : "No";
}

function getRenderablePlayersForUI() {
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

function getCurrentRevealFlag() {
    if (state.role === "host" && state.session) return state.session.revealed;
    if (state.role === "guest" && state.guestRemoteState) return !!state.guestRemoteState.revealed;
    return false;
}

function upsertHostPlayer(id, name, connected) {
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

function getHostPlayersAsArray(includeVotes) {
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

async function createGuestOfferCode() {
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
}

async function acceptGuestOffer(guestId, guestName, offerDescription) {
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
    state.hostPeers.set(guestId, peerEntry);
    upsertHostPlayer(guestId, guestName, false);

    peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        peerEntry.dc = channel;
        setupHostDataChannel(guestId, channel);
    };
    peerConnection.onconnectionstatechange = () => {
        const status = peerConnection.connectionState;
        if (status === "disconnected" || status === "failed" || status === "closed") {
            peerEntry.connected = false;
            upsertHostPlayer(guestId, peerEntry.name, false);
            renderHostLobby();
            renderTable();
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
}

function setupHostDataChannel(guestId, channel) {
    const entry = state.hostPeers.get(guestId);
    if (!entry) return;

    channel.onopen = () => {
        entry.connected = true;
        upsertHostPlayer(guestId, entry.name, true);
        broadcastState();
        renderHostLobby();
        renderTable();
    };
    channel.onclose = () => {
        entry.connected = false;
        upsertHostPlayer(guestId, entry.name, false);
        renderHostLobby();
        renderTable();
    };
    channel.onerror = () => {
        showNotice(els.hostLobbyNotice, "A peer data channel encountered an error.", "warn");
    };
    channel.onmessage = (event) => {
        handleHostInboundMessage(guestId, event.data);
    };
}

function setupGuestPeerHandlers(pc, dc) {
    dc.onopen = () => {
        updateConnectionStatus(true, "Connected to host");
        setGuestStep(3);
        showNotice(els.guestConnectNotice, "Connected. Entering table...", "info");
        sendJson(dc, { t: "name", n: state.displayName });
        if (state.selectedVote != null) {
            sendJson(dc, { t: "vote", v: state.selectedVote });
        }
        showView("table");
        renderTable();
        showNotice(els.tableNotice, "Connected. Pick your card.", "info", 1400);
    };
    dc.onclose = () => {
        updateConnectionStatus(false, "Disconnected");
        if (state.role === "guest") {
            showNotice(els.tableNotice, "Connection closed.", "warn");
        }
    };
    dc.onerror = () => {
        showNotice(els.guestConnectNotice, "Data channel error.", "warn");
    };
    dc.onmessage = (event) => {
        handleGuestInboundMessage(event.data);
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
    };
}

function handleHostInboundMessage(guestId, rawData) {
    if (!state.session) return;
    let message;
    try {
        message = JSON.parse(rawData);
    } catch (_error) {
        return;
    }
    if (!message || typeof message !== "object") return;

    if (message.t === "name") {
        const newName = sanitizeName(message.n || "Guest");
        const peer = state.hostPeers.get(guestId);
        if (peer) peer.name = newName;
        upsertHostPlayer(guestId, newName, true);
        broadcastState();
        renderHostLobby();
        renderTable();
        return;
    }

    if (message.t === "vote") {
        const vote = message.v == null ? null : String(message.v);
        if (vote !== null && !VOTE_VALUES.includes(vote)) return;
        hostApplyVote(guestId, vote);
        return;
    }
}

function handleGuestInboundMessage(rawData) {
    let message;
    try {
        message = JSON.parse(rawData);
    } catch (_error) {
        return;
    }
    if (!message || typeof message !== "object") return;

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

function broadcastState() {
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
}

function broadcastMessageToGuests(message) {
    const peers = Array.from(state.hostPeers.values());
    for (const peer of peers) {
        if (peer.dc && peer.dc.readyState === "open") {
            sendJson(peer.dc, message);
        }
    }
}

function sendJson(channel, message) {
    try {
        channel.send(JSON.stringify(message));
    } catch (_error) {
        // Ignore send failures from stale peers.
    }
}

function createPeerConnection() {
    return new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        iceCandidatePoolSize: 0
    });
}

function waitForIceComplete(pc) {
    if (pc.iceGatheringState === "complete") {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const onStateChange = () => {
            if (pc.iceGatheringState === "complete") {
                pc.removeEventListener("icegatheringstatechange", onStateChange);
                resolve();
            }
        };
        pc.addEventListener("icegatheringstatechange", onStateChange);
    });
}

function shutdownHost(noticeMessage) {
    const peers = Array.from(state.hostPeers.values());
    for (const peer of peers) {
        closePeerEntry(peer);
    }
    state.hostPeers.clear();
    state.session = null;
    if (state.role === "host") state.role = "idle";
    state.selectedVote = null;
    state.hostResponseCodeRaw = "";
    setSignalCodeDisplay(
        els.hostResponseCode,
        els.hostResponseCodeMeta,
        els.hostResponseCodeQuality,
        "",
        "No response code yet.",
        "Waiting for guest join code.",
        "Shareability: waiting for code"
    );
    els.copyHostResponseCodeBtn.disabled = true;
    els.copyHostResponseCodeFormattedBtn.disabled = true;
    els.hostIncomingJoinCode.value = "";
    if (noticeMessage) showNotice(els.homeNotice, noticeMessage, "info");
}

function shutdownGuest(noticeMessage) {
    resetGuestConnection();
    state.guestRemoteState = null;
    state.guestJoinCodeRaw = "";
    setSignalCodeDisplay(
        els.guestJoinCode,
        els.guestJoinCodeMeta,
        els.guestJoinCodeQuality,
        "",
        "Generating code...",
        "Preparing connection details.",
        "Shareability: waiting for code"
    );
    els.copyGuestJoinCodeBtn.disabled = true;
    els.copyGuestJoinCodeFormattedBtn.disabled = true;
    if (state.role === "guest") state.role = "idle";
    updateConnectionStatus(false, "Not connected");
    if (noticeMessage) showNotice(els.homeNotice, noticeMessage, "info");
}

function resetGuestConnection() {
    if (state.guestChannel) {
        try {
            state.guestChannel.close();
        } catch (_error) {
            // Ignore close error.
        }
    }
    if (state.guestPeer) {
        try {
            state.guestPeer.close();
        } catch (_error) {
            // Ignore close error.
        }
    }
    state.guestChannel = null;
    state.guestPeer = null;
}

function closePeerEntry(peerEntry) {
    if (!peerEntry) return;
    if (peerEntry.dc) {
        try {
            peerEntry.dc.close();
        } catch (_error) {
            // Ignore close error.
        }
    }
    if (peerEntry.pc) {
        try {
            peerEntry.pc.close();
        } catch (_error) {
            // Ignore close error.
        }
    }
}

function setGuestStep(step) {
    const stepEls = [els.guestStep1, els.guestStep2, els.guestStep3];
    for (let i = 0; i < stepEls.length; i++) {
        const index = i + 1;
        stepEls[i].classList.toggle("active", index === step);
        stepEls[i].classList.toggle("completed", index < step);
    }
}

function updateConnectionStatus(isOnline, text) {
    els.connectionStatusDot.classList.toggle("online", isOnline);
    els.connectionStatusDot.classList.toggle("offline", !isOnline);
    els.connectionStatusText.textContent = text;
}

function showNotice(element, text, type, timeoutMs) {
    element.textContent = text || "";
    element.classList.remove("info", "warn", "error", "visible");
    if (!text) return;
    element.classList.add(type || "info", "visible");
    if (timeoutMs) {
        const currentText = text;
        setTimeout(() => {
            if (element.textContent === currentText) {
                element.classList.remove("visible");
            }
        }, timeoutMs);
    }
}

async function copyTextWithFeedback(text, button, doneLabel) {
    if (!text) return;
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch (_error) {
            copied = false;
        }
    }
    if (!copied) {
        copied = fallbackCopy(text);
    }
    const original = button.textContent;
    button.textContent = copied ? doneLabel : "Copy failed";
    if (copied) {
        button.classList.add("copied");
    }
    setTimeout(() => {
        button.textContent = original;
        button.classList.remove("copied");
    }, 1200);
}

function fallbackCopy(text) {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "true");
    input.style.position = "absolute";
    input.style.left = "-10000px";
    document.body.appendChild(input);
    input.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch (_error) {
        ok = false;
    }
    document.body.removeChild(input);
    return ok;
}

function sanitizeName(name) {
    return String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

function storeDisplayName(name) {
    try {
        localStorage.setItem(STORAGE_NAME_KEY, name);
    } catch (_error) {
        // Storage can fail in private mode.
    }
}

function loadStoredDisplayName() {
    try {
        return sanitizeName(localStorage.getItem(STORAGE_NAME_KEY) || "");
    } catch (_error) {
        return "";
    }
}

function createShortId() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
}

function avg(numbers) {
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function median(numbers) {
    const mid = Math.floor(numbers.length / 2);
    if (numbers.length % 2 === 0) {
        return (numbers[mid - 1] + numbers[mid]) / 2;
    }
    return numbers[mid];
}

function formatNumber(value) {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function hasConsensus(votes) {
    if (!votes.length) return false;
    const first = votes[0];
    return votes.every((vote) => vote === first);
}

function validateSignalPayload(payload, expectedType) {
    if (!payload || typeof payload !== "object") throw new Error("Malformed code.");
    if (payload.v !== 1) throw new Error("Unsupported code version.");
    const fromId = payload.f || payload.from;
    if (!fromId || !payload.d) throw new Error("Missing signal fields.");
    if (!payload.d.t || payload.d.t !== expectedType) throw new Error("Expected " + expectedType + " code.");
}

async function encodeSignalCode(payload) {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream !== "undefined") {
        const compressed = await compressBytes(bytes);
        return "C1." + bytesToBase64Url(compressed);
    }
    return "U1." + bytesToBase64Url(bytes);
}

async function decodeSignalCode(code) {
    const compact = String(code || "").replace(/\s+/g, "");
    const dotIndex = compact.indexOf(".");
    if (dotIndex === -1) {
        throw new Error("Invalid signal code format.");
    }
    const prefix = compact.slice(0, dotIndex);
    const body = compact.slice(dotIndex + 1);
    const bytes = base64UrlToBytes(body);
    let rawBytes;
    if (prefix === "C1") {
        if (typeof DecompressionStream === "undefined") {
            throw new Error("This browser cannot decode compressed signal codes.");
        }
        rawBytes = await decompressBytes(bytes);
    } else if (prefix === "U1") {
        rawBytes = bytes;
    } else {
        throw new Error("Unknown signal code prefix.");
    }
    const text = new TextDecoder().decode(rawBytes);
    return JSON.parse(text);
}

async function compressBytes(inputBytes) {
    const stream = new Blob([inputBytes]).stream().pipeThrough(new CompressionStream("deflate"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
}

async function decompressBytes(inputBytes) {
    const stream = new Blob([inputBytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
}

function bytesToBase64Url(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(base64url) {
    const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function compactFromDescription(description) {
    const type = description.type;
    const sdp = description.sdp || "";
    const lines = sdp.split(/\r?\n/);

    let ufrag = "";
    let pwd = "";
    let fingerprint = "";
    const candidates = [];

    for (const line of lines) {
        if (!line) continue;
        if (line.startsWith("a=ice-ufrag:")) {
            ufrag = line.slice("a=ice-ufrag:".length).trim();
            continue;
        }
        if (line.startsWith("a=ice-pwd:")) {
            pwd = line.slice("a=ice-pwd:".length).trim();
            continue;
        }
        if (line.startsWith("a=fingerprint:sha-256 ")) {
            fingerprint = line.slice("a=fingerprint:sha-256 ".length).replace(/:/g, "").toLowerCase();
            continue;
        }
        if (line.startsWith("a=candidate:")) {
            const parsed = parseCandidate(line.slice("a=candidate:".length));
            if (parsed) candidates.push(parsed);
        }
    }

    if (!ufrag || !pwd || !fingerprint) {
        throw new Error("Could not extract essential SDP fields.");
    }

    return {
        t: type, // offer | answer
        u: ufrag,
        p: pwd,
        f: fingerprint,
        c: candidates
    };
}

function descriptionFromCompact(compact) {
    if (!compact || !compact.t || !compact.u || !compact.p || !compact.f) {
        throw new Error("Incomplete compact SDP.");
    }
    const setup = normalizeSetup(compact.t);
    const fingerprint = formatFingerprint(compact.f);
    const sessionId = String(Date.now());
    const originVersion = "2";
    const candidateLines = Array.isArray(compact.c) ? compact.c.map(buildCandidateLine) : [];

    const lines = [
        "v=0",
        "o=- " + sessionId + " " + originVersion + " IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "a=group:BUNDLE 0",
        "a=msid-semantic: WMS",
        "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
        "c=IN IP4 0.0.0.0",
        "a=ice-ufrag:" + compact.u,
        "a=ice-pwd:" + compact.p,
        "a=ice-options:trickle",
        "a=fingerprint:sha-256 " + fingerprint,
        "a=setup:" + setup,
        "a=mid:0",
        "a=sctp-port:5000",
        "a=max-message-size:262144"
    ];

    for (const candidateLine of candidateLines) {
        lines.push("a=candidate:" + candidateLine);
    }
    lines.push("a=end-of-candidates", "");

    return {
        type: compact.t,
        sdp: lines.join("\r\n")
    };
}

function parseCandidate(raw) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 8) return null;

    const typeIndex = parts.indexOf("typ");
    if (typeIndex === -1 || typeIndex + 1 >= parts.length) return null;

    const foundation = parts[0];
    const component = Number(parts[1]) || 1;
    const transport = (parts[2] || "udp").toLowerCase();
    const priority = Number(parts[3]) || 0;
    const ip = parts[4];
    const port = Number(parts[5]) || 0;
    const candidateType = parts[typeIndex + 1] || "host";

    let relatedAddress = "";
    let relatedPort = 0;
    let tcpType = "";

    for (let i = typeIndex + 2; i < parts.length - 1; i++) {
        if (parts[i] === "raddr") {
            relatedAddress = parts[i + 1] || "";
        }
        if (parts[i] === "rport") {
            relatedPort = Number(parts[i + 1]) || 0;
        }
        if (parts[i] === "tcptype") {
            tcpType = parts[i + 1] || "";
        }
    }

    return {
        f: foundation,
        c: component,
        tr: transport,
        q: priority,
        i: ip,
        o: port,
        t: candidateType,
        ra: relatedAddress,
        rp: relatedPort,
        tc: tcpType
    };
}

function buildCandidateLine(candidate) {
    const base = [
        candidate.f || "0",
        String(candidate.c || 1),
        String(candidate.tr || "udp").toUpperCase(),
        String(candidate.q || 0),
        candidate.i || "0.0.0.0",
        String(candidate.o || 9),
        "typ",
        candidate.t || "host"
    ];

    if (candidate.ra) {
        base.push("raddr", candidate.ra);
    }
    if (candidate.rp) {
        base.push("rport", String(candidate.rp));
    }
    if (candidate.tc) {
        base.push("tcptype", candidate.tc);
    }
    return base.join(" ");
}

function formatFingerprint(noColonHex) {
    const hex = String(noColonHex || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    const chunks = [];
    for (let i = 0; i < hex.length; i += 2) {
        chunks.push(hex.slice(i, i + 2));
    }
    return chunks.join(":");
}

function normalizeSetup(type) {
    if (type === "offer") return "actpass";
    if (type === "answer") return "active";
    return "actpass";
}

function setSignalCodeDisplay(displayElement, metaElement, qualityElement, rawCode, emptyText, emptyMetaText, emptyQualityText) {
    const code = String(rawCode || "").trim();
    if (!code) {
        displayElement.textContent = emptyText;
        if (metaElement) metaElement.textContent = emptyMetaText || "";
        if (qualityElement) {
            qualityElement.textContent = emptyQualityText || "";
            qualityElement.classList.remove("quality-short", "quality-medium", "quality-long");
            qualityElement.classList.add("quality-medium");
        }
        return;
    }

    const display = formatSignalCodeForDisplay(code);
    displayElement.textContent = display;

    if (metaElement) {
        let encoding = "Encoded";
        if (code.startsWith("C1.")) encoding = "Compressed";
        if (code.startsWith("U1.")) encoding = "Uncompressed";
        const longHint = code.length > 900 ? " • long code" : "";
        metaElement.textContent = code.length + " chars • " + encoding + longHint;
    }

    if (qualityElement) {
        const shareability = getCodeShareability(code.length);
        qualityElement.textContent = "Shareability: " + shareability.label + " - " + shareability.helpText;
        qualityElement.classList.remove("quality-short", "quality-medium", "quality-long");
        qualityElement.classList.add(shareability.className);
    }
}

function formatSignalCodeForDisplay(code) {
    const compact = String(code || "").replace(/\s+/g, "");
    const groups = compact.match(/.{1,8}/g) || [];
    const lines = [];
    for (let i = 0; i < groups.length; i += 6) {
        lines.push(groups.slice(i, i + 6).join(" "));
    }
    return lines.join("\n");
}

function getCodeShareability(codeLength) {
    if (codeLength <= 320) {
        return {
            label: "Easy to share",
            helpText: "short code, low copy risk",
            className: "quality-short"
        };
    }
    if (codeLength <= 700) {
        return {
            label: "Okay to share",
            helpText: "medium length, still manageable",
            className: "quality-medium"
        };
    }
    return {
        label: "Might be tricky",
        helpText: "long code, double-check full paste",
        className: "quality-long"
    };
}
