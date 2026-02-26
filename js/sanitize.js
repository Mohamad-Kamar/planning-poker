export function sanitizeText(value, maxLength, fallback = "") {
    return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, maxLength);
}
