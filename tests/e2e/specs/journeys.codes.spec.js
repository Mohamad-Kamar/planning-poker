const { test, expect } = require("@playwright/test");
const { createHost, openHome, readCode, setConnectionMode } = require("../helpers");

function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, "");
}

test("host clear button resets incoming join code textarea", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostClearAction");
    await page.locator("#hostManualFallbackDetails > summary").click();

    await page.getByTestId("input-host-join-code").fill("some-join-code");
    await page.getByTestId("btn-clear-host-join-code").click();
    await expect(page.getByTestId("input-host-join-code")).toHaveValue("");
});

test("guest regenerate creates a fresh join code and resets step state", async ({ page }) => {
    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
    await page.locator("#displayNameInput").fill("GuestRegenerate");
    await page.getByTestId("btn-join-room").click();

    const firstCode = await readCode(page.locator("#guestJoinCode"));
    await page.locator("#guestResponseCodeInput").fill("invalid-response");
    await page.locator("#connectGuestBtn").click();
    await expect(page.locator("#guestStep2")).toHaveClass(/active/);

    await page.getByTestId("btn-regenerate-guest-join").click();
    await expect(page.locator("#guestStep1")).toHaveClass(/active/);
    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    const secondCode = await readCode(page.locator("#guestJoinCode"));
    expect(normalizeWhitespace(secondCode)).not.toBe(normalizeWhitespace(firstCode));
});

test("guest copy plain and formatted buttons copy expected values", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.__copiedTexts = [];
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: async (text) => {
                    window.__copiedTexts.push(String(text));
                }
            }
        });
    });
    const page = await context.newPage();

    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
    await page.locator("#displayNameInput").fill("GuestCopy");
    await page.getByTestId("btn-join-room").click();
    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();

    await page.getByTestId("btn-copy-guest-join-plain").click();
    await page.getByTestId("btn-copy-guest-join-formatted").click();

    const copied = await page.evaluate(() => window.__copiedTexts || []);
    expect(copied.length).toBeGreaterThanOrEqual(2);

    const rawCode = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        return state.guestJoinCodeRaw;
    });
    expect(copied[0]).toBe(rawCode);
    expect(normalizeWhitespace(copied[1])).toBe(normalizeWhitespace(rawCode));
});

test("host copy plain and formatted response buttons copy expected values", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.__copiedTexts = [];
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: async (text) => {
                    window.__copiedTexts.push(String(text));
                }
            }
        });
    });
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await setConnectionMode(host, "manualWebRtc");
    await setConnectionMode(guest, "manualWebRtc");
    await createHost(host, "HostCopy");
    await guest.locator("#displayNameInput").fill("GuestCopyHost");
    await guest.getByTestId("btn-join-room").click();
    const joinCode = await readCode(guest.locator("#guestJoinCode"));

    await host.getByTestId("input-host-join-code").fill(joinCode);
    await host.getByTestId("btn-accept-guest").click();
    await expect(host.getByTestId("btn-copy-host-response-plain")).toBeEnabled();

    await host.getByTestId("btn-copy-host-response-plain").click();
    await host.getByTestId("btn-copy-host-response-formatted").click();

    const copied = await host.evaluate(() => window.__copiedTexts || []);
    expect(copied.length).toBeGreaterThanOrEqual(2);

    const rawCode = await host.evaluate(async () => {
        const { state } = await import("/js/state.js");
        return state.hostResponseCodeRaw;
    });
    expect(copied[0]).toBe(rawCode);
    expect(normalizeWhitespace(copied[1])).toBe(normalizeWhitespace(rawCode));
});
