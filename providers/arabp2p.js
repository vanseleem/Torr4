/**
 * Stremio Addon: ArabP2P
 * Version: 1.4.0 — Proper XBTIT session handling
 */

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// ============================================================
// 🔧 CONFIGURATION
// ============================================================
const ARABP2P_USERNAME = process.env.ARABP2P_USERNAME || "oalhrbi316";
const ARABP2P_PASSWORD = process.env.ARABP2P_PASSWORD || "zjsnl5B2ba";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "83d364331c40bfbe29858aeed82f45cc";
const ARABP2P_BASE_URL = "https://arabp2p.net";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// ============================================================
// 🌐 HTTP CLIENT
// ============================================================
const cookieJar = {};

const httpClient = axios.create({
    timeout: 25000,
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.3",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1"
    },
    maxRedirects: 0,
    validateStatus: () => true
});

httpClient.interceptors.request.use((config) => {
    const cookieHeader = Object.entries(cookieJar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    if (cookieHeader) config.headers['Cookie'] = cookieHeader;
    return config;
});

httpClient.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
        (Array.isArray(setCookie) ? setCookie : [setCookie]).forEach(c => {
            const parts = c.split(';');
            const nameValue = parts[0].trim();
            const eqIdx = nameValue.indexOf('=');
            if (eqIdx > 0) {
                const name = nameValue.substring(0, eqIdx).trim();
                const value = nameValue.substring(eqIdx + 1).trim();
                if (value) cookieJar[name] = value;
            }
        });
    }
    return response;
});

// ============================================================
// 📦 BENCODE
// ============================================================
function skipBencode(buf, i) {
    const b = buf[i];
    if (b === 0x64) {
        i++;
        while (buf[i] !== 0x65) { i = skipBencode(buf, i); i = skipBencode(buf, i); }
        return i + 1;
    } else if (b === 0x6C) {
        i++;
        while (buf[i] !== 0x65) { i = skipBencode(buf, i); }
        return i + 1;
    } else if (b === 0x69) {
        i++;
        while (buf[i] !== 0x65) i++;
        return i + 1;
    } else if (b >= 0x30 && b <= 0x39) {
        let len = 0;
        while (buf[i] >= 0x30 && buf[i] <= 0x39) { len = len * 10 + (buf[i] - 0x30); i++; }
        i++;
        return i + len;
    }
    throw new Error(`Invalid bencode byte at ${i}: ${b}`);
}

function extractInfoHash(buf) {
    const key = Buffer.from('4:info');
    const idx = buf.indexOf(key);
    if (idx === -1) return null;
    const dictStart = idx + key.length;
    if (buf[dictStart] !== 0x64) return null;
    const end = skipBencode(buf, dictStart);
    return crypto.createHash('sha1').update(buf.slice(dictStart, end)).digest('hex');
}

function extractAnnounce(buf) {
    const key = Buffer.from('8:announce');
    const idx = buf.indexOf(key);
    if (idx === -1) return null;
    let i = idx + key.length;
    let len = 0;
    while (buf[i] >= 0x30 && buf[i] <= 0x39) { len = len * 10 + (buf[i] - 0x30); i++; }
    if (buf[i] !== 0x3A) return null;
    i++;
    return buf.slice(i, i + len).toString('utf8');
}

// ============================================================
// 🔐 LOGIN — XBTIT proper flow
// ============================================================
let isLoggedIn = false;

