import { log } from "./log.js";

const MQTT_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";
const MQTT_PROTOCOL_LEVEL = 4;
const MQTT_KEEP_ALIVE_SECONDS = 30;
const PING_INTERVAL_MS = 20_000;
const CONNECT_TIMEOUT_MS = 10_000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeString(value) {
    const bytes = textEncoder.encode(String(value || ""));
    const output = new Uint8Array(2 + bytes.length);
    output[0] = (bytes.length >> 8) & 0xff;
    output[1] = bytes.length & 0xff;
    output.set(bytes, 2);
    return output;
}

function concatBytes(parts) {
    let totalLength = 0;
    for (const part of parts) totalLength += part.length;
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function encodeRemainingLength(length) {
    const bytes = [];
    let value = length;
    do {
        let digit = value % 128;
        value = Math.floor(value / 128);
        if (value > 0) digit |= 0x80;
        bytes.push(digit);
    } while (value > 0);
    return new Uint8Array(bytes);
}

function buildPacket(packetTypeAndFlags, bodyBytes) {
    const body = bodyBytes || new Uint8Array(0);
    return concatBytes([
        new Uint8Array([packetTypeAndFlags]),
        encodeRemainingLength(body.length),
        body
    ]);
}

function decodeRemainingLength(bytes, offset) {
    let multiplier = 1;
    let value = 0;
    let index = offset;
    let encodedByte;
    do {
        if (index >= bytes.length) return null;
        encodedByte = bytes[index++];
        value += (encodedByte & 0x7f) * multiplier;
        multiplier *= 128;
    } while ((encodedByte & 0x80) !== 0);
    return { value, bytesUsed: index - offset };
}

function buildConnectPacket(clientId) {
    const variableHeader = concatBytes([
        encodeString("MQTT"),
        new Uint8Array([MQTT_PROTOCOL_LEVEL, 0x02, (MQTT_KEEP_ALIVE_SECONDS >> 8) & 0xff, MQTT_KEEP_ALIVE_SECONDS & 0xff])
    ]);
    const payload = encodeString(clientId);
    return buildPacket(0x10, concatBytes([variableHeader, payload]));
}

function buildSubscribePacket(packetId, topic) {
    const variableHeader = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
    const payload = concatBytes([encodeString(topic), new Uint8Array([0x00])]);
    return buildPacket(0x82, concatBytes([variableHeader, payload]));
}

function buildPublishPacket(topic, messageBytes) {
    const payloadBytes = messageBytes instanceof Uint8Array ? messageBytes : textEncoder.encode(String(messageBytes || ""));
    const variableHeader = encodeString(topic);
    return buildPacket(0x30, concatBytes([variableHeader, payloadBytes]));
}

function parsePublishPayload(body) {
    if (body.length < 2) return null;
    const topicLength = (body[0] << 8) | body[1];
    const topicStart = 2;
    const topicEnd = topicStart + topicLength;
    if (topicEnd > body.length) return null;
    const topic = textDecoder.decode(body.subarray(topicStart, topicEnd));
    const payload = textDecoder.decode(body.subarray(topicEnd));
    return { topic, payload };
}

class SimpleMqttClient {
    constructor({ clientId, subscribeTopic, onOpen, onMessage, onClose, onFailure }) {
        this.clientId = clientId;
        this.subscribeTopic = subscribeTopic;
        this.onOpen = onOpen;
        this.onMessage = onMessage;
        this.onClose = onClose;
        this.onFailure = onFailure;
        this.ws = null;
        this.packetId = 1;
        this.buffer = new Uint8Array(0);
        this.isConnected = false;
        this.isSubscribed = false;
        this.pingTimer = null;
        this.connectTimer = null;
        this.failureNotified = false;
    }

    connect() {
        if (this.ws) return;
        log.info("mqtt", "MQTT relay connect attempt", {
            clientId: this.clientId,
            subscribeTopic: this.subscribeTopic
        });
        const ws = new WebSocket(MQTT_BROKER_URL);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
            log.info("mqtt", "MQTT websocket open", { clientId: this.clientId });
            this.sendRaw(buildConnectPacket(this.clientId));
        };
        ws.onmessage = (event) => {
            const bytes = new Uint8Array(event.data);
            this.buffer = concatBytes([this.buffer, bytes]);
            this.processFrames();
        };
        ws.onerror = () => {
            log.warn("mqtt", "MQTT socket error", { clientId: this.clientId, subscribeTopic: this.subscribeTopic });
            this.notifyFailure("socket_error");
        };
        ws.onclose = () => {
            this.clearConnectTimer();
            if (!this.isSubscribed) {
                this.notifyFailure("closed_before_open");
            }
            this.teardown();
            if (typeof this.onClose === "function") this.onClose();
        };
        this.ws = ws;
        this.startConnectTimer();
    }

    close() {
        this.clearConnectTimer();
        if (!this.ws) return;
        try {
            this.ws.close();
        } catch (_error) {
            // Ignore socket close failures.
        }
    }

    send(topic, textPayload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSubscribed) {
            throw new Error("MQTT relay is not open.");
        }
        this.sendRaw(buildPublishPacket(topic, textPayload));
    }

    nextPacketId() {
        const id = this.packetId;
        this.packetId += 1;
        if (this.packetId > 0xffff) this.packetId = 1;
        return id;
    }

    sendRaw(bytes) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(bytes);
    }

    processFrames() {
        let offset = 0;
        while (offset < this.buffer.length) {
            if (offset + 2 > this.buffer.length) break;
            const header = this.buffer[offset];
            const remaining = decodeRemainingLength(this.buffer, offset + 1);
            if (!remaining) break;
            const frameStart = offset + 1 + remaining.bytesUsed;
            const frameEnd = frameStart + remaining.value;
            if (frameEnd > this.buffer.length) break;
            const body = this.buffer.subarray(frameStart, frameEnd);
            this.handleFrame(header, body);
            offset = frameEnd;
        }
        this.buffer = this.buffer.subarray(offset);
    }

    handleFrame(header, body) {
        const packetType = header >> 4;
        if (packetType === 2) {
            this.isConnected = body.length >= 2 && body[1] === 0;
            if (!this.isConnected) {
                log.warn("mqtt", "MQTT CONNACK refused", { clientId: this.clientId, code: body[1] });
                this.notifyFailure("connack_refused", { code: body[1] });
                this.close();
                return;
            }
            const packetId = this.nextPacketId();
            this.sendRaw(buildSubscribePacket(packetId, this.subscribeTopic));
            return;
        }

        if (packetType === 9) {
            this.isSubscribed = true;
            this.clearConnectTimer();
            this.startPingLoop();
            if (typeof this.onOpen === "function") this.onOpen();
            return;
        }

        if (packetType === 3) {
            const parsed = parsePublishPayload(body);
            if (parsed && typeof this.onMessage === "function") {
                this.onMessage(parsed.topic, parsed.payload);
            }
            return;
        }

        if (packetType === 13) {
            return;
        }
    }

    startPingLoop() {
        this.stopPingLoop();
        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendRaw(new Uint8Array([0xc0, 0x00]));
            }
        }, PING_INTERVAL_MS);
    }

    stopPingLoop() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    startConnectTimer() {
        this.clearConnectTimer();
        this.connectTimer = setTimeout(() => {
            if (this.isSubscribed) return;
            log.warn("mqtt", "MQTT relay connect timeout", {
                clientId: this.clientId,
                timeoutMs: CONNECT_TIMEOUT_MS
            });
            this.notifyFailure("timeout", { timeoutMs: CONNECT_TIMEOUT_MS });
            this.close();
        }, CONNECT_TIMEOUT_MS);
    }

    clearConnectTimer() {
        if (!this.connectTimer) return;
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
    }

    notifyFailure(reason, detail = {}) {
        if (this.failureNotified) return;
        this.failureNotified = true;
        if (typeof this.onFailure === "function") {
            this.onFailure({ reason, ...detail });
        }
    }

    teardown() {
        this.stopPingLoop();
        this.clearConnectTimer();
        this.isConnected = false;
        this.isSubscribed = false;
        this.ws = null;
        this.buffer = new Uint8Array(0);
    }
}

