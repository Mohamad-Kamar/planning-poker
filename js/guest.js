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
import { clearSessionSnapshot, saveSessionSnapshot } from "./persistence.js";
import { sendJson } from "./messaging.js";
import { EMPTY_GUEST_JOIN_CODE_DISPLAY } from "./signal-display-presets.js";

const RELAY_FALLBACK_DELAY_MS = 2500;
const REJOIN_ACK_TIMEOUT_MS = 4500;
const REJOIN_MAX_RETRIES = 8;
const PRESENCE_PING_INTERVAL_MS = 12_000;
const QUICK_JOIN_RETRY_MAX = 2;
const QUICK_JOIN_RETRY_DELAY_MS = 1200;

let guestRejoinTimer = null;
let guestRejoinAttempts = 0;
let guestAwaitingRejoinAck = false;
let guestPresenceTimer = null;
let guestJoinRetryTimer = null;
let guestJoinRetryAttempts = 0;
let guestAutoRejoinAttemptId = 0;
let guestQuickJoinAttemptId = 0;

function getGuestRejoinMaxRetries() {
    const testLimit = Number(window.__PP_TEST_REJOIN_MAX_RETRIES);
    if (Number.isFinite(testLimit) && testLimit > 0) {
        return Math.floor(testLimit);
    }
    return REJOIN_MAX_RETRIES;
}

function getQuickJoinRetryMax() {
    const testLimit = Number(window.__PP_TEST_QUICK_JOIN_RETRY_MAX);
    if (Number.isFinite(testLimit) && testLimit >= 0) {
        return Math.floor(testLimit);
    }
    return QUICK_JOIN_RETRY_MAX;
}

export function startGuestSession(displayName) {
    shutdownHost();
    shutdownGuest();

    state.role = "guest";
    state.selectedVote = null;
    state.guestRemoteState = null;
    state.displayName = displayName;
    state.guestResponseApplied = false;
    state.roomId = null;
    state.guestAutoRejoinEnabled = true;
    resetGuestRejoinState();
    stopGuestPresenceLoop();

    showView("guestConnect");
    onRegenerateGuestOffer();
    saveSessionSnapshot();
    log.info("guest", "Join room clicked", { name: displayName });
}

export function startGuestQuickJoin(displayName) {
    shutdownHost();
    shutdownGuest();

    state.role = "guest";
    state.selectedVote = null;
    state.guestRemoteState = null;
    state.displayName = displayName;
    state.guestResponseApplied = false;
    state.guestJoinPin = "";
    state.roomId = null;
    state.guestAutoRejoinEnabled = true;
    resetGuestRejoinState();
    stopGuestPresenceLoop();
    setGuestStep(1);
    showView("guestConnect");
    showNotice(els.guestConnectNotice, "Enter room code to join via relay.", "info");
    saveSessionSnapshot();
    log.info("guest", "Quick join selected", { name: displayName });
}

export async function onRegenerateGuestOffer() {
    try {
        state.role = "guest";
        state.guestResponseApplied = false;
        state.guestAutoRejoinEnabled = true;
        resetGuestRejoinState();
        stopGuestPresenceLoop();
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
            EMPTY_GUEST_JOIN_CODE_DISPLAY.rawCode,
            EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyText,
            EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyMetaText,
            EMPTY_GUEST_JOIN_CODE_DISPLAY.emptyQualityText
        );
        saveSessionSnapshot();
        await createGuestOfferCode();
        showNotice(els.guestConnectNotice, "Share this join code with the host. Then paste the response code.", "info");
        saveSessionSnapshot();
    } catch (error) {
        log.error("error", "Failed to generate guest offer", { message: String(error.message || error) });
        showNotice(els.guestConnectNotice, "Could not generate join code: " + String(error.message || error), "error");
        saveSessionSnapshot();
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
        saveSessionSnapshot();
        log.info("guest", "Response applied", {
            answerSdpLength: (answerDescription.sdp || "").length
        });
    } catch (error) {
        log.error("error", "Failed to apply host response", { message: String(error.message || error) });
        showNotice(els.guestConnectNotice, "Could not apply response code: " + String(error.message || error), "error");
    }
}

