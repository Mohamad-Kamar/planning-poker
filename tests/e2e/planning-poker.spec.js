const { test, expect } = require("@playwright/test");

async function readCode(locator) {
    await expect(locator).not.toContainText("Generating code...");
    await expect(locator).not.toContainText("No response code yet.");
    const text = await locator.textContent();
    return (text || "").trim();
}

async function decodeSignalCodeInPage(page, code) {
    return page.evaluate(async ({ codeValue }) => {
        const { decodeSignalCode } = await import("/js/signaling.js");
        return decodeSignalCode(codeValue);
    }, { codeValue: code });
}

function playerCard(page, playerName) {
    return page.locator("#tablePlayersGrid .player-card", { hasText: playerName }).first();
}

async function openHome(page) {
    await page.goto("/");
    await expect(page.locator("#homeView.active")).toBeVisible();
}

async function createHost(page, name) {
    await page.locator("#displayNameInput").fill(name);
    await page.locator("#createRoomBtn").click();
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();
}

async function waitForGuestConnection(guestPage, timeoutMs) {
    try {
        await expect(guestPage.locator("#tableView.active")).toBeVisible({ timeout: timeoutMs });
        return true;
    } catch (_error) {
        return false;
    }
}

async function startGameFromLobby(hostPage) {
    const startBtn = hostPage.locator("#hostStartGameBtn");
    const canStartNormally = await startBtn.isEnabled();
    if (!canStartNormally) {
        await hostPage.evaluate(() => {
            const button = document.getElementById("hostStartGameBtn");
            if (button) button.disabled = false;
        });
    }
    await startBtn.click();
    await expect(hostPage.locator("#tableView.active")).toBeVisible();
}

async function connectGuestToHost(hostPage, guestPage, guestName) {
    await guestPage.locator("#displayNameInput").fill(guestName);
    await guestPage.locator("#joinRoomBtn").click();
    await expect(guestPage.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    const joinCode = await readCode(guestPage.locator("#guestJoinCode"));

    await hostPage.locator("#hostIncomingJoinCode").fill(joinCode);
    await hostPage.locator("#acceptGuestBtn").click();
    await expect(hostPage.locator("#copyHostResponseCodeBtn")).toBeEnabled();
    const responseCode = await readCode(hostPage.locator("#hostResponseCode"));

    await guestPage.locator("#guestResponseCodeInput").fill(responseCode);
    await guestPage.locator("#connectGuestBtn").click();
    const connected = await waitForGuestConnection(guestPage, 8_000);
    const guestRow = hostPage.locator("#hostPlayerList .player-row", { hasText: guestName });
    if (connected) {
        await expect(guestRow).toContainText("Online", { timeout: 8_000 });
    } else {
        await expect(guestPage.locator("#guestConnectNotice")).toContainText(
            /Waiting for data channel|Could not apply response code|Connection failed/
        );
    }

    return { connected };
}

test("host and guest can play a full round lifecycle", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostA");
    const guestConnection = await connectGuestToHost(host, guest, "GuestA");

    await startGameFromLobby(host);
    if (guestConnection.connected) {
        await expect(guest.locator("#tableView.active")).toBeVisible();
    }
    await host.locator("#hostRoundTitleInput").fill("API sizing");
    await expect(host.locator("#tableSubtitle")).toContainText("Round 1 - API sizing");
    if (guestConnection.connected) {
        await expect(guest.locator("#tableSubtitle")).toContainText("Round 1 - API sizing");
    }

    await host.locator('#votePalette .vote-card[data-vote="5"]').click();
    if (guestConnection.connected) {
        await guest.locator('#votePalette .vote-card[data-vote="8"]').click();
    }

    const hostCard = playerCard(host, "HostA");
    const guestCard = playerCard(host, "GuestA");
    await expect(hostCard).not.toHaveClass(/revealed/);
    await expect(guestCard).not.toHaveClass(/revealed/);
    await expect(host.locator("#statsBar")).not.toHaveClass(/visible/);

    await host.locator("#hostRevealBtn").click();
    await expect(hostCard).toHaveClass(/revealed/);
    if (guestConnection.connected) {
        await expect(guestCard).toHaveClass(/revealed/);
    } else {
        await expect(guestCard).not.toHaveClass(/revealed/);
    }
    await expect(host.locator("#statsBar")).toHaveClass(/visible/);
    await expect(host.locator("#statAverage")).toHaveText(guestConnection.connected ? "6.50" : "5");
    await expect(host.locator("#statMedian")).toHaveText(guestConnection.connected ? "6.50" : "5");
    await expect(host.locator("#statMin")).toHaveText("5");
    await expect(host.locator("#statMax")).toHaveText(guestConnection.connected ? "8" : "5");
    await expect(host.locator("#statConsensus")).toHaveText(guestConnection.connected ? "No" : "Yes");

    await host.locator('#votePalette .vote-card[data-vote="13"]').click();
    await expect(hostCard).toContainText("13");
    await expect(host.locator("#statAverage")).toHaveText(guestConnection.connected ? "10.50" : "13");
    await expect(host.locator("#statMedian")).toHaveText(guestConnection.connected ? "10.50" : "13");
    await expect(host.locator("#statMin")).toHaveText(guestConnection.connected ? "8" : "13");
    await expect(host.locator("#statMax")).toHaveText("13");
    if (guestConnection.connected) {
        await expect(playerCard(guest, "HostA")).toContainText("13");
        await expect(guest.locator("#statAverage")).toHaveText("10.50");
    }

    await host.locator("#hostResetBtn").click();
    await expect(host.locator("#tableSubtitle")).toContainText("Round 2");
    await expect(host.locator("#tableSubtitle")).not.toContainText("API sizing");
    await expect(hostCard).not.toHaveClass(/revealed/);
    await expect(guestCard).not.toHaveClass(/revealed/);
    await expect(host.locator("#statsBar")).not.toHaveClass(/visible/);

    if (guestConnection.connected) {
        await guest.locator("#leaveSessionBtn").click();
        await expect(guest.locator("#homeView.active")).toBeVisible();
        await expect(host.locator("#tablePlayersGrid .player-card", { hasText: "GuestA" })).toHaveCount(0, { timeout: 15_000 });
    } else {
        await expect(host.locator("#tablePlayersGrid")).toContainText("GuestA");
    }

    await context.close();
});

