import { state, STORAGE_NAME_KEY } from "./state.js";
import { log } from "./log.js";
import {
    copyTextWithFeedback,
    els,
    formatSignalCodeForDisplay,
    setGuestStep,
    setSignalCodeDisplay,
    setTableViewHandler,
    showNotice,
    showView,
    updateConnectionStatus
} from "./ui.js";
import { renderHostLobby, renderTable, renderVotePalette, setVoteSelectHandler } from "./render.js";
import { setLocalVote } from "./game.js";
import {
    configureHost,
    broadcastState,
    onAcceptGuestCode,
    onHostNewRound,
    onHostRevealVotes,
    onHostStartGame,
    startHostSession
} from "./host.js";
import {
    onGuestConnectWithResponseCode,
    onRegenerateGuestOffer,
    sendJson as guestSendJson,
    startGuestSession
} from "./guest.js";
import { shutdownGuest, shutdownHost } from "./webrtc.js";

init();

function init() {
    state.displayName = loadStoredDisplayName();
    els.displayNameInput.value = state.displayName;
    configureHost({ sanitizeName });
    setTableViewHandler(renderTable);
    setVoteSelectHandler((vote) => {
        setLocalVote(vote, {
            els,
            renderVotePalette,
            showNotice,
            sendJson: guestSendJson,
            broadcastState,
            renderTable,
            renderHostLobby
        });
    });

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
    window.planningPokerLog = log;
    log.info("init", "Application initialized", { restoredName: state.displayName || null });
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
    els.hostStartGameBtn.addEventListener("click", onHostStartGame);
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
    els.clearVoteBtn.addEventListener("click", () => {
        setLocalVote(null, {
            els,
            renderVotePalette,
            showNotice,
            sendJson: guestSendJson,
            broadcastState,
            renderTable,
            renderHostLobby
        });
    });
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
    startHostSession(name);
}

function onJoinRoom() {
    const name = ensureDisplayName();
    if (!name) return;
    startGuestSession(name);
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

export function sanitizeName(name) {
    return String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function storeDisplayName(name) {
    try {
        localStorage.setItem(STORAGE_NAME_KEY, name);
    } catch (_error) {
        // Storage can fail in private mode.
    }
}

export function loadStoredDisplayName() {
    try {
        return sanitizeName(localStorage.getItem(STORAGE_NAME_KEY) || "");
    } catch (_error) {
        return "";
    }
}
