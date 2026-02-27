const { test, expect } = require("@playwright/test");
const { openHome } = require("../helpers");

function hostSnapshot(overrides = {}) {
    return {
        v: 1,
        savedAt: Date.now(),
        role: "host",
        localId: "hostcontract01",
        displayName: "Host Contract",
        currentView: "home",
        roomId: "hostcontract01",
        selectedVote: "5",
        session: {
            round: 3,
            roundTitle: "Contract Round",
            started: true,
            revealed: false,
            players: {
                hostcontract01: {
                    id: "hostcontract01",
                    name: "Host Contract",
                    connected: true,
                    vote: "5",
                    isHost: true
                }
            }
        },
        ...overrides
    };
}

function guestSnapshot(overrides = {}) {
    return {
        v: 1,
        savedAt: Date.now(),
        role: "guest",
        localId: "guestcontract01",
        displayName: "Guest Contract",
        currentView: "home",
        roomId: "room-contract",
        selectedVote: "8",
        guestRemoteState: {
            round: 2,
            roundTitle: "Remote Contract",
            started: false,
            revealed: false,
            players: []
        },
        ...overrides
    };
}

test("host snapshot normalizes unsupported view to host lobby", async ({ page }) => {
    await openHome(page);
    await page.evaluate((snapshot) => {
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(snapshot));
    }, hostSnapshot());

    await page.reload();
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();
    await expect(page.locator("#tableView.active")).toHaveCount(0);
});

test("guest snapshot normalizes unsupported view to guest connect", async ({ page }) => {
    await openHome(page);
    await page.evaluate((snapshot) => {
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(snapshot));
    }, guestSnapshot());

    await page.reload();
    await expect(page.locator("#guestConnectView.active")).toBeVisible();
    await expect(page.locator("#tableView.active")).toHaveCount(0);
});

test("invalid snapshot localId is cleared on boot", async ({ page }) => {
    await openHome(page);
    await page.evaluate((snapshot) => {
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(snapshot));
    }, hostSnapshot({ localId: "x".repeat(100) }));

    await page.reload();
    await expect(page.locator("#homeView.active")).toBeVisible();

    const persisted = await page.evaluate(() => window.sessionStorage.getItem("planningPoker.session"));
    expect(persisted).toBeNull();
});

test("host snapshot restores approved guest IDs for rejoin auto-approval", async ({ page }) => {
    await openHome(page);
    await page.evaluate((snapshot) => {
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(snapshot));
    }, hostSnapshot({
        hostApprovedGuestIds: ["guest-known-1", "guest-known-2", "guest-known-1", "hostcontract01", ""]
    }));

    await page.reload();
    const approvedIds = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        return state.hostApprovedGuestIds;
    });
    expect(approvedIds).toEqual(["guest-known-1", "guest-known-2"]);
});

test("legacy host snapshot derives approved guests from players", async ({ page }) => {
    await openHome(page);
    await page.evaluate((snapshot) => {
        window.sessionStorage.setItem("planningPoker.session", JSON.stringify(snapshot));
    }, hostSnapshot({
        session: {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: {
                hostcontract01: {
                    id: "hostcontract01",
                    name: "Host Contract",
                    connected: true,
                    vote: null,
                    isHost: true
                },
                guestlegacy01: {
                    id: "guestlegacy01",
                    name: "Legacy Guest",
                    connected: false,
                    vote: null,
                    isHost: false
                }
            }
        }
    }));

    await page.reload();
    const approvedIds = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        return state.hostApprovedGuestIds;
    });
    expect(approvedIds).toEqual(["guestlegacy01"]);
});
