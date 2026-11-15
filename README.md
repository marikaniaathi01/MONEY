# MoneyMate — Family Finance Tracker

React + TypeScript + Vite app. **No backend, no database, no login server.**
All records are stored in the browser (localStorage) on each device and the site is hosted free on GitHub Pages.

- First visit: create a family name and a 4-8 digit PIN (a privacy lock for the screen).
- **JSON Backup** downloads all records. **Import** restores them (JSON, or a CSV exported from Supabase). Importing merges by record ID, so it will not duplicate.
- Data is per device/browser. Another phone or browser starts empty until you Import a backup there.
- Clearing browser data deletes the records, so download a backup regularly. Never commit backup files to the repo.

## Run locally
```
npm install
npm run dev
```
Open http://localhost:3000

## Deploy (GitHub Pages)
Push to the `main` branch. In the repo go to Settings -> Pages -> Source -> **GitHub Actions**.
The workflow in `.github/workflows/deploy.yml` builds and publishes the site automatically.
