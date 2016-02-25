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
 * A map of player ids to Chat.Resource.Client-like (mostly) plain objects
 * @type {Object}
 */
var friends = {};

/**
 * A map of player ids to unix timestamps
 * @type {Object}
 */
var lastSent = {};

/**
 * Records whether an ses:*_received event has been signalled since last downloading logs, assuming true upon login
 * @type {Boolean}
 */
var newLogs = true;

/**
 * A map containing information such as the most recent log processed, etc
 * @type {Object}
 */
var logsMetadata = JSON.parse(localStorage.getItem('xshteff.betterfriends.logsMetadata')) || {};

/**
 * A map of player ids to ses currency received from this player
 * @type {Object}
 */
var playerLogs = JSON.parse(localStorage.getItem('xshteff.betterfriends.playerLogs')) || {};

/**
 * A map of ses drop types to ses currency received from this drop type
 * @type {Object}
 */
var dropTypeLogs = JSON.parse(localStorage.getItem('xshteff.betterfriends.dropTypeLogs')) || {};

/**
 * Returns a list of keys for active events, eg Hearts. Practically guaranteed to have a length of 0 if no events are
 * running and a length of 1 otherwise (2 or more = internal beta only).
 * @returns {Array}
 */
function getActiveSesKeys() {
	return Object.keys(Game.sesData);
}

/**
 * Returns the number of seconds until you can send ses currency to a friend, or 0 if you can send it immediately.
 * Friends list must be initiated first.
 * @param {Number} friendId
 * @returns {Number}
 */
function timeUntilSesReady(friendId) {
	if (!lastSent.hasOwnProperty(friendId)) {
		return 0;
	}
	var yesterday = Date.now()/1000 - 3600*24;
	return Math.max(0, Math.floor(lastSent[friendId] - yesterday));
}

/**
 * Returns the number of friends you can currently send ses currency to. Friends list must be initiated first.
 * @returns {Number}
 */
function getSesReadyCount() {
	var count = 0;
	$.each(friends, function (playerId, client) {
		if (timeUntilSesReady(playerId) === 0) {
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
	return Object.keys(friends).length;
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

			$.each(data.players, function (i, client) {
				if (client.player_id !== Character.playerId) {
					friends[client.player_id] = west.storage.FriendsBar.prototype.normalizeAvatars_(client, i);
				}
			});

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

/**
 * Save playerLogs and dropTypeLogs into local storage.
 */
function saveLogs() {
	var prefix = 'xshteff.betterfriends.';
	localStorage.setItem(prefix + 'logsMetadata', JSON.stringify(logsMetadata));
	localStorage.setItem(prefix + 'playerLogs', JSON.stringify(playerLogs));
	localStorage.setItem(prefix + 'dropTypeLogs', JSON.stringify(dropTypeLogs));
}

// getFriendsList()
// .then(getSesReadyCount)
// .then(x => console.log(x));
//
// sendSesCurrency(1337)
// .then(msg => MessageSuccess(msg).show())
// .catch(msg => MessageError(msg).show());

EventHandler.listen('friend_added', function (client) {
	friends[client.player_id] = client;
});

EventHandler.listen('friend_removed', function (friendId) {
	delete friends[friendId];
});

EventHandler.listen(s('ses:%1_received', 'hearts'), function (amount) {
	newLogs = true;
});

// Right, here's the fun part.

//Manually adding some styling for the table
var styling = $('<style></style>').text('.send-links { float:right; margin-right:5px; } ');
$('head').append(styling);

//Generating an icon so you can open the window
var icon = $('<div></div>').attr({
    'title': 'BTTW',
    'class': 'menulink'
}).css({
    'background': 'url()',
    'background-position': '0px 0px'
}).mouseleave(function() {
    $(this).css("background-position", "0px 0px");
}).mouseenter(function(e) {
    $(this).css("background-position", "25px 0px");
}).click(function() {
    getFriendsList().then(function() {
			openFriendsWindow();
		});
	});
var fix = $('<div></div>').attr({
    'class': 'menucontainer_bottom'
});
jQuery("#ui_menubar .ui_menucontainer :last").after($('<div></div>').attr({
    'class': 'ui_menucontainer',
    'id': 'bttw'
}).append(icon).append(fix));


var generateSendLink = function(pid) {
    return '<a onclick="sendSesCurrency(' + pid + ')"> Send </a>';
}

var appendPlayerToTable = function(table, pid) {
    table.appendRow().appendToCell(-1, 'player-names', friends[pid].name).appendToCell(-1, 'send-links', generateSendLink(pid));
}

var openFriendsWindow = function() {
    var windowContent = new west.gui.Scrollpane;
    var friendsTable = new west.gui.Table;
    friendsTable.addColumn('player-names');
    friendsTable.addColumn('send-links');
    $.each(friends, function(pid) {
        if(!timeUntilSesReady(pid)){
            appendPlayerToTable(friendsTable, pid);
        }
    });
    windowContent.appendContent(friendsTable.divMain);
    wman.open('kek').setTitle('kek').appendToContentPane(windowContent.divMain).setMiniTitle('kek2').setSize('400', '400');
}