export async function createGuestOfferCode() {
    resetGuestRejoinState();
    stopGuestPresenceLoop();
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
    let relayFallbackTimer = null;
    const logDiagnosticsOnce = (trigger, failureState) => {
        if (diagnosticsLogged) return;
        diagnosticsLogged = true;
        void logPeerConnectionDiagnostics(pc, "guest", { trigger, failureState });
    };
    const clearRelayFallbackTimer = () => {
        if (!relayFallbackTimer) return;
        clearTimeout(relayFallbackTimer);
        relayFallbackTimer = null;
    };
    const triggerRelayFallback = (reason) => {
        if (relayFallbackTriggered) return;
        relayFallbackTriggered = true;
        clearRelayFallbackTimer();
        startGuestRelayFallback();
        showNotice(els.guestConnectNotice, "Direct path failed. Trying relay fallback...", "warn");
        log.warn("guest", "Guest relay fallback starting", { reason, hasRoomId: !!state.roomId });
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
            clearRelayFallbackTimer();
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
                    showNotice(els.guestConnectNotice, "Direct path failed. Starting relay fallback shortly...", "warn");
                    relayFallbackTimer = setTimeout(() => {
                        triggerRelayFallback("post-ice-restart-delay");
                    }, RELAY_FALLBACK_DELAY_MS);
                } else {
                    triggerRelayFallback("ice-restart-unavailable");
                }
                return;
            }
            triggerRelayFallback("repeat-failed-state");
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
    settleGuestRejoinState();
    startGuestPresenceLoop();
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
    saveSessionSnapshot();
}

export function onHostChannelClose(channel) {
    if (state.guestChannel !== channel) return;
    guestAwaitingRejoinAck = false;
    stopGuestPresenceLoop();
    if (state.guestChannel === channel) {
        state.guestChannel = null;
    }
    updateConnectionStatus(false, "Disconnected");
    if (state.role === "guest") {
        showNotice(els.tableNotice, "Connection closed.", "warn");
    }
    if (canAttemptGuestAutoRejoin()) {
        scheduleGuestAutoRejoin("channel-closed", true);
    }
    saveSessionSnapshot();
}

export function onHostChannelMessage(rawData, channel) {
    if (state.guestChannel !== channel) return;
    handleGuestInboundMessage(rawData, channel);
}

export function notifyGuestLeaving() {
    if (state.role !== "guest") return;
    if (!state.guestChannel || state.guestChannel.readyState !== "open") return;
    sendJson(state.guestChannel, { t: "leave" });
}

export async function connectGuestByRoomCode(roomCode, pin = "") {
    const normalizedRoomCode = String(roomCode || "").trim();
    if (!normalizedRoomCode) {
        showNotice(els.guestConnectNotice, "Enter a room code first.", "warn");
        return;
    }
    state.role = "guest";
    state.roomId = normalizedRoomCode;
    state.guestJoinPin = String(pin || "").trim();
    state.guestAutoRejoinEnabled = true;
    resetGuestRejoinState();
    if (state.guestChannel && typeof state.guestChannel.close === "function") {
        try {
            state.guestChannel.close();
        } catch (_error) {
            // Ignore close errors while restarting quick-join.
        }
    }
    updateConnectionStatus(false, "Connecting to room...");
    showNotice(els.guestConnectNotice, "Requesting host approval...", "info");
    await attemptGuestDirectRelayJoin("quick-join");
}

export function triggerGuestAutoRejoin(reason = "manual") {
    if (!canAttemptGuestAutoRejoin()) return;
    scheduleGuestAutoRejoin(reason, true);
}

function startGuestRelayFallback() {
    const roomId = state.roomId;
    if (!roomId) {
        showNotice(
            els.guestConnectNotice,
            "Direct path failed and relay setup is missing room info. Regenerate your join code and retry.",
            "error"
        );
        return;
    }
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
        },
        onFailure: (errorInfo) => {
            const reason = errorInfo && errorInfo.reason ? errorInfo.reason : "unknown";
            showNotice(
                els.guestConnectNotice,
                "Relay fallback failed (" + reason + "). Regenerate your join code or try another network.",
                "error"
            );
        }
    });
    state.guestChannel = relayChannel;
}

function canAttemptGuestAutoRejoin() {
    if (!state.guestAutoRejoinEnabled) return false;
    if (state.role !== "guest") return false;
    if (!state.roomId) return false;
    if (state.currentView !== "table" && !(state.guestRemoteState && state.guestRemoteState.started)) {
        return false;
    }
    return guestRejoinAttempts < getGuestRejoinMaxRetries();
}