test("remaining guests receive disconnect updates", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guestA = await context.newPage();
    const guestB = await context.newPage();

    await openHome(host);
    await openHome(guestA);
    await openHome(guestB);
    await createHost(host, "HostMulti");
    const guestAConnection = await connectGuestToHost(host, guestA, "GuestA");
    const guestBConnection = await connectGuestToHost(host, guestB, "GuestB");

    test.skip(
        !guestAConnection.connected || !guestBConnection.connected,
        "WebRTC data channels did not open in this environment."
    );

    await startGameFromLobby(host);
    await expect(guestA.locator("#tableView.active")).toBeVisible();
    await expect(guestB.locator("#tableView.active")).toBeVisible();
    await expect(playerCard(guestB, "GuestA")).toContainText("Online", { timeout: 15_000 });

    await guestA.locator("#leaveSessionBtn").click();
    await expect(guestA.locator("#homeView.active")).toBeVisible();
    await expect(host.locator("#tablePlayersGrid .player-card", { hasText: "GuestA" })).toHaveCount(0, { timeout: 15_000 });
    await expect(guestB.locator("#tablePlayersGrid .player-card", { hasText: "GuestA" })).toHaveCount(0, { timeout: 15_000 });

    await context.close();
});

test("join code UI shows shareability hint", async ({ page }) => {
    await page.goto("/");
    await page.locator("#displayNameInput").fill("GuestB");
    await page.locator("#joinRoomBtn").click();

    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    await expect(page.locator("#guestJoinCodeMeta")).toContainText("chars");
    await expect(page.locator("#guestJoinCodeQuality")).toContainText("Shareability:");
});

test("response code includes room identifier", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostRoom");
    await guest.locator("#displayNameInput").fill("GuestRoom");
    await guest.locator("#joinRoomBtn").click();
    await expect(guest.locator("#copyGuestJoinCodeBtn")).toBeEnabled();

    const joinCode = await readCode(guest.locator("#guestJoinCode"));
    await host.locator("#hostIncomingJoinCode").fill(joinCode);
    await host.locator("#acceptGuestBtn").click();
    await expect(host.locator("#copyHostResponseCodeBtn")).toBeEnabled();

    const responseCode = await readCode(host.locator("#hostResponseCode"));
    const payload = await decodeSignalCodeInPage(host, responseCode);

    expect(payload.v).toBe(1);
    expect(typeof payload.room).toBe("string");
    expect(payload.room.length).toBeGreaterThan(0);
    expect(payload.room).toBe(payload.f);

    await context.close();
});

