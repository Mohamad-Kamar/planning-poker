let sanitizeNameFn = (name) => String(name || "").trim();

export const RELAY_FALLBACK_DELAY_MS = 2500;
export const ROUND_TITLE_MAX_LENGTH = 80;
export const PENDING_REJOIN_MAX = 12;
export const KICK_DISCONNECT_DELAY_MS = 120;

export function configureHost(deps) {
    if (deps && typeof deps.sanitizeName === "function") {
        sanitizeNameFn = deps.sanitizeName;
    }
}

export function sanitizeHostName(name) {
    return sanitizeNameFn(name);
}
