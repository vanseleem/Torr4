/**
 * Nuvio Provider: ArabP2P
 * Version: 1.0.0
 * Private tracker scraper — Hermes-compatible (no async/await, no DOMParser)
 */

var ARABP2P_USER = "oalhrbi316";
var ARABP2P_PASS = "zjsnl5B2ba";
var BASE_URL = "https://arabp2p.net";

var isLoggedIn = false;
var sessionCookie = "";

// ------------------------------------------------------------
// Login
// ------------------------------------------------------------
function login() {
    if (isLoggedIn) return Promise.resolve(true);

    return fetch(BASE_URL + "/index.php?page=login", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        body: "uid=" + encodeURIComponent(ARABP2P_USER) + "&pwd=" + encodeURIComponent(ARABP2P_PASS) + "&keeplogged=yes"
    })
    .then(function (res) {
        var setCookie = res.headers && res.headers.get ? res.headers.get("set-cookie") : null;
        if (setCookie) {
            // Keep only PHPSESSID (and any auth cookie) — strip attributes
            sessionCookie = setCookie
                .split(",")
                .map(function (c) { return c.split(";")[0].trim(); })
                .join("; ");
        }
        isLoggedIn = true;
        return true;
    })
    .catch(function (err) {
        console.error("[ArabP2P] Login failed:", err);
        return false;
    });
}

// ------------------------------------------------------------
// HTML parsing helpers (regex-based, no DOMParser)
// ------------------------------------------------------------
function extractRows(html) {
    // Find <tr>...</tr> blocks containing a torrent-details link
    var rows = [];
    var trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    var m;
    while ((m = trRegex.exec(html)) !== null) {
        var rowHtml = m[1];
        if (rowHtml.indexOf("page=torrent-details") !== -1) {
            rows.push(rowHtml);
        }
    }
    return rows;
}

function extractAttr(html, attr) {
    var re = new RegExp(attr + '\\s*=\\s*"([^"]+)"', "i");
    var m = html.match(re);
    return m ? m[1] : null;
}

function extractText(html) {
    return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

// ------------------------------------------------------------
// Search
// ------------------------------------------------------------
function searchArabP2P(query) {
    return login().then(function () {
        var url = BASE_URL + "/index.php?page=torrents&search=" + encodeURIComponent(query);
        return fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": BASE_URL,
                "Cookie": sessionCookie
            }
        });
    })
    .then(function (res) { return res.text(); })
    .then(function (html) {
        var streams = [];
        var rows = extractRows(html);

        rows.forEach(function (rowHtml) {
            // Title link
            var titleLinkRegex = /<a[^>]+href="([^"]*page=torrent-details[^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
            var titleMatch = rowHtml.match(titleLinkRegex);
            if (!titleMatch) return;

            var title = extractText(titleMatch[2]);
            if (!title) return;

            // Download link
            var dlRegex = /<a[^>]+href="([^"]*page=download[^"]*)"[^>]*>/i;
            var dlMatch = rowHtml.match(dlRegex);
            if (!dlMatch) {
                // Sometimes it's download.php directly
                dlRegex = /<a[^>]+href="([^"]*download\.php[^"]*)"[^>]*>/i;
                dlMatch = rowHtml.match(dlRegex);
            }
            if (!dlMatch) return;

            var dlHref = dlMatch[1];
            var fullUrl = dlHref.indexOf("http") === 0 ? dlHref : BASE_URL + "/" + dlHref.replace(/^\//, "");

            streams.push({
                name: "ArabP2P",
                title: title,
                url: fullUrl
            });
        });

        console.log("[ArabP2P] Found " + streams.length + " torrents for: " + query);
        return streams;
    })
    .catch(function (err) {
        console.error("[ArabP2P] Search error:", err);
        return [];
    });
}

// ------------------------------------------------------------
// Nuvio Provider Export
// ------------------------------------------------------------
var ArabP2PProvider = {
    name: "ArabP2P Scraper",
    version: "1.0.0",
    getStreams: function (title) {
        return searchArabP2P(title);
    }
};

// Export for React Native (module.exports) and browsers (window)
if (typeof module !== "undefined" && module.exports) {
    module.exports = ArabP2PProvider;
}
if (typeof global !== "undefined") {
    global.nuvioScraper = ArabP2PProvider;
}
if (typeof window !== "undefined") {
    window.nuvioScraper = ArabP2PProvider;
}