function clearGuestRejoinTimer() {
    if (!guestRejoinTimer) return;
    clearTimeout(guestRejoinTimer);
    guestRejoinTimer = null;
}

function resetGuestRejoinState() {
    settleGuestRejoinState();
    guestAutoRejoinAttemptId += 1;
    guestQuickJoinAttemptId += 1;
}

function settleGuestRejoinState() {
    clearGuestRejoinTimer();
    clearGuestJoinRetryTimer();
    guestRejoinAttempts = 0;
    guestJoinRetryAttempts = 0;
    guestAwaitingRejoinAck = false;
}

function stopGuestPresenceLoop() {
    if (!guestPresenceTimer) return;
    clearInterval(guestPresenceTimer);
    guestPresenceTimer = null;
}

function canSendPresencePing() {
    if (state.role !== "guest") return false;
    if (!state.guestChannel) return false;
    return state.guestChannel.readyState === "open";
}

function sendPresencePing(reason) {
    if (!canSendPresencePing()) return;
    sendJson(state.guestChannel, {
        t: "presence",
        n: state.displayName,
        reason: reason || "beat"
    });
}

function startGuestPresenceLoop() {
    stopGuestPresenceLoop();
    if (!canSendPresencePing()) return;
    // Send an immediate presence ping so host can update status quickly after recoveries.
    sendPresencePing("immediate");
    guestPresenceTimer = setInterval(() => {
        if (!canSendPresencePing()) {
            stopGuestPresenceLoop();
            return;
        }
        sendPresencePing("beat");
    }, PRESENCE_PING_INTERVAL_MS);
}

function getGuestRejoinDelayMs() {
    const step = Math.max(0, guestRejoinAttempts - 1);
    return Math.min(1000 * (2 ** step), 8000);
}

function clearGuestJoinRetryTimer() {
    if (!guestJoinRetryTimer) return;
    clearTimeout(guestJoinRetryTimer);
    guestJoinRetryTimer = null;
}

function canRetryGuestJoinWhileAwaitingApproval() {
    if (state.role !== "guest") return false;
    if (!state.roomId) return false;
    if (guestJoinRetryAttempts >= getQuickJoinRetryMax()) return false;
    return guestAwaitingRejoinAck;
}

function scheduleGuestJoinRetry(reason) {
    if (!canRetryGuestJoinWhileAwaitingApproval()) return false;
    if (guestJoinRetryTimer) return guestJoinRetryAttempts;
    guestJoinRetryAttempts += 1;
    const scheduledAttempt = guestJoinRetryAttempts;
    guestJoinRetryTimer = setTimeout(() => {
        guestJoinRetryTimer = null;
        if (state.role !== "guest") return;
        if (!state.roomId) return;
        if (!guestAwaitingRejoinAck) return;
        void attemptGuestDirectRelayJoin(reason || "retry");
    }, QUICK_JOIN_RETRY_DELAY_MS);
    return scheduledAttempt;
}

function scheduleGuestAutoRejoin(reason, immediate = false) {
    if (!canAttemptGuestAutoRejoin()) return;
    clearGuestRejoinTimer();
    const delayMs = immediate ? 0 : getGuestRejoinDelayMs();
    guestRejoinTimer = setTimeout(() => {
        guestRejoinTimer = null;
        void attemptGuestAutoRejoin(reason);
    }, delayMs);
}

