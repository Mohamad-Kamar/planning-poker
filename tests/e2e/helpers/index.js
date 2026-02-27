const { openHome, setConnectionMode } = require("./navigation");
const { createHost, startGameFromLobby, startGameFromLobbyStrict } = require("./host");
const { connectGuestToHost, waitForGuestConnection } = require("./guest");
const { readCode, decodeSignalCodeInPage } = require("./code");
const { playerCard } = require("./locators");

module.exports = {
    openHome,
    setConnectionMode,
    createHost,
    startGameFromLobby,
    startGameFromLobbyStrict,
    connectGuestToHost,
    waitForGuestConnection,
    readCode,
    decodeSignalCodeInPage,
    playerCard
};
