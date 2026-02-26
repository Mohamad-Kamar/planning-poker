import { log } from "./log.js";

export function validateSignalPayload(payload, expectedType) {
    if (!payload || typeof payload !== "object") throw new Error("Malformed code.");
    if (payload.v !== 1) throw new Error("Unsupported code version.");
    const fromId = payload.f || payload.from;
    if (!fromId || !payload.d) throw new Error("Missing signal fields.");
    if (!payload.d.t || payload.d.t !== expectedType) throw new Error("Expected " + expectedType + " code.");
}

export async function encodeSignalCode(payload) {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream !== "undefined") {
        const compressed = await compressBytes(bytes);
        const ratio = compressed.length / Math.max(1, bytes.length);
        log.info("signal", "Signal code encoded", {
            mode: "compressed",
            inputBytes: bytes.length,
            outputBytes: compressed.length,
            ratio: Number(ratio.toFixed(2))
        });
        return "C1." + bytesToBase64Url(compressed);
    }
    log.warn("signal", "CompressionStream unavailable; using uncompressed signal");
    return "U1." + bytesToBase64Url(bytes);
}

export async function decodeSignalCode(code) {
    const compact = String(code || "").replace(/\s+/g, "");
    const dotIndex = compact.indexOf(".");
    if (dotIndex === -1) {
        throw new Error("Invalid signal code format.");
    }
    const prefix = compact.slice(0, dotIndex);
    const body = compact.slice(dotIndex + 1);
    const bytes = base64UrlToBytes(body);
    let rawBytes;
    if (prefix === "C1") {
        if (typeof DecompressionStream === "undefined") {
            throw new Error("This browser cannot decode compressed signal codes.");
        }
        rawBytes = await decompressBytes(bytes);
    } else if (prefix === "U1") {
        rawBytes = bytes;
    } else {
        throw new Error("Unknown signal code prefix.");
    }
    const text = new TextDecoder().decode(rawBytes);
    const payload = JSON.parse(text);
    log.info("signal", "Signal code decoded", {
        mode: prefix,
        inputChars: compact.length,
        decodedBytes: rawBytes.length
    });
    return payload;
}

export async function compressBytes(inputBytes) {
    const stream = new Blob([inputBytes]).stream().pipeThrough(new CompressionStream("deflate"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
}

export async function decompressBytes(inputBytes) {
    const stream = new Blob([inputBytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
}

export function bytesToBase64Url(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(base64url) {
    const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
