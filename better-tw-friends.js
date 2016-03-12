// ==UserScript==
// @name            TW Best Friends
// @description     Sending tamboola currency made easier
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
 * A map of player ids to plain objects describing the character
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
var logsMetadata = null;

/**
 * A map of player ids to eg {total: Number, frequency: [js timestamp, ...]}
 * @type {Object}
 */
var playerLogs = null;

/**
 * A map of ses drop types to ses currency received from this drop type
 * @type {Object}
 */
var dropTypeLogs = null;

/**
 * We don't want a race between two log processing functions
 * @type {Boolean}
 */
var logsLocked = false;

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
	var yesterday = Date.now()/1000 - 3600*23;
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
					delete friends[client.player_id].experience;
					delete friends[client.player_id].x;
					delete friends[client.player_id].y;
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
 * Downloads any new ses currency logs and processes them. If the last seen ses key does not match then it deletes the
 * currently held logs. Optionally adds a delay between log fetches to avoid streaks of bad luck. If you want more info
 * see the functions below.
 * @param {Boolean} background
 * @returns {Promise}
 */
function processLogs(background) {
	if (logsLocked) throw new Error("Please don't try and process the logs twice at the same time.");
	if (!newLogs) return Promise.resolve();
	logsLocked = true;

	loadLogs();
	var sesKey = getActiveSesKeys()[0];
	if (sesKey !== logsMetadata.sesKey) {
		playerLogs = {};
		dropTypeLogs = {};
		logsMetadata.sesKey = sesKey;
	}

	return new Promise(function (resolve, reject) {
		var generator = processLogsBatches(sesKey, background, resolve, reject);
		generator.next();
		generator.next(() => generator.next());
	});
}

/**
 * This whole function is a big hack to emulate ES7 async/await. If it were supported by current browsers, we could
 * simply make processLogs async and await each processLogBatch there in a loop, then resolve the promise. We can't use
 * promises' .then either because we don't know how many pages there are in advance; we would need something like .while
 * and severe mental backflips. The next best thing is the yield keyword provided by generators, which allows us to
 * "pause" execution in a similar way. We obviously can't stick this in the promise directly so it exists here instead,
 * and processLogs just calls it and hands along its resolve and reject functions.
 *
 * @see https://davidwalsh.name/async-generators
 * @see https://esdiscuss.org/topic/retrieving-generator-references
 *
 * The core idea here is that once a batch of logs is done processing asynchronously, it resumes the generator, which
 * starts the next batch. To do that, we need to pass a reference to this generator onto processLogBatch. Generators are
 * not initialised with the new keyword, so annoyingly `this` does not point to the generator object. However, it is
 * possible to resume suspended generators with an overwritten value. This is why we yield immediately -- so processLogs
 * can resume the execution with a reference to the generator object.
 *
 * After that it is relatively straightforward. The generator is suspended and resumed via the callback until there are
 * no more pages of logs to process. At that point we update the newestSeen data, save everything to local storage and
 * resolve the promise satisfied everything is ready to open the window.
 * @param {String} sesKey
 * @param {Boolean} background
 * @param {Function} resolve
 * @param {Function} reject
 */
function* processLogsBatches(sesKey, background, resolve, reject) {
	var callback = yield;
	var stats = {newest: logsMetadata.newestSeen || 0, hasNext: true};
	var page = 1;
	do {
		yield processLogBatch(sesKey, page++, stats, callback, background);
	} while (stats.hasNext);
	logsMetadata.newestSeen = stats.newest;
	saveLogs();
	newLogs = false;
	logsLocked = false;
	return resolve();
}

/**
 * Processes a given page of logs and updates playerLogs and dropTypeLogs. Stats object is used like pass-by-reference
 * to return both the newest log date seen and whether more new log pages are available.
 * @param {String} sesKey
 * @param {Number} page
 * @param {Object} stats
 * @param {Function} callback
 * @param {Boolean} background
 */
function processLogBatch(sesKey, page, stats, callback, background) {
	Ajax.remoteCallMode('ses', 'log', {ses_id: sesKey, page: page, limit: 100}, function (data) {
		if (data.error) {
			logsLocked = false;
			return reject(data.msg);
		}

		stats.hasNext = !data.entries.some(function (entry, i) {
			if (entry.date <= logsMetadata.newestSeen) {
				return true; // short circuit
			} else if (i === 0 && entry.date > stats.newest) {
				stats.newest = entry.date;
			}

			dropTypeLogs[entry.type] = (dropTypeLogs[entry.type] || 0) + +entry.value;
			if (entry.type === 'friendDrop') {
				var senderId = JSON.parse(entry.details).player_id;
				if (playerLogs.hasOwnProperty(senderId)) {
					playerLogs[senderId].total += +entry.value;
					playerLogs[senderId].frequency.push(entry.date);
				} else {
					playerLogs[senderId] = {total: +entry.value, frequency: [entry.date]};
				}
			}
		}) && data.hasNext;

		if (background) {
			setTimeout(callback, 1000);
		} else {
			callback();
		}
	});
}

