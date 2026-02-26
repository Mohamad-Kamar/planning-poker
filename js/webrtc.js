import { state } from "./state.js";
import { els, setSignalCodeDisplay, showNotice, updateConnectionStatus } from "./ui.js";
import { log } from "./log.js";

const ICE_GATHERING_TIMEOUT_MS = 10_000;

function getSelectedCandidatePair(stats) {
    for (const report of stats.values()) {
        if (report.type === "transport" && report.selectedCandidatePairId) {
            const fromTransport = stats.get(report.selectedCandidatePairId);
            if (fromTransport) return fromTransport;
        }
    }
    for (const report of stats.values()) {
        if (report.type === "candidate-pair" && report.selected) {
            return report;
        }
    }
    for (const report of stats.values()) {
        if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded") {
            return report;
        }
    }
    return null;
}

function describeCandidate(candidate) {
    if (!candidate) return null;
    return {
        type: candidate.candidateType || null,
        protocol: candidate.protocol || null,
        networkType: candidate.networkType || null,
        relayProtocol: candidate.relayProtocol || null
    };
}

function numberOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

export async function logPeerConnectionDiagnostics(pc, role, extra = {}) {
    if (!pc || typeof pc.getStats !== "function") return;
    try {
        const stats = await pc.getStats();
        let totalPairs = 0;
        let succeededPairs = 0;
        let failedPairs = 0;
        let inProgressPairs = 0;

        for (const report of stats.values()) {
            if (report.type !== "candidate-pair") continue;
            totalPairs += 1;
            if (report.state === "succeeded") succeededPairs += 1;
            if (report.state === "failed") failedPairs += 1;
            if (report.state === "in-progress" || report.state === "inprogress") inProgressPairs += 1;
        }

        const selectedPair = getSelectedCandidatePair(stats);
        const localCandidate = selectedPair && selectedPair.localCandidateId
            ? stats.get(selectedPair.localCandidateId)
            : null;
        const remoteCandidate = selectedPair && selectedPair.remoteCandidateId
            ? stats.get(selectedPair.remoteCandidateId)
            : null;

        log.warn("webrtc", "Peer connectivity diagnostics", {
            role,
            ...extra,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            candidatePairs: {
                total: totalPairs,
                succeeded: succeededPairs,
                failed: failedPairs,
                inProgress: inProgressPairs
            },
            selectedPair: selectedPair
                ? {
                    state: selectedPair.state || null,
                    nominated: !!selectedPair.nominated,
                    currentRoundTripTime: numberOrNull(selectedPair.currentRoundTripTime),
                    availableOutgoingBitrate: numberOrNull(selectedPair.availableOutgoingBitrate),
                    bytesSent: numberOrNull(selectedPair.bytesSent),
                    bytesReceived: numberOrNull(selectedPair.bytesReceived),
                    local: describeCandidate(localCandidate),
                    remote: describeCandidate(remoteCandidate)
                }
                : null
        });
    } catch (error) {
        log.warn("webrtc", "Failed to read peer diagnostics", {
            role,
            ...extra,
            message: String(error.message || error)
        });
    }
}

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
