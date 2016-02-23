// ==UserScript==
// @name            Better TW Friends
// @author          xShteff, Diggo11
// @match           https://*.the-west.net/game.php*
// @match           https://*.the-west.de/game.php*
// @match           https://*.the-west.pl/game.php*
// @match           https://*.the-west.nl/game.php*
// @match           https://*.the-west.se/game.php*
// @match           https://*.the-west.ro/game.php*
// @match           https://*.the-west.com.pt/game.php*
// @match           https://*.the-west.cz/game.php*
// @match           https://*.the-west.es/game.php*
// @match           https://*.the-west.ru/game.php*
// @match           https://*.the-west.com.br/game.php*
// @match           https://*.the-west.org/game.php*
// @match           https://*.the-west.hu/game.php*
// @match           https://*.the-west.gr/game.php*
// @match           https://*.the-west.dk/game.php*
// @match           https://*.the-west.sk/game.php*
// @match           https://*.the-west.fr/game.php*
// @match           https://*.the-west.it/game.php*
// @grant           none
// @run-at          document-end
// ==/UserScript==

var friends = [];
var lastSent = {};

function getActiveSesKeys() {
	return Object.keys(Game.sesData);
}

function getSesReadyCount() {
	var yesterday = Date.now()/1000 - 3600*24;
	var count = 0;
	$.each(friends, function (i, client) {
		var neverSent = !lastSent.hasOwnProperty(client.player_id);
		if (neverSent || yesterday >= lastSent[client.player_id]) {
			count++;
		}
	});
	return count;
}

function getFriendCount() {
	return friends.length;
}

function getFriendsList(resolve, reject) {
	Ajax.remoteCallMode('friendsbar', 'search', {search_type: 'friends'}, function (data) {
		var clients = $.grep(data.players, client => client.player_id !== Character.playerId);
		friends = $.map(clients, west.storage.FriendsBar.prototype.normalizeAvatars_);

		var sesKey = getActiveSesKeys()[0];
		$.each(data.eventActivations, function (i, eventActivation) {
			if (eventActivation.event_name === sesKey) {
				lastSent[eventActivation.friend_id] = eventActivation.activation_time;
			}
		});

		resolve();
	});
}

// new Promise(getFriendsList)
// .then(getSesReadyCount)
// .then(x => console.log(x));

