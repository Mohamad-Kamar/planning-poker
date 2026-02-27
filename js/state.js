export const STORAGE_NAME_KEY = "planningPoker.displayName";
export const VOTE_VALUES = ["0", "1", "2", "3", "5", "8", "13", "21", "?", "coffee"];
export const NUMERIC_VOTES = new Set(["0", "1", "2", "3", "5", "8", "13", "21"]);

export const state = {
    role: "idle", // idle | host | guest
    localId: createShortId(),
    displayName: "",
    selectedVote: null,
    session: null,
    hostPeers: new Map(),
    guestPeer: null,
    guestChannel: null,
    guestRemoteState: null,
    guestJoinCodeRaw: "",
    hostResponseCodeRaw: "",
    guestResponseApplied: false,
    currentView: "home",
    roomId: null,
    hostRecoveryRelay: null,
    hostPendingRejoinRequests: [],
    guestAutoRejoinEnabled: false,
    guestJoinPin: "",
    connectionStrategy: "mqttQuickJoin",
    hostRequireApprovalFirstJoin: true,
    hostAutoApproveKnownRejoin: true,
    hostRoomPin: ""
};

export function createShortId() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
