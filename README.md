# MoneyMate — Family Finance Tracker

React + TypeScript + Vite app, hosted free on GitHub Pages.
Records are stored in **a private GitHub repository** (one file, `data.json`), so every device
(Android, iOS, Windows...) that is connected to it shows the same data. No SQL, no server.

## How it works
- The website repo (`MONEY`) is public and holds only the app code.
- A second repo, **private**, called `moneymate-data` holds `data.json` (your records).
- Each device is set up once with: family name, GitHub username, data repo name, an access token and a PIN.
- The app saves on the device first, then syncs with GitHub (when you save, every 30 seconds, and when the app is reopened).
- Works offline: changes stay on the device and sync when the internet is back.
- Deletes are tracked, so a record deleted on one phone does not come back from another.
- **JSON Backup / Import** still work. Import also accepts a CSV exported from Supabase.

## One-time setup
1. Create a **Private** repo named `moneymate-data` (tick "Add a README file").
2. Create a fine-grained token: GitHub -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens.
   Repository access: **Only select repositories** -> `moneymate-data`. Permissions -> Repository permissions -> **Contents: Read and write**.
3. Open the site and fill the setup screen on the first device. On a connected device tap **Share setup link** and send the link privately to a family phone: it fills in the GitHub details, so only a name and PIN are needed there.

## Safety notes
- The token is stored on that device (browser storage). It can only reach the one data repo.
- The PIN is only a screen lock for that device.
- Never put `data.json` or backup files in the public repo.

## Run locally
```
npm install
npm run dev
```

## Deploy (GitHub Pages)
Push to `main`. Settings -> Pages -> Source -> **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` builds and publishes.
