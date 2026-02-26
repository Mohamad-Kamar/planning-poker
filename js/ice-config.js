import { log } from "./log.js";

const STORAGE_ICE_KEY = "planningPoker.iceServers";

export const DEFAULT_STUN_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.services.mozilla.com:3478" },
    { urls: "stun:global.stun.twilio.com:3478" }
];

function toIceServer(rawServer) {
    if (!rawServer || typeof rawServer !== "object") return null;
    const urls = Array.isArray(rawServer.urls)
        ? rawServer.urls.map((value) => String(value || "").trim()).filter(Boolean)
        : String(rawServer.urls || "").trim();
    if (!urls || (Array.isArray(urls) && urls.length === 0)) return null;
    const server = { urls };
    const username = String(rawServer.username || "").trim();
    const credential = String(rawServer.credential || "").trim();
    if (username) server.username = username;
    if (credential) server.credential = credential;
    return server;
}

function normalizeIceServers(servers) {
    if (!Array.isArray(servers)) return [];
    const normalized = [];
    for (const server of servers) {
        const value = toIceServer(server);
        if (value) normalized.push(value);
    }
    return normalized;
}

export function loadUserIceServers() {
    try {
        const raw = localStorage.getItem(STORAGE_ICE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return normalizeIceServers(parsed);
    } catch (error) {
        log.warn("webrtc", "Failed to load ICE settings", { message: String(error.message || error) });
        return [];
    }
}

export function saveUserIceServers(servers) {
    const normalized = normalizeIceServers(servers);
    try {
        localStorage.setItem(STORAGE_ICE_KEY, JSON.stringify(normalized));
    } catch (error) {
        log.warn("webrtc", "Failed to save ICE settings", { message: String(error.message || error) });
    }
    return normalized;
}

export function getIceServers() {
    return [...DEFAULT_STUN_SERVERS, ...loadUserIceServers()];
}

export function parseIceServerInput(text) {
    const lines = String(text || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const servers = [];
    for (const line of lines) {
        const parts = line.split("|").map((part) => part.trim());
        if (!parts[0]) continue;
        const urls = parts[0].includes(",")
            ? parts[0].split(",").map((url) => url.trim()).filter(Boolean)
            : parts[0];
        const server = { urls };
        if (parts[1]) server.username = parts[1];
        if (parts[2]) server.credential = parts[2];
        servers.push(server);
    }
    return normalizeIceServers(servers);
}

export function formatIceServersForInput(servers) {
    const normalized = normalizeIceServers(servers);
    return normalized.map((server) => {
        const urls = Array.isArray(server.urls) ? server.urls.join(", ") : server.urls;
        const username = server.username || "";
        const credential = server.credential || "";
        if (!username && !credential) return urls;
        return [urls, username, credential].join(" | ");
    }).join("\n");
}
