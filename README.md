# ArabP2P — Nuvio Provider

Stream movies and TV shows from ArabP2P private tracker in Nuvio.

## ⚠️ Requirements

**A debrid service is MANDATORY for playback.**

Nuvio has no torrent engine. Raw torrent/magnet results cannot play without a debrid service converting them to direct streams.

You must configure **one** of these in **Nuvio → Settings → Integrations → Connected Services**:

- TorBox
- Real-Debrid
- Premiumize
- AllDebrid

Without this, the scraper will find torrents but playback will fail.

## Setup

1. **Fork/clone this repository** to your GitHub account.
2. **Edit `providers/arabp2p.js`** and replace:
   - `YOUR_USERNAME_HERE` with your ArabP2P username
   - `YOUR_PASSWORD_HERE` with your ArabP2P password
3. **Commit and push** to GitHub.
4. **Open Nuvio** → Settings → Content & Discovery → Plugins.
5. **Add this repository URL:**
