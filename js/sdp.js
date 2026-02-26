import { log } from "./log.js";

export function compactFromDescription(description) {
    if (!description || !description.type || !description.sdp) {
        throw new Error("Missing local session description.");
    }
    const compact = {
        t: description.type,
        s: description.sdp
    };
    log.info("signal", "SDP compacted", {
        type: description.type,
        sdpLength: description.sdp.length
    });
    return compact;
}

export function descriptionFromCompact(compact) {
    if (!compact || !compact.t) {
        throw new Error("Incomplete compact SDP payload.");
    }

    if (typeof compact.s === "string" && compact.s.length > 0) {
        return {
            type: compact.t,
            sdp: compact.s
        };
    }

    // Legacy fallback for older compact payloads.
    if (!compact.u || !compact.p || !compact.f) {
        throw new Error("Incomplete legacy SDP payload.");
    }
    const setup = normalizeSetup(compact.t);
    const fingerprint = formatFingerprint(compact.f);
    const sessionId = String(Date.now());
    const originVersion = "2";
    const candidateLines = Array.isArray(compact.c) ? compact.c.map(buildCandidateLine) : [];

    const lines = [
        "v=0",
        "o=- " + sessionId + " " + originVersion + " IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "a=group:BUNDLE 0",
        "a=msid-semantic: WMS",
        "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
        "c=IN IP4 0.0.0.0",
        "a=ice-ufrag:" + compact.u,
        "a=ice-pwd:" + compact.p,
        "a=ice-options:trickle",
        "a=fingerprint:sha-256 " + fingerprint,
        "a=setup:" + setup,
        "a=mid:0",
        "a=sctp-port:5000",
        "a=max-message-size:262144"
    ];

    for (const candidateLine of candidateLines) {
        lines.push("a=candidate:" + candidateLine);
    }
    lines.push("a=end-of-candidates", "");

    return {
        type: compact.t,
        sdp: lines.join("\r\n")
    };
}

function parseCandidate(raw) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 8) return null;
    const typeIndex = parts.indexOf("typ");
    if (typeIndex === -1 || typeIndex + 1 >= parts.length) return null;

    const foundation = parts[0];
    const component = Number(parts[1]) || 1;
    const transport = (parts[2] || "udp").toLowerCase();
    const priority = Number(parts[3]) || 0;
    const ip = parts[4];
    const port = Number(parts[5]) || 0;
    const candidateType = parts[typeIndex + 1] || "host";

    let relatedAddress = "";
    let relatedPort = 0;
    let tcpType = "";

    for (let i = typeIndex + 2; i < parts.length - 1; i++) {
        if (parts[i] === "raddr") relatedAddress = parts[i + 1] || "";
        if (parts[i] === "rport") relatedPort = Number(parts[i + 1]) || 0;
        if (parts[i] === "tcptype") tcpType = parts[i + 1] || "";
    }

    return {
        f: foundation,
        c: component,
        tr: transport,
        q: priority,
        i: ip,
        o: port,
        t: candidateType,
        ra: relatedAddress,
        rp: relatedPort,
        tc: tcpType
    };
}

function buildCandidateLine(candidate) {
    const base = [
        candidate.f || "0",
        String(candidate.c || 1),
        String(candidate.tr || "udp").toUpperCase(),
        String(candidate.q || 0),
        candidate.i || "0.0.0.0",
        String(candidate.o || 9),
        "typ",
        candidate.t || "host"
    ];

    if (candidate.ra) base.push("raddr", candidate.ra);
    if (candidate.rp) base.push("rport", String(candidate.rp));
    if (candidate.tc) base.push("tcptype", candidate.tc);
    return base.join(" ");
}

function formatFingerprint(noColonHex) {
    const hex = String(noColonHex || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    const chunks = [];
    for (let i = 0; i < hex.length; i += 2) {
        chunks.push(hex.slice(i, i + 2));
    }
    return chunks.join(":");
}

function normalizeSetup(type) {
    if (type === "offer") return "actpass";
    if (type === "answer") return "active";
    return "actpass";
}
