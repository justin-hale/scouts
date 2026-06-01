# Calendar backend (Cloudflare Worker)

This tiny Worker is the only thing that holds your GitHub token and editor
password. The website talks to it; editors only ever type a password.

You set this up **once**. It's free (Cloudflare's free tier is far more than
this needs).

## 1. Create the Gist that stores events

1. Go to <https://gist.github.com>.
2. Filename: `calendar.json`
3. Paste this starter content:
   ```json
   { "categories": [], "events": [] }
   ```
4. Click **Create secret gist** (secret = unlisted, not private — the Worker can
   still read/write it with your token).
5. Copy the **Gist ID** from the URL: `https://gist.github.com/you/<THIS_PART>`.

## 2. Create a GitHub token (lets the Worker edit the Gist)

1. <https://github.com/settings/tokens?type=beta> → **Generate new token**
   (fine-grained).
2. Expiration: your choice (you'll regenerate later).
3. **Account permissions → Gists → Read and write.**
4. Generate and copy the token (starts with `github_pat_…`). You won't see it
   again.

## 3. Deploy the Worker

You need a free Cloudflare account. From this `worker/` folder:

```bash
cd worker
npx wrangler login                      # opens browser, one time
# put your Gist ID into wrangler.toml (GIST_ID), then:
npx wrangler secret put GITHUB_TOKEN    # paste the github_pat_… token
npx wrangler secret put ADMIN_PASSWORD  # choose the password editors will type
npx wrangler deploy
```

`deploy` prints a URL like
`https://scouts-calendar.<your-subdomain>.workers.dev`. **Copy it.**

## 4. Point the website at the Worker

In the repo's GitHub Pages settings (see the main `README.md`), set the
repository **variable** `VITE_API_BASE` to that Worker URL. Redeploy the site.

## 5. Lock down CORS (recommended)

Once your site is live at `https://yourname.github.io`, edit `wrangler.toml`:

```toml
ALLOWED_ORIGIN = "https://yourname.github.io"
```

then `npx wrangler deploy` again.

## Updating the password later

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Editors are signed out automatically (the password is only kept for their
browser session), so they'll just enter the new one next time.

## Endpoints (for reference)

| Method | Path      | Auth      | Purpose                       |
| ------ | --------- | --------- | ----------------------------- |
| GET    | `/`       | none      | Read the calendar JSON        |
| POST   | `/verify` | password  | Check a password (sign-in)    |
| POST   | `/`       | password  | Save the whole calendar JSON  |
