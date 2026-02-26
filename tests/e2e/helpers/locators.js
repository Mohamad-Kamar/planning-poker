function playerCard(page, playerName) {
    return page.locator("#tablePlayersGrid .player-card", { hasText: playerName }).first();
}

module.exports = {
    playerCard
};
