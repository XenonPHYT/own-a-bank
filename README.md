# Own A Bank

A browser-based, single-player institutional banking simulator prototype.

## Deploy through Cloudflare's GitHub integration

This project is configured for the **Continue with GitHub / Connect to Git** deployment flow. You do not need a Cloudflare API token or account ID in GitHub Actions secrets, and this repository does not include a GitHub Actions deployment workflow.

1. Push the contents of this project to a GitHub repository.
2. Sign in to the Cloudflare dashboard.
3. Open **Workers & Pages** and choose **Create application** / **Create Worker**, then select the Git repository import or **Continue with GitHub** option (the exact label may vary).
4. Authorize Cloudflare to access the repository and select the Own A Bank repository and production branch (usually `main`).
5. Configure the build settings:
   - **Build command:** leave blank / none
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/` (the repository root)
6. Deploy.

Cloudflare reads `wrangler.jsonc`. It deploys the static frontend from `public/` and the lightweight Worker from `worker/index.js` together. After the initial connection, pushes to the connected production branch trigger deployments through Cloudflare's Git integration.

### Why there is no deploy.yml

The Git integration itself checks out the repository and runs the configured deploy command. A GitHub Actions workflow that runs `wrangler deploy` would be a second deployment path and would require storing a Cloudflare API token and account ID as GitHub secrets. That is not needed for this setup, so the previous `.github/workflows/deploy.yml` has been removed.

No D1 database, KV namespace, `schema.sql`, API token, or account ID is required by this prototype.

## Run locally

This project is a static web application with a Python simulation layer powered by Pyodide.

```bash
cd public
python -m http.server 8080
```

Then open <http://localhost:8080>.

Do not open `index.html` directly with `file://`; browser module loading, IndexedDB, and Pyodide need an HTTP origin.

## Project structure

- `public/index.html` — application shell
- `public/src/styles.css` — responsive multi-theme styling
- `public/src/app.js` — interface, actions, IndexedDB saves, and browser integration
- `public/src/simulation.py` — Python simulation logic executed by Pyodide
- `public/src/datasets.json` — starter raw vocabulary, contextual terms, and probability ranges
- `public/_headers` — Cloudflare Pages/Workers static asset response headers
- `worker/index.js` — Worker entrypoint that serves the static assets
- `wrangler.jsonc` — Cloudflare deployment configuration
- `package.json` — optional local Wrangler development dependency and scripts

## Current prototype scope

Implemented:
- Three independent save slots with export/import
- Difficulty selection that changes guidance and simulation pressure, not core banking rules or the starting bank identity
- Dynamic simulation ticks and contextual events
- Bank level progression
- Hiring and employee management
- Deposits, withdrawals, loans, repayments, liquidity, capital, revenue, expenses, and non-performing loans
- Competitor institutions with independent simulated behavior
- Event log and decision prompts
- 1× / 2× simulation speed
- Offline catch-up capped at 24 hours
- Multiple visual themes
- Responsive layout

This is a playable prototype, not a production banking model. Financial formulas and regulatory requirements are simplified for gameplay. No real money, real bank accounts, or real financial transactions are involved.

## Important technical notes

- Pyodide is loaded from its official CDN at runtime, so the first load requires an internet connection. A separate Pyodide download workflow is not required for the current CDN-based setup.
- Save data is stored locally in IndexedDB. Exported JSON files are portable between browsers/devices.
- The application uses versioned save data and performs basic migrations on import/load.
- The current build is single-player. The data model includes stable IDs and ownership fields to make a later server-backed multiplayer migration easier, but multiplayer is not implemented.
- The project does not require a manually executed `schema.sql`; browser storage is initialized by application code. A future server database will still need managed migrations.
