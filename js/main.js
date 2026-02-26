import { state, STORAGE_NAME_KEY } from "./state.js";
import { log } from "./log.js";
import {
    DEFAULT_STUN_SERVERS,
    formatIceServersForInput,
    loadUserIceServers,
    parseIceServerInput,
    saveUserIceServers
} from "./ice-config.js";
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
    onHostRoundTitleChange,
    onHostRevealVotes,
    onHostStartGame,
    startHostSession
} from "./host.js";
import {
    onGuestConnectWithResponseCode,
    notifyGuestLeaving,
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
    els.hostRoundTitleInput.addEventListener("input", () => {
        onHostRoundTitleChange(els.hostRoundTitleInput.value);
    });
    els.displayNameInput.addEventListener("input", () => {
        state.displayName = sanitizeName(els.displayNameInput.value);
        storeDisplayName(state.displayName);
    });
    window.addEventListener("pagehide", onPageHide);
    if (els.iceSettingsBtn) {
        els.iceSettingsBtn.addEventListener("click", openIceSettingsDialog);
    }
    if (els.iceSettingsCancelBtn) {
        els.iceSettingsCancelBtn.addEventListener("click", () => {
            if (els.iceSettingsDialog && els.iceSettingsDialog.open) {
                els.iceSettingsDialog.close();
            }
        });
    }
    if (els.iceSettingsSaveBtn) {
        els.iceSettingsSaveBtn.addEventListener("click", onSaveIceSettings);
    }
    if (els.iceSettingsDialog) {
        els.iceSettingsDialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            els.iceSettingsDialog.close();
        });
    }

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

function openIceSettingsDialog() {
    if (!els.iceSettingsDialog || typeof els.iceSettingsDialog.showModal !== "function") {
        showNotice(els.homeNotice, "Connection settings are not supported in this browser.", "warn");
        return;
    }
    const defaultLines = DEFAULT_STUN_SERVERS
        .map((server) => Array.isArray(server.urls) ? server.urls.join(", ") : server.urls)
        .join("\n");
    els.defaultIceServersList.textContent = defaultLines;
    els.customIceServersInput.value = formatIceServersForInput(loadUserIceServers());
    showNotice(els.iceSettingsNotice, "", "info");
    els.iceSettingsDialog.showModal();
}

function onSaveIceSettings() {
    const parsedServers = parseIceServerInput(els.customIceServersInput.value);
    saveUserIceServers(parsedServers);
    if (els.iceSettingsDialog.open) {
        els.iceSettingsDialog.close();
    }
    showNotice(getCurrentNoticeElement(), "Connection settings saved. New connections will use updated ICE servers.", "info");
}

function getCurrentNoticeElement() {
    if (state.currentView === "hostLobby") return els.hostLobbyNotice;
    if (state.currentView === "guestConnect") return els.guestConnectNotice;
    if (state.currentView === "table") return els.tableNotice;
    return els.homeNotice;
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

    notifyGuestLeaving();
    shutdownGuest("Disconnected.");
    showView("home");
}

function onPageHide() {
    if (state.role === "guest") {
        notifyGuestLeaving();
        shutdownGuest();
        return;
    }
    if (state.role === "host") {
        shutdownHost();
    }
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
