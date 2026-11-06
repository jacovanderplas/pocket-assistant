# Pocket – personal assistant

A small installable web app (PWA) for your phone: **shopping list**, **to-dos** and **appointments**, with a **Today** overview. It works offline. Everything is stored on the phone itself; nothing is sent anywhere.

## Features

- **Shopping:** quick add (“2 milk”, “500g flour” sets a quantity), suggestions from earlier items, tick off into the basket, clear the basket.
- **To-dos:** quick add (end with “today” or “tomorrow” to set a due date), grouped into Overdue / Today / Upcoming / Any time, plus notes.
- **Calendar:** appointments with date, start/end time, location and notes. **Add to phone calendar** exports an `.ics` file with a 30-minute reminder, so your phone handles the alerts.
- **Today:** today's appointments, what's due, and what to buy, all on one screen.
- Undo after deleting or clearing, dark mode, and app shortcuts on Android (long-press the icon).
- **Backup:** ⋯ → Export backup / Restore from backup. Use it now and then, and when you move to a new phone.

## Files

No build step and no dependencies: plain HTML, CSS and JS.

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | the app |
| `manifest.webmanifest` | name, icons, colours for installing |
| `sw.js` | service worker (offline). **Bump `CACHE` when you change files.** |
| `icons/` | app icons (SVG source + rendered PNGs) |

## Putting it on your phone

A PWA has to be served over **HTTPS** before a phone will install it. Any free static host works. For example:

**GitHub Pages:** create a repository, upload the contents of this folder, then go to *Settings → Pages → Deploy from branch → main / root*. You get a URL like `https://<you>.github.io/pocket-assistant/`.

Then open that URL on the phone:

- **iPhone:** in **Safari**, tap Share → **Add to Home Screen**.
- **Android:** in Chrome, tap **Install** (the banner on the Today screen) or menu → **Install app**.

Once installed it opens full-screen and works without a connection.

> Your data lives in that installed app on that phone. Removing the app or clearing the browser's site data deletes it, so keep a backup.

## Trying it on a PC

Serve the folder with any static server (e.g. `npx http-server` or `python -m http.server`) and open `http://localhost:<port>`. Service workers are allowed on `localhost`.
