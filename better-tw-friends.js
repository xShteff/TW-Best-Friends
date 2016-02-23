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

/**
 * An array of Chat.Resource.Client-like (mostly) plain objects
 * @type {Array}
 */
var friends = [];

/**
 * A map of player ids to unix timestamps
 * @type {Object}
 */
var lastSent = {};

/**
 * Returns a list of keys for active events, eg Hearts. Practically guaranteed to have a length of 0 if no events are
 * running and a length of 1 otherwise (2 or more = internal beta only).
 * @returns {Array}
 */
function getActiveSesKeys() {
	return Object.keys(Game.sesData);
}

/**
 * Returns the number of friends you can currently send ses currency to. Friends list must be initiated first.
 * @returns {Number}
 */
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

/**
 * Returns the total number of friends you have. Friends list must be initiated first.
 * @returns {Number}
 */
function getFriendCount() {
	return friends.length;
}

/**
 * Initiates the friend list and its twin, the last sent list. Do NOT run before establishing an event is ongoing.
 * Returns a promise with the message from the server, if any, but consider it void if resolved successfully.
 * @returns {Promise}
 */
function getFriendsList() {
	return new Promise(function (resolve, reject) {
		Ajax.remoteCallMode('friendsbar', 'search', {search_type: 'friends'}, function (data) {
			if (data.error) {
				return reject(data.msg);
			}

			var clients = $.grep(data.players, client => client.player_id !== Character.playerId);
			friends = $.map(clients, west.storage.FriendsBar.prototype.normalizeAvatars_);

			var sesKey = getActiveSesKeys()[0];
			$.each(data.eventActivations, function (i, eventActivation) {
				if (eventActivation.event_name === sesKey) {
					lastSent[eventActivation.friend_id] = eventActivation.activation_time;
				}
			});

			return resolve(data.msg);
		});
	});
}

/**
 * Sends ses currency to a friend. Do NOT run before establishing an event is ongoing, even if you somehow obtain a
 * friend id without initiating the friend list first (congratulations). Returns a promise with the response message.
 * @param {Number} friendId
 * @returns {Promise}
 */
function sendSesCurrency(friendId) {
	return new Promise(function (resolve, reject) {
		Ajax.remoteCall('friendsbar', 'event', {player_id: friendId, event: getActiveSesKeys()[0]}, function (data) {
			if (data.error) {
				return reject(data.msg);
			}
			lastSent[friendId] = data.activationTime;
			return resolve(data.msg);
		});
	});
}

// getFriendsList()
// .then(getSesReadyCount)
// .then(x => console.log(x));
//
// sendSesCurrency(1337)
// .then(msg => MessageSuccess(msg).show())
// .catch(msg => MessageError(msg).show());

EventHandler.listen('friend_added', function (client) {
    friends.push(client);
});

EventHandler.listen('friend_removed', function (friendId) {
    friends = $.grep(friends, client => client.player_id !== friendId);
});
