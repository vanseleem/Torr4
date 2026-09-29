/**
 * Nuvio Provider: ArabP2P
 * Private tracker scraper — Promise-based, Hermes-compatible
 * NO async/await, NO Node modules, NO DOMParser
 */

var ARABP2P_BASE = "https://arabp2p.net";
var ARABP2P_USER = "oalhrbi316";
var ARABP2P_PASS = "zjsnl5B2ba";
var TMDB_KEY = "83d364331c40bfbe29858aeed82f45cc";

var cheerio = require("cheerio-without-node-native");

// ============================================================
// COOKIE JAR
// ============================================================
var cookies = {};
var loggedIn = false;

function getCookieHeader() {
    var parts = [];
    for (var k in cookies) {
        if (cookies.hasOwnProperty(k)) {
            parts.push(k + "=" + cookies[k]);
        }
    }
    return parts.join("; ");
}

function storeCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    var headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (var i = 0; i < headers.length; i++) {
        var nv = headers[i].split(";")[0].trim();
        var eq = nv.indexOf("=");
        if (eq > 0) {
            cookies[nv.substring(0, eq).trim()] = nv.substring(eq + 1).trim();
        }
    }
}

function fetchWithCookies(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    var cookieHeader = getCookieHeader();
    if (cookieHeader) options.headers["Cookie"] = cookieHeader;
    return fetch(url, options).then(function (res) {
        var setCookie = res.headers.get("set-cookie");
        if (setCookie) {
            var parts = setCookie.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
            storeCookies(parts);
        }
        return res;
    });
}

