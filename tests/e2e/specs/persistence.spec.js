const { test, expect } = require("@playwright/test");
const { createHost, openHome, startGameFromLobby } = require("../helpers");

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
        state.guestAutoRejoinEnabled = true;
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
    await expect(page.locator("#tableNotice")).toContainText(/Session restored|Trying to reconnect/);
    await expect(page.locator("#connectionStatusText")).toContainText(/Reconnecting|Disconnected|Reconnect pending approval/);
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

test("stale session snapshot is ignored on startup", async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => {
        const staleSnapshot = {
            v: 1,
            savedAt: Date.now() - (13 * 60 * 60 * 1000),
            role: "host",
            localId: "hoststale123",
            displayName: "Stale Host",
            currentView: "table",
            roomId: "hoststale123",
            selectedVote: "8",
            session: {
                round: 4,
                roundTitle: "Stale Round",
                started: true,
                revealed: false,
                players: {
                    hoststale123: {
                        id: "hoststale123",
                        name: "Stale Host",
                        connected: true,
                        vote: "8",
                        isHost: true
                    }
                }
            }
        };
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(staleSnapshot));
    });

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();
    await expect(page.locator("#tableView.active")).toHaveCount(0);
});

test("corrupt session snapshot is cleared and app boots safely", async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => {
        window.sessionStorage.setItem("planningPoker.session", "{not-json");
    });

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();

    const persisted = await page.evaluate(() => window.sessionStorage.getItem("planningPoker.session"));
    expect(persisted).toBeNull();
});

test("host can approve and reject unknown guest rejoin requests", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostApprove");

    await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { renderHostLobby } = await import("/js/render.js");
        const { showView } = await import("/js/ui.js");

        const sent = [];
        state.hostRecoveryRelay = {
            readyState: "open",
            send(data) {
                sent.push(JSON.parse(String(data)));
            },
            close() {}
        };
        state.hostPendingRejoinRequests = [
            { id: "guest-unknown-1", name: "Unknown One", requestedAt: Date.now() },
            { id: "guest-unknown-2", name: "Unknown Two", requestedAt: Date.now() }
        ];
        window.__rejoinSent = sent;
        showView("hostLobby");
        renderHostLobby();
    });

    await expect(page.locator("#hostPendingRejoinPanel")).toBeVisible();
    await expect(page.locator("#hostPendingRejoinList")).toContainText("Unknown One");
    await expect(page.locator("#hostPendingRejoinList")).toContainText("Unknown Two");

    await page.locator('[data-approve-rejoin="guest-unknown-1"]').click();
    await expect(page.locator("#hostPlayerList")).toContainText("Unknown One");

    await page.locator('[data-reject-rejoin="guest-unknown-2"]').click();
    await expect(page.locator("#hostPendingRejoinList")).not.toContainText("Unknown Two");

    const sentMessages = await page.evaluate(() => window.__rejoinSent || []);
    expect(sentMessages.some((msg) => msg.t === "rejoinAck" && msg.to === "guest-unknown-1")).toBe(true);
    expect(sentMessages.some((msg) => msg.t === "rejoinReject" && msg.to === "guest-unknown-2")).toBe(true);
});

test("guest table disconnect starts auto-rejoin loop", async ({ page }) => {
    await openHome(page);
    const result = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const OPEN = 1;
        let websocketCreates = 0;

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                websocketCreates += 1;
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(_data) {
                // Keep relay session open without host ack.
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { onHostChannelClose } = await import("/js/guest.js");
            const { els, showView } = await import("/js/ui.js");
            const { renderTable } = await import("/js/render.js");

            state.role = "guest";
            state.displayName = "GuestAuto";
            state.roomId = "room-auto";
            state.guestAutoRejoinEnabled = true;
            state.guestRemoteState = {
                round: 2,
                roundTitle: "Auto Rejoin",
                started: true,
                revealed: false,
                players: []
            };
            showView("table");
            renderTable();

            const fakeChannel = {
                readyState: "open",
                close() {}
            };
            state.guestChannel = fakeChannel;
            onHostChannelClose(fakeChannel);
            await new Promise((resolve) => setTimeout(resolve, 1200));

            return {
                websocketCreates,
                notice: String(els.tableNotice.textContent || ""),
                status: String(els.connectionStatusText.textContent || "")
            };
        } finally {
            window.WebSocket = originalWebSocket;
        }
    });

    expect(result.websocketCreates).toBeGreaterThan(0);
    expect(result.notice).toMatch(/Trying to reconnect|Connection closed/);
    expect(result.status).toMatch(/Reconnecting|Disconnected/);
});
