# Cub Scouts Calendar

A simple, fast calendar for a Cub Scouts pack. Anyone can view upcoming events;
editors sign in with a single shared password to add and change events from any
device — phone included. Hosted free on GitHub Pages.

- **Three views**, switchable from a dropdown at any screen size:
  - **Agenda** — a scrollable list of upcoming events (default on phones)
  - **Week** — the current week (default on wider screens is Month)
  - **Month** — a traditional grid
- **Tap an event** for a fullscreen detail panel.
- **Color-coded categories** you can add, rename, recolor, and delete.
- **Editing requires a password.** The password and the GitHub token live in a
  small Cloudflare Worker, never in the website, so they can't be extracted from
  the browser.
- Event descriptions support **clickable links** (paste a URL) and basic
  markdown (**bold**, lists).

## Try it locally right now

No backend needed for local development — it uses your browser's `localStorage`
with bundled sample data.

```bash
npm install
npm run dev
```

Open the printed URL. To try editing, click **Sign in** and use the password
`scouts` (the dev-only default; change it with `VITE_DEV_PASSWORD` in a `.env`
file — see `.env.example`). Edits persist in your browser only.

## How the pieces fit together

```
Browser (GitHub Pages, static)  ──GET──▶  Cloudflare Worker  ──▶  GitHub Gist
        editors type password   ──POST─▶  (holds token +          (calendar.json)
                                           password, checks it)
```

- **Reads** (everyone): the site asks the Worker, which returns the Gist JSON.
- **Writes** (editors): the site sends the password + updated data to the
  Worker; the Worker verifies the password and saves to the Gist.

## Full setup (going live)

### 1. Set up the backend (one time)

Follow [`worker/README.md`](worker/README.md). At the end you'll have a Worker
URL and a password.

### 2. Put this project on GitHub + enable Pages

1. Create a new GitHub repository and push this project to it (`main` branch).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
3. **Settings → Secrets and variables → Actions → Variables → New variable:**
   - Name: `VITE_API_BASE`
   - Value: your Worker URL from step 1 (e.g.
     `https://scouts-calendar.you.workers.dev`)
4. Push to `main` (or run the **Deploy to GitHub Pages** workflow manually). The
   included workflow builds and publishes automatically.

Your site will be at `https://<your-username>.github.io/<repo-name>/`.

> The build sets the correct base path (`/<repo-name>/`) automatically. If you
> later use a custom domain, set the `VITE_BASE` repo variable to `/`.

### 3. Lock down CORS

Once the site is live, set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your
Pages origin and redeploy the Worker (see `worker/README.md`).

## Day-to-day editing

1. Open the site, click **Sign in**, enter the password.
2. **+ Add event**, or tap any event then **Edit** / **Delete**.
3. **Categories** (top bar) to manage labels and colors.

Changes save to the Gist immediately and show up for everyone on their next load.
You stay signed in only for the current browser session.

## Project layout

```
src/
  api.ts                  Talks to the Worker (or localStorage in dev)
  hooks/useCalendarData.ts  Loading, auth session, and save logic
  components/             Views (Agenda/Week/Month), modals, editors
  utils/dates.ts          Date/time formatting helpers
  data/sampleData.ts      Seed data for dev + initial Gist contents
worker/                   Cloudflare Worker backend + its setup guide
.github/workflows/        GitHub Pages deploy
```

## Tech

Vite • React • TypeScript • Tailwind CSS v4 • date-fns • react-markdown.
Built without a charting library — the views are plain, responsive components.