// ============================================================
// PURE-JS SHA1 (no Node crypto)
// ============================================================
function sha1hex(bytes) {
    function rotl(n, b) { return ((n << b) | (n >>> (32 - b))) & 0xFFFFFFFF; }

    var msgLen = bytes.length;
    var bitLen = msgLen * 8;

    var padLen = 64 - ((msgLen + 1) % 64);
    if (padLen === 64) padLen = 0;
    var totalLen = msgLen + 1 + padLen + 8;
    var withPad = new Uint8Array(totalLen);
    for (var i = 0; i < msgLen; i++) withPad[i] = bytes[i];
    withPad[msgLen] = 0x80;

    var lenHigh = Math.floor(bitLen / 0x100000000);
    var lenLow = bitLen >>> 0;
    withPad[totalLen - 8] = (lenHigh >>> 24) & 0xFF;
    withPad[totalLen - 7] = (lenHigh >>> 16) & 0xFF;
    withPad[totalLen - 6] = (lenHigh >>> 8) & 0xFF;
    withPad[totalLen - 5] = lenHigh & 0xFF;
    withPad[totalLen - 4] = (lenLow >>> 24) & 0xFF;
    withPad[totalLen - 3] = (lenLow >>> 16) & 0xFF;
    withPad[totalLen - 2] = (lenLow >>> 8) & 0xFF;
    withPad[totalLen - 1] = lenLow & 0xFF;

    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;

    for (var i = 0; i < withPad.length; i += 64) {
        var w = new Array(80);
        for (var j = 0; j < 16; j++) {
            w[j] = (withPad[i + j*4] << 24) | (withPad[i + j*4 + 1] << 16) | (withPad[i + j*4 + 2] << 8) | withPad[i + j*4 + 3];
        }
        for (var j = 16; j < 80; j++) {
            w[j] = rotl(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1);
        }

        var a = h0, b = h1, c = h2, d = h3, e = h4;

        for (var j = 0; j < 80; j++) {
            var f, k;
            if (j < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
            else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }

            var temp = (rotl(a, 5) + f + e + k + w[j]) & 0xFFFFFFFF;
            e = d; d = c; c = rotl(b, 30); b = a; a = temp;
        }

        h0 = (h0 + a) & 0xFFFFFFFF;
        h1 = (h1 + b) & 0xFFFFFFFF;
        h2 = (h2 + c) & 0xFFFFFFFF;
        h3 = (h3 + d) & 0xFFFFFFFF;
        h4 = (h4 + e) & 0xFFFFFFFF;
    }

    function toHex(n) {
        var s = (n >>> 0).toString(16);
        while (s.length < 8) s = "0" + s;
        return s;
    }

    return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

// ============================================================
// BENCODE PARSER (extract info dict → info hash)
// ============================================================
function skipValue(bytes, i) {
    var b = bytes[i];
    if (b === 0x64) {
        i++;
        while (bytes[i] !== 0x65) { i = skipValue(bytes, i); i = skipValue(bytes, i); }
        return i + 1;
    } else if (b === 0x6C) {
        i++;
        while (bytes[i] !== 0x65) { i = skipValue(bytes, i); }
        return i + 1;
    } else if (b === 0x69) {
        i++;
        while (bytes[i] !== 0x65) i++;
        return i + 1;
    } else if (b >= 0x30 && b <= 0x39) {
        var len = 0;
        while (bytes[i] >= 0x30 && bytes[i] <= 0x39) { len = len * 10 + (bytes[i] - 0x30); i++; }
        i++;
        return i + len;
    }
    return i + 1;
}

function extractInfoHash(bytes) {
    var key = [0x34, 0x3A, 0x69, 0x6E, 0x66, 0x6F]; // "4:info"
    var idx = -1;
    for (var i = 0; i < bytes.length - 6; i++) {
        var match = true;
        for (var j = 0; j < 6; j++) {
            if (bytes[i + j] !== key[j]) { match = false; break; }
        }
        if (match) { idx = i; break; }
    }
    if (idx < 0) return null;

    var start = idx + 6;
    if (bytes[start] !== 0x64) return null;

    var end = skipValue(bytes, start);
    var infoBytes = bytes.slice(start, end);
    return sha1hex(infoBytes);
}

// ============================================================
// LOGIN
// ============================================================
function login() {
    if (loggedIn) return Promise.resolve(true);

    return fetchWithCookies(ARABP2P_BASE + "/index.php?page=login")
        .then(function (res) { return res.text(); })
        .then(function (html) {
            var $ = cheerio.load(html);
            var form = $("form").filter(function (i, el) {
                return $(el).find('input[type="password"]').length > 0;
            }).first();

            if (!form.length) return Promise.reject(new Error("No login form found"));

            var fields = {};
            form.find("input").each(function (i, el) {
                var name = $(el).attr("name");
                var val = $(el).attr("value") || "";
                if (name && name !== "undefined") fields[name] = val;
            });

            var userSet = false, passSet = false;
            for (var k in fields) {
                if (!fields.hasOwnProperty(k)) continue;
                var lower = k.toLowerCase();
                if (lower.indexOf("uid") >= 0 || lower.indexOf("user") >= 0 || lower.indexOf("login") >= 0) {
                    fields[k] = ARABP2P_USER; userSet = true;
                }
                if (lower.indexOf("pwd") >= 0 || lower.indexOf("pass") >= 0) {
                    fields[k] = ARABP2P_PASS; passSet = true;
                }
            }
            if (!userSet) fields.uid = ARABP2P_USER;
            if (!passSet) fields.pwd = ARABP2P_PASS;
            if (!fields.keeplogged) fields.keeplogged = "1";

            var action = form.attr("action") || (ARABP2P_BASE + "/index.php?page=login");
            if (action.indexOf("http") !== 0) {
                action = ARABP2P_BASE + (action.charAt(0) === "/" ? "" : "/") + action;
            }

            var bodyParts = [];
            for (var fk in fields) {
                if (fields.hasOwnProperty(fk)) {
                    bodyParts.push(encodeURIComponent(fk) + "=" + encodeURIComponent(fields[fk]));
                }
            }

            return fetchWithCookies(action, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": ARABP2P_BASE + "/index.php?page=login",
                    "Origin": ARABP2P_BASE
                },
                body: bodyParts.join("&")
            });
        })
        .then(function (res) { return res.text(); })
        .then(function (html) {
            var lower = html.toLowerCase();
            if (lower.indexOf("logout") >= 0 || html.indexOf("تسجيل خروج") >= 0) {
                loggedIn = true;
                return true;
            }
            var $ = cheerio.load(html);
            if ($('input[type="password"]').length === 0) {
                loggedIn = true;
                return true;
            }
            loggedIn = false;
            return false;
        })
        .catch(function (err) {
            console.error("[ArabP2P] Login error: " + err.message);
            return false;
        });
}

// ============================================================
// TMDB RESOLUTION
// ============================================================
function resolveTitle(tmdbId, mediaType) {
    var url = "https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId +
              "?api_key=" + TMDB_KEY + "&language=en-US";
    return fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            return {
                title: data.title || data.name || "",
                year: (data.release_date || data.first_air_date || "").split("-")[0]
            };
        })
        .catch(function () {
            return { title: "", year: "" };
        });
}

