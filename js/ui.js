import { state } from "./state.js";
import { log } from "./log.js";

export const els = {
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

let onTableViewActivated = null;

export function setTableViewHandler(handler) {
    onTableViewActivated = handler;
}

export function showView(viewKey) {
    for (const key of Object.keys(els.views)) {
        els.views[key].classList.toggle("active", key === viewKey);
    }
    state.currentView = viewKey;
    log.info("nav", "View changed", { to: viewKey });

    if (viewKey === "home") {
        showNotice(els.homeNotice, "", "info");
    }
    if (viewKey === "table" && typeof onTableViewActivated === "function") {
        onTableViewActivated();
    }
}

export function setGuestStep(step) {
    const stepEls = [els.guestStep1, els.guestStep2, els.guestStep3];
    for (let i = 0; i < stepEls.length; i++) {
        const index = i + 1;
        stepEls[i].classList.toggle("active", index === step);
        stepEls[i].classList.toggle("completed", index < step);
    }
}

export function updateConnectionStatus(isOnline, text) {
    els.connectionStatusDot.classList.toggle("online", isOnline);
    els.connectionStatusDot.classList.toggle("offline", !isOnline);
    els.connectionStatusText.textContent = text;
}

export function showNotice(element, text, type, timeoutMs) {
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

export async function copyTextWithFeedback(text, button, doneLabel) {
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

export function fallbackCopy(text) {
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

export function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
}

export function setSignalCodeDisplay(displayElement, metaElement, qualityElement, rawCode, emptyText, emptyMetaText, emptyQualityText) {
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

export function formatSignalCodeForDisplay(code) {
    const compact = String(code || "").replace(/\s+/g, "");
    const groups = compact.match(/.{1,8}/g) || [];
    const lines = [];
    for (let i = 0; i < groups.length; i += 6) {
        lines.push(groups.slice(i, i + 6).join(" "));
    }
    return lines.join("\n");
}

export function getCodeShareability(codeLength) {
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
