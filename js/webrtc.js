import { state } from "./state.js";
import { els, setSignalCodeDisplay, showNotice, updateConnectionStatus } from "./ui.js";
import { log } from "./log.js";

const ICE_GATHERING_TIMEOUT_MS = 10_000;

export function createPeerConnection() {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        iceCandidatePoolSize: 0
    });
    log.info("webrtc", "PeerConnection created");
    return pc;
}

export function waitForIceComplete(pc, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
    if (pc.iceGatheringState === "complete") {
        return Promise.resolve();
    }
    const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : ICE_GATHERING_TIMEOUT_MS;

    return new Promise((resolve) => {
        let done = false;

        const finish = (timedOut) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            pc.removeEventListener("icegatheringstatechange", onStateChange);
            if (timedOut) {
                log.warn("webrtc", "ICE gathering timeout reached; continuing with partial candidates", {
                    timeoutMs: effectiveTimeoutMs,
                    state: pc.iceGatheringState
                });
            } else {
                log.info("webrtc", "ICE gathering completed");
            }
            resolve();
        };

        const onStateChange = () => {
            if (pc.iceGatheringState === "complete") {
                finish(false);
            }
        };

        pc.addEventListener("icegatheringstatechange", onStateChange);
        const timer = setTimeout(() => {
            finish(true);
        }, effectiveTimeoutMs);
    });
}

export function resetGuestConnection() {
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

export function closePeerEntry(peerEntry) {
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

export function shutdownHost(noticeMessage) {
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
    log.info("host", "Host session shutdown");
}

export function shutdownGuest(noticeMessage) {
    resetGuestConnection();
    state.guestRemoteState = null;
    state.guestJoinCodeRaw = "";
    state.guestResponseApplied = false;
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
    els.connectGuestBtn.disabled = false;
    if (state.role === "guest") state.role = "idle";
    updateConnectionStatus(false, "Not connected");
    if (noticeMessage) showNotice(els.homeNotice, noticeMessage, "info");
    log.info("guest", "Guest session shutdown");
}