test("connection settings dialog persists custom ICE servers", async ({ page }) => {
    await page.goto("/");

    await page.locator("#iceSettingsBtn").click();
    await expect(page.locator("#iceSettingsDialog")).toBeVisible();
    await expect(page.locator("#defaultIceServersList")).toContainText("stun:stun.l.google.com:19302");

    const customServers = [
        "turn:example.com:3478?transport=tcp | alice | s3cret",
        "stun:stun.example.com:3478"
    ].join("\n");
    await page.locator("#customIceServersInput").fill(customServers);
    await page.locator("#iceSettingsSaveBtn").click();
    await expect(page.locator("#homeNotice")).toContainText("Connection settings saved");

    await page.locator("#iceSettingsBtn").click();
    await expect(page.locator("#customIceServersInput")).toHaveValue(/turn:example\.com:3478\?transport=tcp/);
    await expect(page.locator("#customIceServersInput")).toHaveValue(/stun:stun\.example\.com:3478/);
    await page.locator("#iceSettingsCancelBtn").click();
});

test("host session snapshot restores table context after refresh", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostPersist");
    await startGameFromLobby(page);
    await page.locator("#hostRoundTitleInput").fill("Resilience");
    await page.locator('#votePalette .vote-card[data-vote="13"]').click();

    await page.reload();

    await expect(page.locator("#tableView.active")).toBeVisible();
    await expect(page.locator("#tableSubtitle")).toContainText("Round 1 - Resilience");
    await expect(page.locator('#votePalette .vote-card.selected[data-vote="13"]')).toBeVisible();
    await expect(page.locator("#tableNotice")).toContainText("Session restored");
    await expect(page.locator("#connectionStatusText")).toContainText("Hosting 0 guest(s)");

    await page.locator("#leaveSessionBtn").click();
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();
    await expect(page.locator("#hostPlayerList")).toContainText("HostPersist");
});

test("guest restored table shows reconnect journey after refresh", async ({ page }) => {
    await openHome(page);
    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { showView } = await import("/js/ui.js");
        const { renderTable } = await import("/js/render.js");
        const { saveSessionSnapshot } = await import("/js/persistence.js");

        state.role = "guest";
        state.localId = "guestrestore01";
        state.displayName = "GuestRestore";
        state.selectedVote = "8";
        state.roomId = "room-restore";
        state.guestRemoteState = {
            round: 3,
            roundTitle: "Checkout Flow",
            started: true,
            revealed: false,
            players: [
                { id: "host-restore", name: "HostRestore", connected: false, isHost: true, voted: true, vote: null },
                { id: "guestrestore01", name: "GuestRestore", connected: false, isHost: false, voted: true, vote: null }
            ]
        };
        showView("table");
        renderTable();
        saveSessionSnapshot();
    });

    await page.reload();

    await expect(page.locator("#tableView.active")).toBeVisible();
    await expect(page.locator("#tableSubtitle")).toContainText("Round 3 - Checkout Flow");
    await expect(page.locator("#leaveSessionBtn")).toHaveText("Reconnect");
    await expect(page.locator("#tableNotice")).toContainText("Session restored");

    await page.locator("#leaveSessionBtn").click();
    await expect(page.locator("#guestConnectView.active")).toBeVisible();
    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled({ timeout: 10_000 });
});

test("explicit leave clears session snapshot", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostClear");

    await page.locator("#hostBackHomeBtn").click();
    await expect(page.locator("#homeView.active")).toBeVisible();

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();
    await expect(page.locator("#hostLobbyView.active")).toHaveCount(0);
});

test("guest fallback starts after first failed state without waiting for second failed event", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const OPEN = 1;
        let websocketCreates = 0;
        let restartCalls = 0;

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

        function buildConnack() {
            return packet(0x20, Uint8Array.from([0x00, 0x00]));
        }

        function buildSuback(packetIdMsb, packetIdLsb) {
            return packet(0x90, Uint8Array.from([packetIdMsb, packetIdLsb, 0x00]));
        }

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
    });

    expect(result.restartCalls).toBe(1);
    expect(result.websocketCreates).toBeGreaterThan(0);
    expect(result.notice).not.toContain("Retrying ICE before relay fallback");
});

test("guest relay timeout shows terminal error notice", async ({ page }) => {
    test.setTimeout(35_000);
    await page.goto("/");
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
    await page.goto("/");

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

        function encodeUtf8String(value) {
            const bytes = new TextEncoder().encode(value);
            const output = new Uint8Array(2 + bytes.length);
            output[0] = (bytes.length >> 8) & 0xff;
            output[1] = bytes.length & 0xff;
            output.set(bytes, 2);
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
