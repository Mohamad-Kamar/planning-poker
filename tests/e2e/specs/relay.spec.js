const { test, expect } = require("@playwright/test");
const { openHome } = require("../helpers");
const {
    buildConnack,
    buildSuback,
    packet,
    encodeRemainingLength
} = require("../helpers/mocks/websocket");

function mockFunctionSources() {
    return {
        encodeRemainingLength: encodeRemainingLength.toString(),
        packet: packet.toString(),
        buildConnack: buildConnack.toString(),
        buildSuback: buildSuback.toString()
    };
}

test("guest fallback starts after first failed state without waiting for second failed event", async ({ page }) => {
    await openHome(page);
    const result = await page.evaluate(async ({ fnSources }) => {
        const makeFn = (source) => eval(`(${source})`);
        const encodeRemainingLength = makeFn(fnSources.encodeRemainingLength);
        const packet = makeFn(fnSources.packet);
        const buildConnack = makeFn(fnSources.buildConnack);
        const buildSuback = makeFn(fnSources.buildSuback);

        const originalWebSocket = window.WebSocket;
        const OPEN = 1;
        let websocketCreates = 0;
        let restartCalls = 0;

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                websocketCreates += 1;
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                if (packetType === 1 && typeof this.onmessage === "function") {
                    this.onmessage({ data: buildConnack().buffer });
                }
                if (packetType === 8 && typeof this.onmessage === "function") {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    this.onmessage({ data: buildSuback(packetIdMsb, packetIdLsb).buffer });
                }
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { setupGuestPeerHandlers } = await import("/js/guest.js");
            const { els } = await import("/js/ui.js");

            state.role = "guest";
            state.currentView = "guestConnect";
            state.displayName = "GuestFallback";
            state.roomId = "room-fallback";
            state.selectedVote = null;

            const fakeDc = { send() {}, close() {} };
            const fakePc = {
                connectionState: "new",
                iceConnectionState: "new",
                restartIce() {
                    restartCalls += 1;
                }
            };

            state.guestChannel = fakeDc;
            state.guestPeer = fakePc;
            setupGuestPeerHandlers(fakePc, fakeDc);

            fakePc.connectionState = "failed";
            fakePc.onconnectionstatechange();

            await new Promise((resolve) => setTimeout(resolve, 3200));
            return {
                websocketCreates,
                restartCalls,
                notice: els.guestConnectNotice.textContent || ""
            };
        } finally {
            window.WebSocket = originalWebSocket;
        }
    }, { fnSources: mockFunctionSources() });

    expect(result.restartCalls).toBe(1);
    expect(result.websocketCreates).toBeGreaterThan(0);
    expect(result.notice).not.toContain("Retrying ICE before relay fallback");
});

test("guest relay timeout shows terminal error notice", async ({ page }) => {
    test.setTimeout(35_000);
    await openHome(page);
    const noticeText = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const OPEN = 1;

        class TimeoutWebSocket {
            static OPEN = OPEN;

            constructor() {
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(_data) {
                // Intentionally never sends CONNACK/SUBACK to trigger timeout watchdog.
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = TimeoutWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { setupGuestPeerHandlers } = await import("/js/guest.js");
            const { els } = await import("/js/ui.js");

            state.role = "guest";
            state.currentView = "guestConnect";
            state.displayName = "GuestTimeout";
            state.roomId = "room-timeout";
            state.selectedVote = null;

            const fakeDc = { send() {}, close() {} };
            const fakePc = {
                connectionState: "new",
                iceConnectionState: "new",
                restartIce() {}
            };

            state.guestChannel = fakeDc;
            state.guestPeer = fakePc;
            setupGuestPeerHandlers(fakePc, fakeDc);

            fakePc.connectionState = "failed";
            fakePc.onconnectionstatechange();

            await new Promise((resolve) => setTimeout(resolve, 14_000));
            return String(els.guestConnectNotice.textContent || "");
        } finally {
            window.WebSocket = originalWebSocket;
        }
    });

    expect(noticeText).toContain("Relay fallback failed (timeout)");
});

test("mqtt relay channel works with mocked websocket transport", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const OPEN = 1;
        const sentPacketTypes = [];

        function encodeRemainingLength(length) {
            const bytes = [];
            let value = length;
            do {
                let digit = value % 128;
                value = Math.floor(value / 128);
                if (value > 0) digit |= 0x80;
                bytes.push(digit);
            } while (value > 0);
            return Uint8Array.from(bytes);
        }

        function packet(typeAndFlags, body) {
            const payload = body || new Uint8Array(0);
            const header = Uint8Array.from([typeAndFlags]);
            const remaining = encodeRemainingLength(payload.length);
            const output = new Uint8Array(header.length + remaining.length + payload.length);
            output.set(header, 0);
            output.set(remaining, header.length);
            output.set(payload, header.length + remaining.length);
            return output;
        }

        function buildSuback(packetIdMsb, packetIdLsb) {
            return packet(0x90, Uint8Array.from([packetIdMsb, packetIdLsb, 0x00]));
        }

        function buildConnack() {
            return packet(0x20, Uint8Array.from([0x00, 0x00]));
        }

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                this.onerror = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                sentPacketTypes.push(packetType);
                if (packetType === 1) {
                    if (typeof this.onmessage === "function") {
                        this.onmessage({ data: buildConnack().buffer });
                    }
                    return;
                }
                if (packetType === 8) {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    if (typeof this.onmessage === "function") {
                        this.onmessage({ data: buildSuback(packetIdMsb, packetIdLsb).buffer });
                    }
                    return;
                }
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { createMqttRelayChannel } = await import("/js/mqtt-relay.js");
            const channel = createMqttRelayChannel("guest", "room-smoke", "guest-smoke", {
                onOpen: () => {},
                onMessage: () => {},
                onClose: () => {}
            });

            await new Promise((resolve, reject) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    if (sentPacketTypes.includes(1) && sentPacketTypes.includes(8)) {
                        clearInterval(timer);
                        resolve();
                        return;
                    }
                    if (Date.now() - started > 5000) {
                        clearInterval(timer);
                        reject(new Error("MQTT mock did not emit CONNECT and SUBSCRIBE packets in time."));
                    }
                }, 20);
            });

            channel.close();
            return {
                sawConnectPacket: sentPacketTypes.includes(1),
                sawSubscribePacket: sentPacketTypes.includes(8)
            };
        } finally {
            window.WebSocket = originalWebSocket;
        }
    });

    expect(result.sawConnectPacket).toBe(true);
    expect(result.sawSubscribePacket).toBe(true);
});