/**
 * Load playerLogs and dropTypeLogs from local storage.
 */
function loadLogs() {
	logsMetadata = JSON.parse(localStorage.getItem('xshteff.betterfriends.logsMetadata')) || {};
	playerLogs = JSON.parse(localStorage.getItem('xshteff.betterfriends.playerLogs')) || {};
	dropTypeLogs = JSON.parse(localStorage.getItem('xshteff.betterfriends.dropTypeLogs')) || {};
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

/**
 * Starts the whole script.
 */
function initialiseScript() {
	var sesKeys = getActiveSesKeys();
	if (sesKeys.length === 0) return;

	getFriendsList().then(function () {
		getSesReadyCount(); // display it pls Allen
		getFriendCount(); // display it pls Allen
		return processLogs(true)
	}).then(initialiseCounter);

	EventHandler.listen('friend_added', function (client) {
		friends[client.playerId] = {
			avatar: client.avatar,
			class: client.charClass,
			level: client.level,
			name: client.pname,
			player_id: client.playerId,
			profession_id: client.professionId,
			subclass: client.subClass
		};
	});

	EventHandler.listen('friend_removed', function (friendId) {
		delete friends[friendId];
	});

	EventHandler.listen(Game.sesData[sesKeys[0]].counter.key, function (amount) {
		newLogs = true;
	});
}

/**
 * Building a send currency link by using a player id
 * @param {Number} pid
 * @returns {Anchor}
 */
var generateSendLink = function(pid) {
	return $('<a></a>').text(Game.sesData[getActiveSesKeys()[0]].friendsbar.label).click(function() {
		sendSesCurrency(pid)
			.then(msg => MessageSuccess(msg).show())
			.catch(msg => MessageError(msg).show());
		$(this).parent().parent().remove();
	});
};

/**
 * Building a link containing a player's name that when clicked will open it's proifle
 * @param {Number} pid
 * @returns {Anchor}
 */
var generatePlayerLink = function(pid) {
	return $('<a></a>').text(friends[pid].name).click(function() {
		javascript:void(PlayerProfileWindow.open(parseInt(pid))); //doesnt work without parseInt for some reason...
	});
}


/**
 * We're using this method to add a completely new row to the table. First thing we want to do is check if the player did send
 * any currency. If it did, I'm displaying the amount of currency he sent, and all the dates when he did this.
 * Then I'm checking if I can send currency to my friend, if I can't, I'm displaying the amount of time left until I can send it.
 * @param {west.gui.Table} table
 * @param {Number} pid
 */
var appendPlayerToTable = function(table, pid) {
	var pLog = playerLogs[pid];
	var totalAmount, logToolTip, currentText, currentDate;
	if(pLog === undefined){
		totalAmount = 0;
		logToolTip = $('<a>').attr('title', '<div>Player did not send you any currency yet.</div>').text(' (' + totalAmount + ')');
	}
	else
	{
		totalAmount = pLog.total;
		logToolTip = $('<a>').attr('title', '<div><center><b>Dates you received currency from:</b> </br>').text(' (' + totalAmount + ')');
		for(var i = 0; i < playerLogs[pid].frequency.length; i++) {
			currentText = logToolTip.attr('title');
			currentDate = new Date(playerLogs[pid].frequency[i] * 1000);
			if(i == playerLogs[pid].frequency.length - 1)
				logToolTip.attr('title', currentText + '<br>' + currentDate.toDateTimeStringNice() + '</center></div>');
			else
				logToolTip.attr('title', currentText + '<br>' + currentDate.toDateTimeStringNice());
		}

	}

	table.appendRow().appendToCell(-1, 'player-names', generatePlayerLink(pid)).appendToCell(-1, 'total-received', logToolTip);
	if(timeUntilSesReady(pid)) {
		console.log('already sent');
		var totalSec = timeUntilSesReady(pid);
		var hours = parseInt( totalSec / 3600 ) % 24;
		var minutes = parseInt( totalSec / 60 ) % 60;
		var formattedTime = $('<a>').attr('title', '<div><b>Time remaining until you can send</b></div>').text(hours + 'h' + minutes + 'm');
		table.appendToCell(-1, 'send-links', formattedTime);
	} else {
		console.log('ready');
		table.appendToCell(-1, 'send-links', generateSendLink(pid));
	}
};

/**
 * Generating the GUI and displaying all the necessary information for the user.
 */
function openWindow() {
	processLogs(false).then(function () {
		var players = [];
		$.each(friends, function(pid) {
			players.push({ 'id' : pid, 'timeUntilReady' : timeUntilSesReady(pid) });
		});
		players.sort(function(a, b) {
			return a.timeUntilReady - b.timeUntilReady;
		});
		var windowContent = new west.gui.Scrollpane();
		var friendsTable = new west.gui.Table();
		friendsTable.addColumn('player-names').appendToCell('head', 'player-names', '<img src="//westzzs.innogamescdn.com/images/icons/user.png" alt="" />&nbsp;' + 'Name');
		friendsTable.addColumn('total-received').appendToCell('head', 'total-received', 'Received');
		friendsTable.addColumn('send-links').appendToCell('head', 'send-links', 'Send');
		for(var i = 0; i < players.length; i++)
			appendPlayerToTable(friendsTable, players[i].id);
		var moreData = "<p>Lorem ipsum dolor sit amet, consectetur adipisicing elit. At eos consequatur, molestias sint suscipit consequuntur cum nisi quaerat ipsa, sapiente soluta odit voluptas eligendi ducimus nihil hic quo iste tenetur. </p>";
		windowContent.appendContent(friendsTable.divMain);
		windowContent.appendContent(moreData);
		wman.open('twbf').setTitle('TW Best Friends').appendToContentPane(windowContent.divMain).setMiniTitle('TW Best Friends - Sending currency made easier!').setSize('500', '420');
	});
}



/**
 * Forcing some custom CSS styling, mainly for the table.
 */
var styling = $('<style></style>').text('.player-names { width:40%; } .total-received { text-align:center; width:20%; } .send-links { text-align:right; width:40% }');
$('head').append(styling);

/**
 * Adds a temporary button in game so you can open the window.
 */
function initialiseButton() {
	var icon = $('<div></div>').attr({
		'title': 'TW Best Friends',
		'class': 'menulink'
	}).css({
		'background': 'url(https://puu.sh/nkN3l/aba1b474e5.png)',
		'background-position': '0px 0px'
	}).mouseleave(function () {
		$(this).css("background-position", "0px 0px");
	}).mouseenter(function (e) {
		$(this).css("background-position", "25px 0px");
	}).click(openWindow);
	var fix = $('<div></div>').attr({
		'class': 'menucontainer_bottom'
	});
	$("#ui_menubar .ui_menucontainer :last").after($('<div></div>').attr({
		'class': 'ui_menucontainer',
		'id': 'twbf'
	}).append(icon).append(fix));
}

function initialiseCounter() {
	$('.xsht_custom_unit_counter').remove()
	var evAvailable = $('<span></span>').attr('id', 'twbf_value').text(getSesReadyCount());
	var evLimit = $('<span></span>').attr('class', 'twbf_limit').text(' / ' + getFriendCount()).css({
	    'color' : 'lightgray',
	    'font-size' : '11px'
	});

	var evValue = $('<div></div>').attr('class', 'value').css({
	    'position' :'absolute',
	    'left' : '32px',
	    'top' : '3px',
	    'width' : '105px',
	    'height' : '25px',
	    'line-height' : '25px',
	    'pading' : '0 5px',
	    'color' : '#f8c57c',
	    'font-size' : '13pt',
	    'text-align' : 'right',
	    'user-select' : 'none',
	    'background' : 'url("https://westzzs.innogamescdn.com/images/interface/custom_unit_counter_sprite.png?2") no-repeat 0 -36px',
	    'z-index' : '1'
	}).html(evAvailable).append(evLimit);

	var evCounter = $('<div></div>').attr({
	    'class' : 'xsht_custom_unit_counter',
	    'id' : 'twbf',
	    'title' : 'Open TW Best Friends'
	}).css({
	    'position' : 'absolute',
	    'top': '32px',
	    'left' : '50%',
	    'margin-left' : '-250px',
	    'z-index' :'16',
	    'width' : '180px',
	    'height' : '36px',
	    'text-align' : 'left',
	    'text-shadow' : '1px 1px 1px #000',
	    'background' : 'url("https://westzzs.innogamescdn.com/images/interface/custom_unit_counter_sprite.png?2") no-repeat 50% 0',
	    'cursor' : 'pointer'
	}).append(evValue).click(openWindow);
	$("#ui_topbar").before(evCounter);
}

function updateCounter() {
	WestUi.TopBar._redraw($("#twbf_value"), getSesReadyCount());
}

initialiseScript();
