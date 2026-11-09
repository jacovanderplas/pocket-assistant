# Pocket – personal assistant

A small installable web app (PWA) for your phone: **shopping list**, **to-dos** and **appointments**, with a **Today** overview. It works offline. Everything is stored on the phone itself; nothing is sent anywhere.

## Features

- **Shopping:** quick add (“2 milk”, “500g flour” sets a quantity), suggestions from earlier items, tick off into the basket, clear the basket.
- **To-dos:** quick add (end with “today” or “tomorrow” to set a due date), grouped into Overdue / Today / Upcoming / Any time, plus notes.
- **Calendar:** appointments with date, start/end time, location and notes. **Add to phone calendar** exports an `.ics` file with a 30-minute reminder, so your phone handles the alerts.
- **Cooking sessions:** + → *Cooking session* suggests a recipe (filter: vegetarian / quick, never something cooked in the last 3 weeks), or pick one yourself. Choose the servings and the ingredients scale with them. Tick what you need, and those items go onto the shopping list. Amounts are merged with items already on the list, and each item notes which recipe it's for. Pantry basics (salt, pepper, oil) start unticked. The method is in the session too.
- **AI suggestions (optional):** in the cooking planner, type what you fancy ("something with chicken", or leave it empty) and tap **✨ Ask AI**. Claude suggests a recipe for your number of servings that avoids recent dishes and can use what's already on your shopping list. Its ingredients work like any other recipe's, and you can save it to *My recipes*. Set up under ⋯ → *AI suggestions* with your own Anthropic API key (console.anthropic.com, pay-as-you-go; tip: create a key just for Pocket and set a monthly spend limit). The key is stored only on the phone and is never part of a backup. Choose Claude Opus 5.5 (best) or Claude Haiku 5.5 (cheapest). Needs internet; the Claude JS SDK is loaded from jsDelivr on first use.
- **Voice:** tap the 🎙 mic at the top and say things like "buy milk, eggs and bread", "remind me to call Anna tomorrow", "dentist on Friday at 3 pm" or "cook on Saturday". Pocket files it in the right place: shopping items and to-dos are added at once (with Undo), appointments and cooking sessions open prefilled for you to check. If it can't tell, it asks which list. The mic in the Shopping and To-do add bars dictates straight into that list ("apples and 500 g flour" adds two items). Commands are understood in English and German; choose the speech language under ⋯ → *Voice*. Uses the browser's own speech recognition (Chrome/Edge on Android, Safari on iPhone), which sends the audio to Google or Apple to turn it into text and needs a connection. The mic buttons are hidden in browsers without it.
- **Recipes:** 28 built-in (in `recipes.js`), plus your own under ⋯ → *My recipes* (one ingredient per line, e.g. `400 g spaghetti`).
- **Today:** today's appointments, what's due, and what to buy, all on one screen.
- Undo after deleting or clearing, dark mode, and app shortcuts on Android (long-press the icon).
- **Backup:** ⋯ → Export backup / Restore from backup. Use it now and then, and when you move to a new phone.

## Files

No build step and no dependencies: plain HTML, CSS and JS.

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | the app |
| `recipes.js` | built-in recipe collection |
| `voice.js` | voice input: speech recognition and understanding spoken commands |
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
