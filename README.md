<p align="center"><img src="icons/icon128.png" width="96" alt="Screen Time Tracker logo"></p>

# Screen Time Tracker

A Chrome extension that shows where your browsing time goes, and helps you take it back. Material You design, private by default.

**Install:** [Chrome Web Store](CHROME_WEB_STORE_LINK) · about 1,000 users

## Features
- Time per website, today and over the week, with clear charts
- Site limits and a calm "blocked" page when a limit is reached
- Habits, focus nudges and a short coach tip each day
- Weekly report as a PDF or email
- New tab page with your day at a glance
- Light and dark Material You themes
- Optional sign in to sync across devices (Supabase)
- Free and Pro plans

## Privacy
Tracking happens in your browser. Nothing leaves your device unless you sign in to sync. See [`pages/privacy.html`](pages/privacy.html).

## Run it locally
1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.

No build step: plain JavaScript (Manifest V3), with Chart.js and jsPDF in `vendor/`.

## Project layout
```
manifest.json      Manifest V3
popup.html         toolbar popup
pages/             dashboard, new tab, welcome, blocked, privacy, sign in
src/               background service worker, content script, UI, charts, habits, reports
icons/             extension icons
vendor/            Chart.js, jsPDF
```

## Contributing
Bug reports and pull requests are welcome. Open an issue first for bigger changes. Please keep the extension private by default: no new tracking or third party scripts.

## License
[MIT](LICENSE) © 2026 Mangesh Lokade
