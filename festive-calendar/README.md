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
- Browser-local saving; JSON export/import for backups and moving devices
- Responsive layout, keyboard-accessible controls and labeled forms

## Your starter calendar

Includes all 11 scheduled events and all 7 ideas supplied. November–December dates use 2026; January–April dates use 2027. Dates and event names are user supplied, not independently verified. Christmas at Dinosaur World retains the supplied `11/37` in its notes and has no start date until corrected. Undated ideas remain in the wish list. Zoo Tampa uses Saturdays and Sundays only within November 28–December 23.

## Storage and privacy

Changes are saved only to localStorage in the current browser and origin, not back to GitHub and not across devices. Export a backup before clearing browser data or switching addresses. If storage is blocked, a notice asks you to export your changes. Import validates the file before replacing anything and requests confirmation. There are no analytics or external requests. The repository contains personal schedule seed data; keep it private unless you intend to share that information.

## Editing the code

Everything is in `index.html`: styles, initial `rows`, data validation and UI behavior. Dates are local calendar dates; trip end dates are inclusive. The initial month is November 2026, with unrestricted month navigation and a Today button.