async function login(force = false) {
    if (isLoggedIn && !force) return true;

    try {
        console.log("\n[LOGIN] ========== LOGIN FLOW START ==========");
        
        console.log(`[LOGIN] GET ${ARABP2P_BASE_URL}/index.php?page=login`);
        const loginPageResp = await httpClient.get(`${ARABP2P_BASE_URL}/index.php?page=login`);
        console.log(`[LOGIN] Got login page, status: ${loginPageResp.status}`);
        console.log(`[LOGIN] Cookies: ${JSON.stringify(cookieJar)}`);

        const $ = cheerio.load(loginPageResp.data);
        const form = $('form').filter((i, el) => $(el).find('input[type="password"]').length > 0).first();

        if (!form.length) {
            console.error("[LOGIN] ❌ No form found");
            return false;
        }

        const formFields = {};
        form.find('input, button').each((i, el) => {
            const $el = $(el);
            const name = $el.attr('name');
            const value = $el.attr('value') || '';
            if (name && name !== 'undefined') {
                formFields[name] = value;
            }
        });

        console.log("[LOGIN] Form fields before injection:", Object.keys(formFields));

        Object.keys(formFields).forEach(key => {
            const lower = key.toLowerCase();
            if (['uid', 'username', 'user', 'login', 'email', 'uname'].some(k => lower.includes(k))) {
                formFields[key] = ARABP2P_USERNAME;
            }
            if (['pwd', 'password', 'pass', 'passwd'].some(k => lower.includes(k))) {
                formFields[key] = ARABP2P_PASSWORD;
            }
        });

        if (!Object.keys(formFields).some(k => k.toLowerCase().includes('user'))) {
            formFields.uid = ARABP2P_USERNAME;
        }
        if (!Object.keys(formFields).some(k => k.toLowerCase().includes('pass'))) {
            formFields.pwd = ARABP2P_PASSWORD;
        }

        if (!formFields.keeplogged && !formFields.remember) {
            formFields.keeplogged = '1';
        }

        console.log("[LOGIN] Final form fields:", Object.keys(formFields));

        let action = form.attr('action') || '';
        if (!action) action = `${ARABP2P_BASE_URL}/index.php?page=login`;
        else if (!action.startsWith('http')) action = new URL(action, ARABP2P_BASE_URL).href;

        const body = new URLSearchParams(formFields).toString();
        const safeBody = body.replace(ARABP2P_PASSWORD, '***');
        console.log(`[LOGIN] POST ${action}`);
        console.log(`[LOGIN] Body: ${safeBody}`);

        const loginResp = await httpClient.post(action, body, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': loginPageResp.config.url,
                'Origin': ARABP2P_BASE_URL
            }
        });

        console.log(`[LOGIN] POST status: ${loginResp.status}`);
        console.log(`[LOGIN] Cookies after POST: ${JSON.stringify(cookieJar)}`);

        if ([301, 302, 303, 307].includes(loginResp.status)) {
            const redirectUrl = loginResp.headers.location;
            console.log(`[LOGIN] Redirect to: ${redirectUrl}`);
            const redirectResp = await httpClient.get(redirectUrl);
            console.log(`[LOGIN] Redirect status: ${redirectResp.status}`);
            console.log(`[LOGIN] Cookies after redirect: ${JSON.stringify(cookieJar)}`);
        }

        console.log("[LOGIN] Verifying access to torrents...");
        const verifyResp = await httpClient.get(`${ARABP2P_BASE_URL}/index.php?page=torrents`);
        const verifyHtml = String(verifyResp.data).toLowerCase();

        if (verifyHtml.includes('type="password"') || verifyHtml.includes('page=login')) {
            console.error("[LOGIN] ❌ Still on login page after verification");
            console.log("[LOGIN] First 1000 chars:", String(verifyResp.data).substring(0, 1000));
            return false;
        }

        if (verifyHtml.includes('torrent') || verifyHtml.includes('page=torrent-details') || 
            verifyHtml.includes('seed') || verifyHtml.includes('download')) {
            console.log("[LOGIN] ✅ SUCCESS — Access to torrents verified");
            isLoggedIn = true;
            return true;
        }

        console.error("[LOGIN] ❌ No torrent content found");
        return false;

    } catch (error) {
        console.error("[LOGIN] ❌ Exception:", error.message);
        return false;
    }
}

