const STORAGE_CONNECTION_KEY = "planningPoker.connectionSettings";

const DEFAULT_SETTINGS = {
    strategy: "mqttQuickJoin",
    hostRequireApprovalFirstJoin: true,
    hostAutoApproveKnownRejoin: true
};

function sanitizeStrategy(value) {
    return value === "manualWebRtc" ? "manualWebRtc" : "mqttQuickJoin";
}

export function loadConnectionSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_CONNECTION_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            strategy: sanitizeStrategy(parsed.strategy),
            hostRequireApprovalFirstJoin: parsed.hostRequireApprovalFirstJoin !== false,
            hostAutoApproveKnownRejoin: parsed.hostAutoApproveKnownRejoin !== false
        };
    } catch (_error) {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveConnectionSettings(settings) {
    const normalized = {
        strategy: sanitizeStrategy(settings.strategy),
        hostRequireApprovalFirstJoin: settings.hostRequireApprovalFirstJoin !== false,
        hostAutoApproveKnownRejoin: settings.hostAutoApproveKnownRejoin !== false
    };
    try {
        localStorage.setItem(STORAGE_CONNECTION_KEY, JSON.stringify(normalized));
    } catch (_error) {
        // Ignore localStorage failures.
    }
    return normalized;
}