async function attemptGuestAutoRejoin(reason) {
    if (!canAttemptGuestAutoRejoin()) return;
    const attemptId = ++guestAutoRejoinAttemptId;
    guestRejoinAttempts += 1;
    guestAwaitingRejoinAck = true;
    updateConnectionStatus(false, "Reconnecting to host...");
    showNotice(
        els.tableNotice,
        "Trying to reconnect (" + guestRejoinAttempts + "/" + getGuestRejoinMaxRetries() + ")...",
        "warn"
    );
    log.info("guest", "Guest auto-rejoin attempt", { reason, attempt: guestRejoinAttempts });

    const roomId = state.roomId;
    const relayChannel = createMqttRelayChannel("guest", roomId, state.localId, {
        onOpen: (channel) => {
            if (attemptId !== guestAutoRejoinAttemptId) {
                channel.close();
                return;
            }
            if (state.role !== "guest" || !state.guestAutoRejoinEnabled) {
                channel.close();
                return;
            }
            state.guestChannel = channel;
            sendJson(channel, {
                t: "rejoin",
                id: state.localId,
                n: state.displayName,
                pin: state.guestJoinPin || ""
            });
            setTimeout(() => {
                if (state.guestChannel !== channel) return;
                if (!guestAwaitingRejoinAck) return;
                try {
                    channel.close();
                } catch (_error) {
                    // Ignore close errors.
                }
            }, REJOIN_ACK_TIMEOUT_MS);
        },
        onClose: () => {
            if (attemptId !== guestAutoRejoinAttemptId) return;
            state.guestChannel = null;
            if (canAttemptGuestAutoRejoin()) {
                updateConnectionStatus(false, "Reconnecting to host...");
                scheduleGuestAutoRejoin("relay-close");
                return;
            }
            guestAwaitingRejoinAck = false;
            updateConnectionStatus(false, "Reconnect unavailable");
            showNotice(
                els.tableNotice,
                "Could not reconnect automatically. Click Reconnect to generate a fresh join code.",
                "error"
            );
        },
        onMessage: (payload) => {
            if (attemptId !== guestAutoRejoinAttemptId) return;
            onHostChannelMessage(payload, relayChannel);
        },
        onFailure: (errorInfo) => {
            if (attemptId !== guestAutoRejoinAttemptId) return;
            const reasonText = errorInfo && errorInfo.reason ? errorInfo.reason : "unknown";
            showNotice(
                els.tableNotice,
                "Reconnect attempt failed (" + reasonText + "). Retrying...",
                "warn"
            );
            if (canAttemptGuestAutoRejoin()) {
                scheduleGuestAutoRejoin("relay-failure");
                return;
            }
            guestAwaitingRejoinAck = false;
            updateConnectionStatus(false, "Reconnect unavailable");
            showNotice(
                els.tableNotice,
                "Could not reconnect automatically. Click Reconnect to generate a fresh join code.",
                "error"
            );
        }
    });
    state.guestChannel = relayChannel;
}

async function attemptGuestDirectRelayJoin(reason) {
    const roomId = String(state.roomId || "").trim();
    if (!roomId) {
        showNotice(els.guestConnectNotice, "Room code is missing.", "error");
        return;
    }
    clearGuestJoinRetryTimer();
    const attemptId = ++guestQuickJoinAttemptId;
    guestAwaitingRejoinAck = true;
    const relayChannel = createMqttRelayChannel("guest", roomId, state.localId, {
        onOpen: (channel) => {
            if (attemptId !== guestQuickJoinAttemptId) {
                channel.close();
                return;
            }
            if (state.role !== "guest") {
                channel.close();
                return;
            }
            state.guestChannel = channel;
            sendJson(channel, {
                t: "rejoin",
                id: state.localId,
                n: state.displayName,
                pin: state.guestJoinPin || ""
            });
            setTimeout(() => {
                if (state.guestChannel !== channel) return;
                if (!guestAwaitingRejoinAck) return;
                if (state.guestJoinPin) {
                    guestAwaitingRejoinAck = false;
                    updateConnectionStatus(false, "Disconnected");
                    showNotice(
                        els.guestConnectNotice,
                        "Could not connect to room (timeout). Check room code/PIN and try again.",
                        "error"
                    );
                    try {
                        channel.close();
                    } catch (_error) {
                        // Ignore close errors.
                    }
                    return;
                }
                showNotice(els.guestConnectNotice, "Waiting for host approval. You can retry.", "warn");
                updateConnectionStatus(false, "Waiting for host approval");
            }, REJOIN_ACK_TIMEOUT_MS);
        },
        onClose: () => {
            if (attemptId !== guestQuickJoinAttemptId) return;
            state.guestChannel = null;
            if (!guestAwaitingRejoinAck) {
                updateConnectionStatus(false, "Disconnected");
                return;
            }
            const retryAttempt = scheduleGuestJoinRetry("relay-close");
            const retryScheduled = Number.isFinite(retryAttempt);
            if (retryScheduled) {
                updateConnectionStatus(false, "Waiting for host approval");
                showNotice(els.guestConnectNotice, "Connection dropped while waiting for approval. Retrying...", "warn");
                return;
            }
            guestAwaitingRejoinAck = false;
            updateConnectionStatus(false, "Waiting for host approval");
            showNotice(
                els.guestConnectNotice,
                "Connection dropped while waiting for host approval. Click Join Room to retry.",
                "warn"
            );
        },
        onMessage: (payload) => {
            if (attemptId !== guestQuickJoinAttemptId) return;
            onHostChannelMessage(payload, relayChannel);
        },
        onFailure: (errorInfo) => {
            if (attemptId !== guestQuickJoinAttemptId) return;
            const reasonText = errorInfo && errorInfo.reason ? errorInfo.reason : "unknown";
            if (guestAwaitingRejoinAck) {
                const retryAttempt = scheduleGuestJoinRetry("relay-failure");
                const retryScheduled = Number.isFinite(retryAttempt);
                if (retryScheduled) {
                    updateConnectionStatus(false, "Waiting for host approval");
                    showNotice(
                        els.guestConnectNotice,
                        "Still waiting for host approval. Retrying connection...",
                        "warn"
                    );
                    log.warn("guest", "Quick join relay retrying", {
                        reason,
                        reasonText,
                        roomId,
                        attempt: retryAttempt
                    });
                    return;
                }
                guestAwaitingRejoinAck = false;
                updateConnectionStatus(false, "Waiting for host approval");
                showNotice(
                    els.guestConnectNotice,
                    "Could not keep waiting for host approval. Click Join Room to retry.",
                    "warn"
                );
                return;
            }
            showNotice(els.guestConnectNotice, "Could not connect to room (" + reasonText + ").", "error");
            log.warn("guest", "Quick join relay failed", { reason, reasonText, roomId });
        }
    });
    state.guestChannel = relayChannel;
}

