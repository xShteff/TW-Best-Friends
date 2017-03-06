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
// @downloadURL     https://xshteff.github.io/TW-Best-Friends/tw-best-friends.user.js
// @updateURL       https://xshteff.github.io/TW-Best-Friends/tw-best-friends.user.js
// @version         1.08
// @run-at          document-end
// ==/UserScript==

// http://www.danstools.com/javascript-minify/
var script = document.createElement('script');
script.type = 'text/javascript';
script.textContent = '(' + (function () {

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
     * Unix timestamp representing when ses currency can next be sent to any friend. This is a cache to minimise looping
     * over the lastSent map.
     * @type {Number}
     */
    var canNextSend = null;

    /**
     * A map of logtypes to some more descriptive names
     * @type {Object}
     */
    var logTypes = {
        "friendDrop": "Friends",
        "jobDrop": "Jobs",
        "battleDrop": "Fort Battles",
        "adminDrop": "Admin intervention",
        "wofPay": "Used",
        "duelDrop": "Duels",
        "duelNPCDrop": "NPC Duels",
        "adventureDrop": "Adventures",
        "questDrop": "Quests",
        "itemUse": "Used items",
        "buildDrop": "Construction"
    };

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

    var sortingIsAscent = true;
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
        var yesterday = Date.now() / 1000 - 3600 * 23;
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
            Ajax.remoteCallMode('friendsbar', 'search', {
                search_type: 'friends'
            }, function (data) {
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
     * Returns the smallest number of seconds until you can send ses currency to a friend, or 0 if you can send it immediately.
     * Friends list must be initiated first.
     * @returns {Number}
     */
    function getSesSmallestTimer() {
        if (canNextSend != null)
            return Math.max(0, Math.floor(canNextSend - Date.now() / 1000));

        var count = 0;
        var smallestTimer = 0;
        $.each(friends, function (playerId, client) {
            if (count == 0) //Don't worry about this.
                smallestTimer = timeUntilSesReady(playerId);
            if (timeUntilSesReady(playerId) < smallestTimer)
                smallestTimer = timeUntilSesReady(playerId);
            count++;
        });
        canNextSend = Date.now() / 1000 + smallestTimer;
        return smallestTimer;
    }

    /**
     * Sends ses currency to a friend. Do NOT run before establishing an event is ongoing, even if you somehow obtain a
     * friend id without initiating the friend list first (congratulations). Returns a promise with the response message.
     * @param {Number} friendId
     * @returns {Promise}
     */
    function sendSesCurrency(friendId) {
        return new Promise(function (resolve, reject) {
            Ajax.remoteCall('friendsbar', 'event', {
                player_id: friendId,
                event: getActiveSesKeys()[0]
            }, function (data) {
                if (data.error) {
                    return reject(data.msg);
                }
                lastSent[friendId] = data.activationTime;
                canNextSend = null;
                setTimeout(function () {
                    updateCounter();
                    updateCounterTimer();
                }, 1000);
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
        if (typeof (logsMetadata.logTypes) == 'undefined')
            logsMetadata.logTypes = {};
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
        var stats = {
            newest: logsMetadata.newestSeen || 0,
            hasNext: true
        };
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
        Ajax.remoteCallMode('ses', 'log', {
            ses_id: sesKey,
            page: page,
            limit: 100
        }, function (data) {
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

                if (entry.details == "deduct") {
                    entry.value *= -1;
                }
                dropTypeLogs[entry.type] = (dropTypeLogs[entry.type] || 0) + +entry.value;

                if (typeof (logsMetadata.logTypes[entry.type]) == 'undefined') {
                    logsMetadata.logTypes[entry.type] = entry.description;
                }
                if (entry.type === 'friendDrop') {
                    var senderId = JSON.parse(entry.details).player_id;
                    if (playerLogs.hasOwnProperty(senderId)) {
                        playerLogs[senderId].total += +entry.value;
                        playerLogs[senderId].frequency.push(entry.date);
                    } else {
                        playerLogs[senderId] = {
                            total: +entry.value,
                            frequency: [entry.date]
                        };
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

        registerToWestApi();
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
            canNextSend = null;
            setTimeout(updateCounter, 1000);
        });

        EventHandler.listen('friend_removed', function (friendId) {
            delete friends[friendId];
            canNextSend = null;
            setTimeout(updateCounter, 1000);
        });

        EventHandler.listen(Game.sesData[sesKeys[0]].counter.key, function (amount) {
            newLogs = true;
        });
    }

    /**
     * Building a send currency link by using a player id
     * @param {Number} pid
     * @returns {HTMLAnchorElement}
     */
    var generateSendLink = function (pid) {
        return $('<a></a>').text(Game.sesData[getActiveSesKeys()[0]].friendsbar.label).click(function () {
            sendSesCurrency(pid)
                .then(msg => MessageSuccess(msg).show())
                .catch(msg => MessageError(msg).show());
            $(this).parent().parent().remove();
        });
    };

    /**
     * Building a link containing a player's name that when clicked will open it's proifle
     * @param {Number} pid
     * @returns {HTMLAnchorElement}
     */
    var generatePlayerLink = function (pid) {
        return $('<a></a>').text(friends[pid].name).click(function () {
            void (PlayerProfileWindow.open(parseInt(pid)));
        });
    };

    var generateDeleteFriendLink = function (pid) {
        return $('<img>').attr({
            'src': 'https://westens.innogamescdn.com/images/icons/delete.png',
            'title': '<span>Remove friend</span>',
            'id': 'xsht_remove_' + pid
        }).click(function () {
            new west.gui.Dialog("Remove friend", "Do you really want to delete this player from the list?").setIcon(west.gui.Dialog.SYS_QUESTION).addButton("yes", function () {
                Ajax.remoteCall('character', 'cancel_friendship', {
                    friend_id: pid
                }, function (json) {
                    if (json["result"]) {
                        new UserMessage("Friend removed from your list.", UserMessage.TYPE_SUCCESS).show();
                        $("div.friendData_" + pid, FriendslistWindow.DOM).remove();
                        $('#xsht_remove_' + pid).parent().parent().remove();
                        Chat.Friendslist.removeFriend(pid);
                        EventHandler.signal("friend_removed", pid);
                    } else new UserMessage("Friend could not be removed", UserMessage.TYPE_ERROR).show();
                });
            }).addButton("no").show();
        }).css({
            'cursor': 'pointer',
            'position': 'relative',
            'bottom': '1px'
        });
    };


    /**
     * We're using this method to add a completely new row to the table. First thing we want to do is check if the player did send
     * any currency. If it did, I'm displaying the amount of currency he sent, and all the dates when he did this.
     * Then I'm checking if I can send currency to my friend, if I can't, I'm displaying the amount of time left until I can send it.
     * @param {west.gui.Table} table
     * @param {Number} pid
     */
    var appendPlayerToTable = function (table, pid) {
        var pLog = playerLogs[pid];
        var totalAmount, logToolTip, currentText, currentDate;
        if (pLog === undefined) {
            totalAmount = 0;
            logToolTip = $('<a>').attr('title', '<div>Player did not send you any currency yet.</div>').text(' (' + totalAmount + ')');
        } else {
            totalAmount = pLog.total;
            logToolTip = $('<a>').attr('title', '<div><center><b>Dates you received currency from:</b> </br>').text(' (' + totalAmount + ')');
            for (var i = 0; i < playerLogs[pid].frequency.length; i++) {
                currentText = logToolTip.attr('title');
                currentDate = new Date(playerLogs[pid].frequency[i] * 1000);
                if (i == playerLogs[pid].frequency.length - 1)
                    logToolTip.attr('title', currentText + '<br>' + currentDate.toDateTimeStringNice() + '</center></div>');
                else
                    logToolTip.attr('title', currentText + '<br>' + currentDate.toDateTimeStringNice());
            }

        }
        table.appendRow().appendToCell(-1, 'remove-link', generateDeleteFriendLink(pid)).appendToCell(-1, 'player-names', generatePlayerLink(pid)).appendToCell(-1, 'total-received', logToolTip);
        if (timeUntilSesReady(pid)) {
            var totalSec = timeUntilSesReady(pid);
            var hours = parseInt(totalSec / 3600) % 24;
            var minutes = parseInt(totalSec / 60) % 60;
            var formattedTime = $('<a>').attr('title', '<div><b>Time remaining until you can send</b></div>').text(s('%1h %2m', hours, minutes));
            table.appendToCell(-1, 'send-links', formattedTime);
        } else {
            table.appendToCell(-1, 'send-links', generateSendLink(pid));
        }
    };

    /**
     * Pretty names for most, if not all, possible drop types, using the logTypes array defined above.
     * @param {String} key
     * @returns {String}
     */
    function prettyDropTypes(key) {
        return logsMetadata.logTypes[key] || logTypes[key] || "Unknown";
    }

    /*
    * Uhm. Using this to sort the table. It requires a key which decides how exactly you sort it.
    * @param {String} sortingType
    */
    var refreshTable = function (sortingType) {
        processLogs(false).then(function () {
            var players = [];
            $.each(friends, function (pid) {
                try {
                    players.push({
                        'id': pid,
                        'name': friends[pid].name,
                        'total': playerLogs[pid].total,
                        'timeUntilReady': timeUntilSesReady(pid)
                    });
                } catch (e) {
                    players.push({
                        'id': pid,
                        'name': friends[pid].name,
                        'total': 0,
                        'timeUntilReady': timeUntilSesReady(pid)
                    });
                }
            });
            players.sort(function (a, b) {
                if (sortingType !== "name")
                    return (sortingIsAscent) ? b[sortingType] - a[sortingType] : a[sortingType] - b[sortingType];
                else
                    return (sortingIsAscent) ? ((a.name.toLowerCase() > b.name.toLowerCase()) ? 1 : -1) : ((a.name.toLowerCase() < b.name.toLowerCase()) ? 1 : -1);
            });
            var friendsTable = new west.gui.Table();
            friendsTable.addColumn('remove-link').setId('twbf-table');
            var nameColHead = $("<a>").html('<img src="//westzzs.innogamescdn.com/images/icons/user.png" alt="" />&nbsp;' + 'Name').click(function () {
                refreshTable("name");
                sortingIsAscent = !sortingIsAscent;
            });
            friendsTable.addColumn('player-names').appendToCell('head', 'player-names', nameColHead);
            var receivedColHead = $("<a>").text('Received').click(function () {
                refreshTable("total");
                sortingIsAscent = !sortingIsAscent;
            });
            friendsTable.addColumn('total-received').appendToCell('head', 'total-received', receivedColHead);
            var sendColHead = $("<a>").text('Send').click(function () {
                refreshTable("timeUntilReady");
                sortingIsAscent = !sortingIsAscent;
            });
            friendsTable.addColumn('send-links').appendToCell('head', 'send-links', sendColHead);
            for (var i = 0; i < players.length; i++)
                appendPlayerToTable(friendsTable, players[i].id);
            var moreData = "";
            $.each(dropTypeLogs, function (key) {
                moreData += '<b>' + prettyDropTypes(key) + ':</b> ' + dropTypeLogs[key] + ', ';
            });
            $('#twbf-table').html(friendsTable.divMain);
        });
    }

    /**
     * Generating the GUI and displaying all the necessary information for the user.
     */
    function openWindow() {
        processLogs(false).then(function () {
            var players = [];
            $.each(friends, function (pid) {
                try {
                    players.push({
                        'id': pid,
                        'name': friends[pid].name,
                        'total': playerLogs[pid].total,
                        'timeUntilReady': timeUntilSesReady(pid)
                    });
                } catch (e) {
                    players.push({
                        'id': pid,
                        'name': friends[pid].name,
                        'total': 0,
                        'timeUntilReady': timeUntilSesReady(pid)
                    });
                }
            });
            players.sort(function (a, b) {
                return a.timeUntilReady - b.timeUntilReady;
            });
            var windowContent = new west.gui.Scrollpane();
            var friendsTable = new west.gui.Table();
            friendsTable.addColumn('remove-link').setId('twbf-table');
            var nameColHead = $("<a>").html('<img src="//westzzs.innogamescdn.com/images/icons/user.png" alt="" />&nbsp;' + 'Name').click(function () {
                refreshTable("name");
                sortingIsAscent = !sortingIsAscent;
            });
            friendsTable.addColumn('player-names').appendToCell('head', 'player-names', nameColHead);
            var receivedColHead = $("<a>").text('Received').click(function () {
                refreshTable("total");
                sortingIsAscent = !sortingIsAscent;
            });
            friendsTable.addColumn('total-received').appendToCell('head', 'total-received', receivedColHead);
            var sendColHead = $("<a>").text('Send').click(function () {
                refreshTable("timeUntilReady");
                sortingIsAscent = !sortingIsAscent;
            });
            friendsTable.addColumn('send-links').appendToCell('head', 'send-links', sendColHead);
            for (var i = 0; i < players.length; i++)
                appendPlayerToTable(friendsTable, players[i].id);
            var moreData = "";
            $.each(dropTypeLogs, function (key) {
                moreData += '<b>' + prettyDropTypes(key) + ':</b> ' + dropTypeLogs[key] + ', ';
            });
            windowContent.appendContent(friendsTable.divMain);
            windowContent.appendContent(moreData);
            wman.open('twbf', 'twbf', 'noreload').setTitle('TW Best Friends').appendToContentPane(windowContent.divMain).setMiniTitle('TW Best Friends - Sending currency made easier!').setSize('500', '420');
        });
    }


    /**
     * Forcing some custom CSS styling, mainly for the table.
     */
    var styling = $('<style></style>').text('.remove-link { width:20px; } .player-names { width:175px; } .total-received { text-align:center; width:50px; } .send-links { text-align:right; width:170px }');
    $('head').append(styling);

    /**
     * Adding a custom event counter, that displays the time left until you can send ses currency,
     * the amount of friends to whom you can send ses currency to and the total amount of friends you have.
     * When clicked, it will open a the script window.
     */
    function initialiseCounter() {
        $('.xsht_custom_unit_counter').remove();
        var evAvailable = $('<span></span>').attr('id', 'twbf_value').text(getSesReadyCount());
        var evLimit = $('<span></span>').attr('class', 'twbf_limit').text(' / ' + getFriendCount()).css({
            'color': 'lightgray',
            'font-size': '11px'
        });

        var timeUntilCanSend = getSesSmallestTimer();
        var hours = parseInt(timeUntilCanSend / 3600) % 24;
        var minutes = parseInt(timeUntilCanSend / 60) % 60;

        var formattedTime = $('<span></span>').css({
            'position': 'absolute',
            'left': '3px',
            'top': '1px',
            'font-size': '12px'
        }).attr({
            'title': '<div><b>Time remaining until you can send</b></div>',
            'id': 'twbf_timer'
        }).text(' ');
        var evValue = $('<div></div>').attr('class', 'value').css({
            'position': 'absolute',
            'left': '32px',
            'top': '3px',
            'width': '105px',
            'height': '25px',
            'line-height': '25px',
            'pading': '0 5px',
            'color': '#f8c57c',
            'font-size': '13pt',
            'text-align': 'right',
            'user-select': 'none',
            'background': 'url("https://westzzs.innogamescdn.com/images/interface/custom_unit_counter_sprite.png?2") no-repeat 0 -36px',
            'z-index': '1'
        }).html(evAvailable).append(evLimit);
        evValue.append(formattedTime);

        if (timeUntilCanSend != 0) {
            formattedTime.text(s('%1h %2m', hours, minutes));
            setTimeout(updateCounterTimer, (timeUntilCanSend % 60 + 1) * 1000); //Not sure if this is alright, I'm using this to update the timer thing.
        }

        var evCounter = $('<div></div>').attr({
            'class': 'xsht_custom_unit_counter',
            'id': 'twbf',
            'title': 'Open TW Best Friends'
        }).css({
            'position': 'absolute',
            'top': '32px',
            'left': '50%',
            'margin-left': '-250px',
            'z-index': '16',
            'width': '180px',
            'height': '36px',
            'text-align': 'left',
            'text-shadow': '1px 1px 1px #000',
            'background': 'url("https://westzzs.innogamescdn.com/images/interface/custom_unit_counter_sprite.png?2") no-repeat 50% 0',
            'cursor': 'pointer'
        }).append(evValue).click(openWindow);
        $("#ui_topbar").before(evCounter);
    }

    /*
    * Updates the amount of players to whom I can send ses currency to,
    * and the total amount of friends.
    */
    function updateCounter() {
        WestUi.TopBar._redraw($("#twbf_value"), getSesReadyCount());
        $('.twbf_limit').text(' / ' + getFriendCount());
    }

    /*
    * Recursevly updating the timer on the counter. At the same time I'm checking if time reached 0.
    * If it did, then I'm stoping and removing the timer, and updating the counter
    * If it didn't, I'm just displaying the remaining time.
    */
    function updateCounterTimer() {
        var timeUntilCanSend = getSesSmallestTimer();
        var hours = parseInt(timeUntilCanSend / 3600) % 24;
        var minutes = parseInt(timeUntilCanSend / 60) % 60;
        if (timeUntilCanSend == 0) {
            updateCounter();
            $('#twbf_timer').text(' ');
        } else {
            $('#twbf_timer').text(s('%1h %2m', hours, minutes));
            setTimeout(updateCounterTimer, (timeUntilCanSend % 60 + 1) * 1000); //Not sure if this is alright, I'm using this to update the timer thing.
        }
    }

    initialiseScript();

    function registerToWestApi() {
        scriptInfo = "What are you doing here?";
        window.scriptyscript = {
            script: TheWestApi.register('twbf', 'The West Best Friends', '2', Game.version.toString(), 'xShteff, Diggo11, Leones/Slygoxx', 'https://github.com/xShteff'),
            setGui: function () {
                this.script.setGui(scriptInfo);
            },
            init: function () {
                this.setGui();
            }
        };
        window.scriptyscript.init();
    }

}).toString() + ')()';
document.head.appendChild(script);