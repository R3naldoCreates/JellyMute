/*
 * JellyMute — injected client script for the Jellyfin web UI.
 *
 * Runs in every web-based client (browsers and the official Android/iOS apps,
 * which load the server's web UI). Two jobs:
 *
 *  1. On an item details page: if a .mute sidecar exists for the item, show a
 *     JellyMute on/off toggle next to the main action buttons. State is stored
 *     per user + item in localStorage and defaults to the server configuration.
 *
 *  2. During playback: mute the video element exactly while playback is inside
 *     one of the item's intervals, restoring the viewer's previous state on exit.
 *     Polled every animation frame so muting is frame-tight, and so seeks into
 *     the middle of an interval mute immediately.
 *
 * Everything is wrapped defensively so this script can never break the web app.
 */
(function () {
    'use strict';

    if (window.__JELLYMUTE_LOADED__) {
        return;
    }
    window.__JELLYMUTE_LOADED__ = true;

    var CFG = window.__JELLYMUTE__ || { mutedByDefault: true, showIndicator: true };
    var GUID = '[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

    function log() {
        try {
            var args = ['[JellyMute]'].concat(Array.prototype.slice.call(arguments));
            console.debug.apply(console, args);
            beacon(args.join(' '));
        } catch (e) {
            /* ignore */
        }
    }

    /* Remote diagnostics: mirror key events to the server log so playback
     * issues on phones/tablets (where there is no console) can be diagnosed
     * from the server. Throttled and fire-and-forget. */
    var lastBeacon = { __any: 0 };

    function beacon(msg) {
        try {
            var now = Date.now();
            if (now - (lastBeacon[msg] || 0) < 10000) return; // same msg: 1 per 10 s
            if (now - (lastBeacon.__any || 0) < 300) return;  // overall: 1 per 300 ms
            lastBeacon[msg] = now;
            lastBeacon.__any = now;
            var base = serverAddress();
            if (!base) return;
            fetch(base + '/JellyMute/Log?m=' + encodeURIComponent(String(msg).slice(0, 180)))
                .catch(function () { /* ignore */ });
        } catch (e) {
            /* ignore */
        }
    }

    /* ------------------------------------------------------------------ */
    /* ApiClient helpers                                                   */
    /* ------------------------------------------------------------------ */

    function api() {
        return window.ApiClient;
    }

    function serverAddress() {
        try {
            return api() && api().serverAddress();
        } catch (e) {
            return '';
        }
    }

    function accessToken() {
        try {
            return api() && api().accessToken();
        } catch (e) {
            return null;
        }
    }

    function currentUserId() {
        try {
            return (api() && api().getCurrentUserId()) || 'anon';
        } catch (e) {
            return 'anon';
        }
    }

    var intervalsCache = {}; // itemId -> { at: timestamp, intervals: [...] | null }

    function fetchIntervals(itemId) {
        var cached = intervalsCache[itemId];
        var now = Date.now();
        // positive results stick, misses are retried after 30 s
        if (cached && (cached.intervals || now - cached.at < 30000)) {
            return Promise.resolve(cached.intervals);
        }
        var url = serverAddress() + '/JellyMute/Item/' + itemId;
        var token = accessToken();
        if (!token) {
            return Promise.resolve(null);
        }
        return fetch(url, { headers: { 'X-Emby-Token': token } })
            .then(function (res) {
                if (!res.ok) {
                    return null; // 404 = no sidecar; anything else — treat as none
                }
                return res.json();
            })
            .then(function (data) {
                var list = null;
                if (data && Array.isArray(data.intervals)) {
                    list = data.intervals
                        .map(function (iv) {
                            return { s: Number(iv.startSeconds), e: Number(iv.endSeconds) };
                        })
                        .filter(function (iv) {
                            return isFinite(iv.s) && isFinite(iv.e) && iv.e > iv.s;
                        })
                        .sort(function (a, b) {
                            return a.s - b.s;
                        });
                    if (!list.length) {
                        list = null;
                    }
                }
                intervalsCache[itemId] = { at: now, intervals: list };
                if (list) {
                    log('item', itemId, '->', list.length, 'intervals');
                } else {
                    log('item', itemId, '-> no .mute sidecar found by the server');
                }
                return list;
            })
            .catch(function () {
                return null;
            });
    }

    /* ------------------------------------------------------------------ */
    /* Per-item enabled state (localStorage, per user)                     */
    /* ------------------------------------------------------------------ */

    function stateKey(itemId) {
        return 'jellymute:' + currentUserId() + ':' + itemId;
    }

    function isEnabledFor(itemId) {
        try {
            var v = localStorage.getItem(stateKey(itemId));
            if (v === 'on') {
                return true;
            }
            if (v === 'off') {
                return false;
            }
        } catch (e) {
            /* storage unavailable — fall through to default */
        }
        return !!CFG.mutedByDefault;
    }

    function setEnabledFor(itemId, enabled) {
        try {
            localStorage.setItem(stateKey(itemId), enabled ? 'on' : 'off');
        } catch (e) {
            /* ignore */
        }
        if (playback.itemId === itemId) {
            playback.enabled = enabled;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Details page toggle                                                 */
    /* ------------------------------------------------------------------ */

    var lastDetailsItemId = null;
    var toggleForItem = null; // item id the current toggle belongs to

    function itemIdFromLocation() {
        var text = String(location.hash || '') + String(location.search || '');
        var m = text.match(new RegExp('[?&]id=(' + GUID + ')', 'i'));
        return m ? m[1].toLowerCase() : null;
    }

    function ensureStyles() {
        if (document.getElementById('jellymute-styles')) {
            return;
        }
        var style = document.createElement('style');
        style.id = 'jellymute-styles';
        style.textContent =
            '.jellymute-toggle{display:inline-flex;align-items:center;gap:.45em;' +
            'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);' +
            'border-radius:.35em;color:inherit;font-family:inherit;font-size:.9em;' +
            'padding:.5em .9em;margin-left:.5em;cursor:pointer;vertical-align:middle;' +
            'user-select:none;-webkit-tap-highlight-color:transparent}' +
            '.jellymute-toggle:hover{background:rgba(255,255,255,.12)}' +
            '.jellymute-toggle .jm-switch{width:1.9em;height:1em;border-radius:.5em;' +
            'background:#666;position:relative;display:inline-block;flex-shrink:0;' +
            'transition:background .15s}' +
            '.jellymute-toggle .jm-switch::after{content:"";position:absolute;' +
            'top:.12em;left:.12em;width:.76em;height:.76em;border-radius:50%;' +
            'background:#fff;transition:left .15s}' +
            '.jellymute-toggle.jm-on .jm-switch{background:#3fa860}' +
            '.jellymute-toggle.jm-on .jm-switch::after{left:1.02em}' +
            '.jellymute-toggle.jm-none{opacity:.45;cursor:default}' +
            '.jellymute-toggle.jm-none:hover{background:rgba(255,255,255,.06)}' +
            '.jellymute-toggle .jm-label{white-space:nowrap}' +
            '.jellymute-indicator{position:absolute;top:.6em;right:.6em;z-index:9997;' +
            'background:rgba(20,20,20,.75);color:#fff;font:600 12px sans-serif;' +
            'padding:.35em .7em;border-radius:.4em;pointer-events:none}';
        document.head.appendChild(style);
    }

    function renderToggle() {
        try {
            ensureStyles();
            var itemId = itemIdFromLocation();
            if (!itemId) {
                return;
            }
            lastDetailsItemId = itemId;

            // Known details-page action containers, most specific first.
            var CONTAINERS = ['.mainDetailButtons', '.detailPagePrimaryContainer', '.detailPageContent'];
            var container = null;
            var containerName = '';
            for (var ci = 0; ci < CONTAINERS.length; ci++) {
                container = document.querySelector(CONTAINERS[ci]);
                if (container) {
                    containerName = CONTAINERS[ci];
                    break;
                }
            }
            if (!container) {
                log('details: no known button container found — toggle cannot render');
                return;
            }

            var existing = container.querySelector('.jellymute-toggle');
            if (existing && toggleForItem !== itemId) {
                existing.remove();
                existing = null;
            }

            fetchIntervals(itemId).then(function (intervals) {
                var button = container.querySelector('.jellymute-toggle');

                if (!button) {
                    button = document.createElement('button');
                    button.setAttribute('is', 'emby-button');
                    button.type = 'button';
                    button.className = 'jellymute-toggle';
                    button.innerHTML =
                        '<span class="jm-switch"></span>' +
                        '<span class="jm-label"></span>';
                    button.addEventListener('click', function () {
                        if (button.classList.contains('jm-none')) {
                            return; // this item has no mute file — nothing to switch
                        }
                        var on = !button.classList.contains('jm-on');
                        button.classList.toggle('jm-on', on);
                        button.querySelector('.jm-label').textContent =
                            'JellyMute: ' + (on ? 'Mute on' : 'Mute off');
                        log('toggle ->', on ? 'on' : 'off', 'for', toggleForItem);
                        setEnabledFor(toggleForItem, on);
                    });
                    container.appendChild(button);
                }

                if (!intervals) {
                    // Visible but unavailable: teaches the user why muting is
                    // not happening on this episode.
                    toggleForItem = null;
                    button.classList.add('jm-none');
                    button.classList.remove('jm-on');
                    button.title = 'No .mute file for this episode — mark one in JellyMute Desktop';
                    button.querySelector('.jm-label').textContent = 'JellyMute: no mute file';
                    log('details:', itemId, 'has no mute file — switch shown as unavailable');
                    return;
                }

                button.classList.remove('jm-none');
                toggleForItem = itemId;
                var enabled = isEnabledFor(itemId);
                button.classList.toggle('jm-on', enabled);
                button.title = 'Mutes the marked sections of this video';
                button.querySelector('.jm-label').textContent =
                    'JellyMute: ' + (enabled ? 'Mute on' : 'Mute off');
                log('details: switch ready for', itemId, '-', enabled ? 'on' : 'off', '(' + intervals.length + ' intervals)');
            });
        } catch (e) {
            /* never break the page */
        }
    }

    // SPA navigation: jellyfin-web fires "viewshow" whenever a view renders.
    document.addEventListener('viewshow', function () {
        setTimeout(renderToggle, 60);
    });
    // Fallback polling (covers slow renders and clients without viewshow).
    setInterval(renderToggle, 1500);

    /* ------------------------------------------------------------------ */
    /* Playback muting                                                     */
    /* ------------------------------------------------------------------ */

    var playback = {
        video: null,
        src: null,
        itemId: null,
        intervals: null,
        enabled: true,
        weMuted: false,
        userOverrode: false,
        indicator: null,
        bindToken: 0
    };

    function itemIdFromSrc(src) {
        var m = String(src || '').match(new RegExp('/videos?/(' + GUID + ')/', 'i'));
        return m ? m[1].toLowerCase() : null;
    }

    function setIndicator(video, visible) {
        try {
            if (!CFG.showIndicator) {
                return;
            }
            var host = video.parentElement;
            if (!host) {
                return;
            }
            if (visible && !playback.indicator) {
                var el = document.createElement('div');
                el.className = 'jellymute-indicator';
                el.textContent = '🔇 JellyMute';
                if (getComputedStyle(host).position === 'static') {
                    host.style.position = 'relative';
                }
                host.appendChild(el);
                playback.indicator = el;
            } else if (!visible && playback.indicator) {
                playback.indicator.remove();
                playback.indicator = null;
            }
        } catch (e) {
            /* ignore */
        }
    }

    function restoreMute(video) {
        if (playback.weMuted) {
            log('mute OFF');
            playback.weMuted = false;
            if (!playback.userOverrode) {
                try {
                    video.muted = false;
                } catch (e) {
                    /* ignore */
                }
            }
            playback.userOverrode = false;
        }
        setIndicator(video, false);
    }

    /**
     * Fallback item-id resolution for stream URLs that carry no id (e.g.
     * "blob:" sources on mobile WebViews): ask the server what this user's
     * session is currently playing.
     */
    function fetchPlayingItemIdFromSession() {
        var base = serverAddress();
        var token = accessToken();
        if (!base || !token) {
            return Promise.resolve(null);
        }
        return fetch(base + '/Sessions', { headers: { 'X-Emby-Token': token } })
            .then(function (res) {
                if (!res.ok) {
                    log('session lookup failed:', res.status);
                    return null;
                }
                return res.json();
            })
            .then(function (sessions) {
                if (!Array.isArray(sessions)) {
                    return null;
                }
                var uid = currentUserId();
                var playing = null;
                for (var i = 0; i < sessions.length; i++) {
                    var s = sessions[i];
                    if (uid && s.UserId && String(s.UserId).toLowerCase() !== String(uid).toLowerCase()) {
                        continue;
                    }
                    if (s.NowPlayingItem && s.NowPlayingItem.Id) {
                        playing = String(s.NowPlayingItem.Id).toLowerCase();
                    }
                }
                if (playing) {
                    log('session lookup resolved playing item:', playing);
                }
                return playing;
            })
            .catch(function () {
                return null;
            });
    }

    function bindVideo(video) {
        playback.video = video;
        playback.src = video.currentSrc || video.src || '';
        playback.intervals = null;
        playback.itemId = null;
        playback.weMuted = false;
        playback.userOverrode = false;
        setIndicator(video, false);
        log('playback: video found, src:', String(playback.src).slice(0, 90) || '(empty)');

        var itemId = itemIdFromSrc(playback.src) || lastDetailsItemId;
        if (itemId) {
            attach(itemId);
            return;
        }

        // blob:/opaque source — resolve via the session API, retrying briefly
        // because a freshly started session may not report NowPlayingItem yet.
        var attempts = 0;
        var trySession = function () {
            if (attempts >= 5 || playback.bindToken !== localToken) {
                return;
            }
            attempts++;
            fetchPlayingItemIdFromSession().then(function (sid) {
                if (playback.bindToken !== localToken) {
                    return;
                }
                if (sid) {
                    attach(sid);
                } else if (attempts < 5) {
                    setTimeout(trySession, 2000);
                } else {
                    log('playback: item id unresolved after session lookups — muting unavailable');
                }
            });
        };
        var localToken = ++playback.bindToken;
        trySession();
    }

    function attach(itemId) {
        var token = ++playback.bindToken;
        playback.itemId = itemId;
        playback.enabled = isEnabledFor(itemId);

        log('playback: binding video, item', itemId, 'enabled:', playback.enabled);
        fetchIntervals(itemId).then(function (intervals) {
            // a newer bind (source change / new episode) supersedes this one
            if (token === playback.bindToken) {
                playback.intervals = intervals;
                if (!intervals) {
                    log('playback: no intervals for this item; muting disabled');
                }
            }
        });
    }

    function tick() {
        try {
            var video = document.querySelector('video');
            if (!video) {
                if (playback.video) {
                    // playback ended / player closed
                    restoreMute(playback.video);
                    playback.video = null;
                    playback.intervals = null;
                    playback.itemId = null;
                    playback.bindToken++;
                }
            } else {
                var src = video.currentSrc || video.src || '';
                if (video !== playback.video || (src && src !== playback.src)) {
                    bindVideo(video);
                }

                if (video !== playback.video) {
                    // element swapped without a source yet — nothing to do this frame
                } else if (playback.intervals && playback.intervals.length) {
                    var t = video.currentTime;
                    var inside = false;
                    for (var i = 0; i < playback.intervals.length; i++) {
                        var iv = playback.intervals[i];
                        if (t >= iv.s && t < iv.e) {
                            inside = true;
                            break;
                        }
                        if (iv.s > t) {
                            break; // sorted — nothing later can match
                        }
                    }

                    if (inside && playback.enabled && !video.ended) {
                        if (playback.weMuted && video.muted === false) {
                            // the viewer unmuted manually — respect that for
                            // the rest of this interval
                            playback.userOverrode = true;
                        }
                        if (!playback.weMuted && !video.muted) {
                            playback.weMuted = true;
                            playback.userOverrode = false;
                            video.muted = true;
                            setIndicator(video, true);
                            log('mute ON at', t.toFixed(2));
                        }
                    } else {
                        restoreMute(video);
                    }
                }
            }
        } catch (e) {
            /* never break playback */
        }
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
})();