// ============================================================
// 🎬 TMDB
// ============================================================
async function resolveImdbToTitle(imdbId, type) {
    const baseId = imdbId.split(':')[0];
    try {
        const r = await axios.get(
            `${TMDB_BASE_URL}/find/${baseId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
            { timeout: 10000 }
        );
        const data = r.data;
        let title = "", year = "";
        if (type === 'movie' && data.movie_results?.length > 0) {
            title = data.movie_results[0].title;
            year = (data.movie_results[0].release_date || "").split("-")[0];
        } else if (type === 'series' && data.tv_results?.length > 0) {
            title = data.tv_results[0].name;
            year = (data.tv_results[0].first_air_date || "").split("-")[0];
        }
        console.log(`[TMDB] ${baseId} → "${title}" (${year})`);
        return { title, year };
    } catch (error) {
        console.error("[TMDB] ❌", error.message);
        return { title: "", year: "" };
    }
}

// ============================================================
// 🔍 SEARCH
// ============================================================
async function searchArabP2P(query) {
    try {
        const url = `${ARABP2P_BASE_URL}/index.php?page=torrents&search=${encodeURIComponent(query)}`;
        console.log("[SEARCH] GET", url);
        const response = await httpClient.get(url);

        if (response.status !== 200) {
            console.log(`[SEARCH] Non-200 status: ${response.status}`);
            return [];
        }

        const $ = cheerio.load(response.data);
        const torrents = [];

        $('a[href*="page=torrent-details"]').each((i, el) => {
            const title = $(el).text().trim();
            let detailHref = $(el).attr('href');
            if (!detailHref || !title) return;
            if (!detailHref.startsWith('http')) {
                detailHref = new URL(detailHref, ARABP2P_BASE_URL).href;
            }

            const row = $(el).closest('tr');
            let downloadHref = row.find('a[href*="page=download"], a[href*="download.php"]').attr('href');
            if (!downloadHref) return;
            if (!downloadHref.startsWith('http')) {
                downloadHref = new URL(downloadHref, ARABP2P_BASE_URL).href;
            }

            const cells = row.find('td');
            let size = 'Unknown', seeders = '0';
            if (cells.length >= 3) {
                size = cells.eq(cells.length - 3).text().trim();
                seeders = cells.eq(cells.length - 2).text().trim();
            }

            torrents.push({ title, downloadUrl: downloadHref, size, seeders });
            console.log(`[SEARCH] ✓ ${title} (${size}, ${seeders}s)`);
        });

        console.log(`[SEARCH] Found ${torrents.length} torrents`);
        return torrents;
    } catch (error) {
        console.error("[SEARCH] ❌", error.message);
        return [];
    }
}

// ============================================================
// 📦 TORRENT FETCH
// ============================================================
async function getTorrentInfo(downloadUrl) {
    try {
        const res = await httpClient.get(downloadUrl, {
            responseType: 'arraybuffer',
            headers: { Referer: ARABP2P_BASE_URL }
        });
        const buffer = Buffer.from(res.data);
        if (buffer[0] !== 0x64) {
            console.error("[TORRENT] Not bencoded");
            return null;
        }
        const infoHash = extractInfoHash(buffer);
        const announce = extractAnnounce(buffer);
        return { infoHash, announce };
    } catch (error) {
        console.error("[TORRENT] ❌", error.message);
        return null;
    }
}

// ============================================================
// 🎥 ADDON
// ============================================================
const manifest = {
    id: "org.arabp2p.stremio",
    version: "1.4.0",
    name: "ArabP2P",
    description: "Stream movies and TV shows from ArabP2P.",
    logo: "https://arabp2p.net/favicon.ico",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async (args) => {
    const { type, id } = args;
    console.log(`\n===== [STREAM] type=${type} id=${id} =====`);

    if (!await login()) {
        console.error("[RESULT] ❌ Login failed");
        return { streams: [] };
    }

    const { title, year } = await resolveImdbToTitle(id, type);
    if (!title) {
        console.error("[RESULT] ❌ TMDB lookup failed");
        return { streams: [] };
    }

    let searchTitle = title;
    if (type === 'series') {
        const parts = id.split(':');
        if (parts.length >= 3) {
            const s = parts[1].padStart(2, '0');
            const e = parts[2].padStart(2, '0');
            searchTitle = `${title} S${s}E${e}`;
        }
    }

    let torrents = await searchArabP2P(year ? `${searchTitle} ${year}` : searchTitle);
    if (torrents.length === 0 && year) torrents = await searchArabP2P(searchTitle);
    if (torrents.length === 0) torrents = await searchArabP2P(title);

    if (torrents.length === 0) {
        console.error("[RESULT] ❌ No torrents found");
        return { streams: [] };
    }

    const streams = [];
    for (const t of torrents.slice(0, 10)) {
        const info = await getTorrentInfo(t.downloadUrl);
        if (!info || !info.infoHash) continue;

        const sources = [];
        if (info.announce) sources.push(info.announce);
        sources.push(
            "udp://tracker.openbittorrent.com:80",
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://open.stealth.si:80/announce"
        );

        streams.push({
            name: "ArabP2P",
            title: `${t.title}\n👤 ${t.seeders}s | 📦 ${t.size}`,
            infoHash: info.infoHash,
            sources: sources,
            behaviorHints: { notWebReady: false }
        });
        console.log(`[STREAM] ✓ ${t.title} [${info.infoHash}]`);
    }

    console.log(`[RESULT] ✅ ${streams.length} streams`);
    return { streams };
});

const addonInterface = builder.getInterface();
const port = process.env.PORT || 7860;
serveHTTP(addonInterface, { port });

console.log(`\n✅ ArabP2P v1.4.0 on port ${port}\n`);
