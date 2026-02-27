const {
    openHome,
    openConnectionSettings,
    saveConnectionSettings,
    setConnectionMode,
    setConnectionModeForPages,
    setConnectionPreferences
} = require("./navigation");
const { createHost, startGameFromLobby, startGameFromLobbyStrict } = require("./host");
const { connectGuestToHost, waitForGuestConnection } = require("./guest");
const { readCode, decodeSignalCodeInPage } = require("./code");
const { playerCard } = require("./locators");

module.exports = {
    openHome,
    openConnectionSettings,
    saveConnectionSettings,
    setConnectionMode,
    setConnectionModeForPages,
    setConnectionPreferences,
    createHost,
    startGameFromLobby,
    startGameFromLobbyStrict,
    connectGuestToHost,
    waitForGuestConnection,
    readCode,
    decodeSignalCodeInPage,
    playerCard
};
