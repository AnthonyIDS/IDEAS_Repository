# Merry & Bright — Festive Calendar

A responsive, customizable holiday calendar built with plain HTML, CSS and JavaScript. No installation, dependencies, accounts or build step required.

## Run

Open `index.html` in a modern browser. Alternatively, from this folder run `python3 -m http.server 8080` and visit http://localhost:8080. Keep the same browser and address to retain saved changes.

## Features

- Monthly calendar with multi-day events and weekend-only ranges
- Add, edit, delete and check off events and wish-list ideas
- Promote an idea to the calendar after setting a valid date
- Search and category filters
- Custom calendar title and three color palettes
- Browser-local saving, optional sync across computers, and JSON export/import for backups
- Responsive layout, keyboard-accessible controls and labeled forms

## Your starter calendar

Includes all 11 scheduled events and all 7 ideas supplied. November–December dates use 2026; January–April dates use 2027. Dates and event names are user supplied, not independently verified. Christmas at Dinosaur World retains the supplied `11/37` in its notes and has no start date until corrected. Undated ideas remain in the wish list. Zoo Tampa uses Saturdays and Sundays only within November 28–December 23.

## Storage and privacy

Changes are always saved to localStorage in the current browser, so the calendar works offline. Export a backup before clearing browser data. Import validates the file before replacing anything and requests confirmation. There are no analytics. The repository contains personal schedule seed data; keep it private unless you intend to share that information.

## Sync across computers (optional)

Press **Sync across computers** at the bottom of the page and follow the three steps shown: open the GitHub link (it pre-ticks the `gist` permission), generate a token, and paste it in. Do this once on each computer, using the same token or a new one from the same GitHub account.

- Your calendar, wish list and to-do list are stored in one **secret gist** named `festive-calendar.json` in your GitHub account. The first computer creates it; others find it automatically.
- The page syncs when it opens, about 1.5 seconds after each change, every minute while visible, and whenever you switch back to the tab.
- If two computers change things at the same moment, the most recent save wins.
- The token stays only in that browser. It can only read and write your gists, nothing else. To revoke it, delete it at https://github.com/settings/tokens. **Turn off sync** removes it from the browser.
- When offline or if GitHub is unreachable, changes stay on the browser and sync later.

## Editing the code

Everything is in `index.html`: styles, initial `rows`, data validation and UI behavior. Dates are local calendar dates; trip end dates are inclusive. The initial month is November 2026, with unrestricted month navigation and a Today button.