export function handleGuestInboundMessage(rawData, channel) {
    let message;
    try {
        message = JSON.parse(rawData);
    } catch (_error) {
        return;
    }
    if (!message || typeof message !== "object") return;
    log.info("game", "Message received", { role: "guest", type: message.t || "unknown" });

    if (message.t === "rejoinAck") {
        if (message.to && message.to !== state.localId) return;
        if (state.guestChannel !== channel) return;
        guestAwaitingRejoinAck = false;
        clearGuestJoinRetryTimer();
        guestJoinRetryAttempts = 0;
        if (message.room) {
            state.roomId = String(message.room);
        }
        onHostChannelOpen(channel);
        return;
    }

    if (message.t === "rejoinReject") {
        if (message.to && message.to !== state.localId) return;
        guestAwaitingRejoinAck = false;
        clearGuestJoinRetryTimer();
        guestJoinRetryAttempts = 0;
        const rejectReason = typeof message.reason === "string" && message.reason.trim()
            ? message.reason.trim()
            : "Host approval required.";
        updateConnectionStatus(false, "Reconnect pending approval");
        const retryAllowed = canAttemptGuestAutoRejoin();
        const retryHint = retryAllowed
            ? " Retrying shortly..."
            : " Click Join Room to retry.";
        showNotice(
            state.currentView === "table" ? els.tableNotice : els.guestConnectNotice,
            rejectReason + retryHint,
            "warn"
        );
        if (state.guestChannel === channel) {
            try {
                channel.close();
            } catch (_error) {
                // Ignore close errors.
            }
        }
        if (retryAllowed) {
            scheduleGuestAutoRejoin("rejected");
        }
        saveSessionSnapshot();
        return;
    }

    if (message.t === "kicked") {
        if (message.to && message.to !== state.localId) return;
        const reason = typeof message.reason === "string" && message.reason.trim()
            ? message.reason.trim()
            : "Removed by host.";
        showView("home");
        shutdownGuest(reason);
        clearSessionSnapshot();
        return;
    }

    if (message.t === "state") {
        state.guestRemoteState = {
            round: message.round || 1,
            roundTitle: typeof message.roundTitle === "string" ? message.roundTitle : "",
            started: !!message.started,
            revealed: !!message.revealed,
            players: Array.isArray(message.players) ? message.players : []
        };
        if (state.guestRemoteState.started && state.currentView !== "table") {
            showView("table");
        }
        renderTable();
        saveSessionSnapshot();
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
        saveSessionSnapshot();
        return;
    }

    if (message.t === "reset") {
        state.selectedVote = null;
        if (state.guestRemoteState) {
            state.guestRemoteState.round = message.round || state.guestRemoteState.round + 1;
            state.guestRemoteState.roundTitle = "";
            state.guestRemoteState.revealed = false;
            state.guestRemoteState.players = state.guestRemoteState.players.map((player) => ({
                ...player,
                voted: false,
                vote: null
            }));
        }
        renderTable();
        saveSessionSnapshot();
    }
}

export { sendJson } from "./messaging.js";
