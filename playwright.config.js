// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./tests/e2e",
    timeout: 45_000,
    expect: {
        timeout: 15_000
    },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }]]
        : [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: "http://127.0.0.1:4173",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure"
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] }
        },
        {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] }
        }
    ],
    webServer: {
        command: "python3 -m http.server 4173",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
    }
});