function getTopics(roomId) {
    const safeRoomId = String(roomId || "").trim();
    return {
        hostInbound: "pp/" + safeRoomId + "/h",
        guestInboundRoot: "pp/" + safeRoomId + "/g"
    };
}

function getGuestInboundTopic(roomId, guestId) {
    const topics = getTopics(roomId);
    const safeGuestId = String(guestId || "").trim();
    return topics.guestInboundRoot + "/" + safeGuestId;
}

export function createMqttRelayChannel(role, roomId, localId, callbacks = {}) {
    const normalizedRole = role === "host" ? "host" : "guest";
    const topics = getTopics(roomId);
    const subscribeTopic = normalizedRole === "host"
        ? topics.hostInbound
        : getGuestInboundTopic(roomId, localId);
    const publishTopic = topics.hostInbound;
    const clientId = "planning-poker-" + normalizedRole + "-" + String(localId || "").slice(0, 12) + "-" + Date.now().toString(36);

    const channel = {
        readyState: "connecting",
        transportType: "mqtt-relay",
        relayKey: normalizedRole + ":" + String(roomId || ""),
        onopen: null,
        onclose: null,
        onmessage: null,
        close() {
            mqttClient.close();
        },
        send(data) {
            const payload = String(data || "");
            if (normalizedRole === "guest") {
                const wrapped = JSON.stringify({ _from: localId, _d: payload });
                mqttClient.send(publishTopic, wrapped);
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(payload);
            } catch (_error) {
                throw new Error("Host relay payload must be JSON.");
            }
            const toGuestId = typeof parsed.to === "string" ? parsed.to.trim() : "";
            if (!toGuestId) {
                throw new Error("Host relay message is missing target guest id.");
            }
            mqttClient.send(getGuestInboundTopic(roomId, toGuestId), payload);
        }
    };

    const mqttClient = new SimpleMqttClient({
        clientId,
        subscribeTopic,
        onOpen: () => {
            channel.readyState = "open";
            if (typeof callbacks.onOpen === "function") callbacks.onOpen(channel);
            if (typeof channel.onopen === "function") channel.onopen();
            log.info("mqtt", "MQTT relay channel open", { role: normalizedRole, roomId: String(roomId || "") });
        },
        onMessage: (_topic, payload) => {
            if (normalizedRole === "host") {
                let envelope;
                try {
                    envelope = JSON.parse(payload);
                } catch (_error) {
                    return;
                }
                if (!envelope || typeof envelope !== "object" || typeof envelope._d !== "string") return;
                const fromGuestId = String(envelope._from || "");
                if (typeof callbacks.onMessage === "function") callbacks.onMessage(envelope._d, fromGuestId);
                if (typeof channel.onmessage === "function") channel.onmessage({ data: envelope._d, guestId: fromGuestId });
                return;
            }
            if (typeof callbacks.onMessage === "function") callbacks.onMessage(payload, null);
            if (typeof channel.onmessage === "function") channel.onmessage({ data: payload });
        },
        onClose: () => {
            channel.readyState = "closed";
            if (typeof callbacks.onClose === "function") callbacks.onClose();
            if (typeof channel.onclose === "function") channel.onclose();
            log.warn("mqtt", "MQTT relay channel closed", { role: normalizedRole, roomId: String(roomId || "") });
        },
        onFailure: (errorInfo) => {
            if (typeof callbacks.onFailure === "function") {
                callbacks.onFailure(errorInfo);
            }
            log.warn("mqtt", "MQTT relay channel failure", {
                role: normalizedRole,
                roomId: String(roomId || ""),
                ...errorInfo
            });
        }
    });

    mqttClient.connect();
    return channel;
}