// ============================================================
// SEARCH ARABP2P
// ============================================================
function searchArabP2P(query) {
    var url = ARABP2P_BASE + "/index.php?page=torrents&search=" + encodeURIComponent(query);
    return fetchWithCookies(url, {
        headers: { "Referer": ARABP2P_BASE }
    })
    .then(function (res) { return res.text(); })
    .then(function (html) {
        var $ = cheerio.load(html);
        var results = [];

        $('a[href*="page=torrent-details"]').each(function (i, el) {
            var title = $(el).text().trim();
            var detailHref = $(el).attr("href");
            if (!detailHref || !title) return;
            if (detailHref.indexOf("http") !== 0) {
                detailHref = ARABP2P_BASE + (detailHref.charAt(0) === "/" ? "" : "/") + detailHref;
            }

            var row = $(el).closest("tr");
            var downloadHref = row.find('a[href*="page=download"], a[href*="download.php"]').attr("href");
            if (!downloadHref) return;
            if (downloadHref.indexOf("http") !== 0) {
                downloadHref = ARABP2P_BASE + (downloadHref.charAt(0) === "/" ? "" : "/") + downloadHref;
            }

            var cells = row.find("td");
            var size = "Unknown", seeders = "0";
            if (cells.length >= 3) {
                size = cells.eq(cells.length - 3).text().trim();
                seeders = cells.eq(cells.length - 2).text().trim();
            }

            results.push({
                title: title,
                downloadUrl: downloadHref,
                size: size,
                seeders: seeders
            });
        });

        console.log("[ArabP2P] Search '" + query + "' → " + results.length + " results");
        return results;
    })
    .catch(function (err) {
        console.error("[ArabP2P] Search error: " + err.message);
        return [];
    });
}

// ============================================================
// FETCH .TORRENT → EXTRACT INFO HASH
// ============================================================
function getTorrentInfo(downloadUrl) {
    return fetchWithCookies(downloadUrl, {
        headers: { "Referer": ARABP2P_BASE }
    })
    .then(function (res) { return res.arrayBuffer(); })
    .then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        if (bytes[0] !== 0x64) {
            console.error("[ArabP2P] Not a bencoded torrent");
            return null;
        }
        var infoHash = extractInfoHash(bytes);
        if (!infoHash) {
            console.error("[ArabP2P] Could not extract info hash");
            return null;
        }
        return { infoHash: infoHash };
    })
    .catch(function (err) {
        console.error("[ArabP2P] Torrent fetch error: " + err.message);
        return null;
    });
}

// ============================================================
// MAIN getStreams
// ============================================================
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log("[ArabP2P] Request: " + mediaType + " " + tmdbId +
                (seasonNum ? " S" + seasonNum + "E" + episodeNum : ""));

    return resolveTitle(tmdbId, mediaType)
        .then(function (meta) {
            if (!meta.title) {
                console.error("[ArabP2P] Could not resolve title");
                return [];
            }

            return login().then(function (ok) {
                if (!ok) {
                    console.error("[ArabP2P] Login failed");
                    return [];
                }

                // Build search queries
                var queries = [];
                if (mediaType === "tv" && seasonNum) {
                    var s = String(seasonNum).padStart(2, "0");
                    var e = String(episodeNum).padStart(2, "0");
                    queries.push(meta.title + " S" + s);
                    queries.push(meta.title + " S" + s + "E" + e);
                } else {
                    queries.push(meta.year ? meta.title + " " + meta.year : meta.title);
                    queries.push(meta.title);
                }

                // Try each query until we get results
                function tryQuery(index) {
                    if (index >= queries.length) return Promise.resolve([]);
                    return searchArabP2P(queries[index]).then(function (results) {
                        if (results.length > 0) return results;
                        return tryQuery(index + 1);
                    });
                }

                return tryQuery(0);
            });
        })
        .then(function (torrents) {
            if (!torrents || torrents.length === 0) {
                console.log("[ArabP2P] No torrents found");
                return [];
            }

            // Limit to top 10 for performance
            var top = torrents.slice(0, 10);
            var streams = [];

            // Process sequentially to avoid overwhelming the tracker
            var chain = Promise.resolve();
            top.forEach(function (t) {
                chain = chain.then(function () {
                    return getTorrentInfo(t.downloadUrl).then(function (info) {
                        if (!info || !info.infoHash) return;

                        var magnet = "magnet:?xt=urn:btih:" + info.infoHash +
                                     "&dn=" + encodeURIComponent(t.title);

                        streams.push({
                            name: "ArabP2P",
                            title: t.title + "\n👤 " + t.seeders + " seeders | 📦 " + t.size,
                            url: magnet,
                            quality: "Auto",
                            size: t.size,
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                            },
                            provider: "arabp2p"
                        });
                        console.log("[ArabP2P] ✓ " + t.title + " [" + info.infoHash + "]");
                    });
                });
            });

            return chain.then(function () {
                console.log("[ArabP2P] Returning " + streams.length + " streams");
                return streams;
            });
        })
        .catch(function (err) {
            console.error("[ArabP2P] Fatal error: " + err.message);
            return [];
        });
}

// ============================================================
// EXPORT — Nuvio-compatible
// ============================================================
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
}
