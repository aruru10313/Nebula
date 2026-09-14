# Nebula News Service

`news-service` is a separate deployable Node.js application. It is not imported by
the Electron launcher. The stack is:

- Fastify 5 for the HTTP server and JSON APIs
- Prisma 6 with SQLite for admin users, sessions, and announcements
- Password plus TOTP authentication compatible with Google Authenticator
- A React/Vite browser admin SPA, with the production JavaScript bundle
  obfuscated with `javascript-obfuscator`
- Docker Compose for the app/database and Caddy for HTTPS and routing

## Routes

- `GET /api/v1/news` is public, published-only, supports `?limit=1..50`, ETag, and
  short-lived cache headers.
- `/api/v1/admin/*` is session and CSRF protected.
- `POST /api/v1/admin/uploads/image` accepts authenticated PNG, JPG, WEBP, and
  GIF uploads up to 5 MB and stores them under `/news-assets/`.
- `/auth/*` handles administrator-ID/password login, TOTP second-factor verification,
  one-time setup, status, and logout.
- `/aruru/admin/` serves the admin SPA. The production URL is
  `https://mc.aruru.kr/aruru/admin/` (not `/admin`).

Announcements are normalized and stored as plain text. The public site and admin
SPA render them with `textContent`; no announcement HTML is accepted. Images are
selected through the admin drag-and-drop preview or entered as an HTTPS URL.

## Configuration and deployment

1. Copy `.env.example` to `.env` and set every value, including long random
   `SESSION_SECRET`, `TOTP_ENCRYPTION_KEY`, `ADMIN_LOGIN_ID`, and a separate
   one-time `ADMIN_SETUP_TOKEN`. Never commit `.env`.
2. Open `/aruru/admin/` and enter `ADMIN_SETUP_TOKEN` plus a strong password once
   to generate the Google Authenticator QR code. After confirming the first
   six-digit code, future logins require the administrator ID, password, and
   current TOTP code.
3. Run from this directory:

   ```sh
   docker compose up -d --build
   ```

Caddy obtains and renews the certificate for `mc.aruru.kr` automatically when DNS
points to the host and ports 80/443 are reachable. The app also redirects
non-HTTPS requests when `NODE_ENV=production` and trusts Caddy's forwarded
protocol header.

If the Oracle instance already uses Nginx instead of Caddy, use
`nginx.conf.example` as the reverse-proxy configuration. It keeps the existing
static site and forwards `/api/`, `/auth/`, and `/aruru/admin/` to the service:

```sh
sudo cp nginx.conf.example /etc/nginx/sites-available/mc.aruru.kr
sudo ln -sf /etc/nginx/sites-available/mc.aruru.kr /etc/nginx/sites-enabled/mc.aruru.kr
sudo nginx -t
sudo systemctl reload nginx
```

The Node service must be running on `127.0.0.1:3001` before the proxy routes can
serve the API or administrator page. Port 3001 avoids the existing Oracle TTS
service already bound to port 3000. A reload is sufficient; a full Nginx
restart is not required.

For local syntax/build checks without PostgreSQL or OAuth:

```sh
npm install
npm run check
npm run build:admin
```

The reproducible `npm run build:admin` command builds `src/admin-app` with Vite,
then obfuscates the generated JavaScript assets into `admin-dist`. The
`admin-dist` directory is generated and ignored. Obfuscation only makes casual
copying harder; it is not authentication or a security boundary. All
authorization is enforced by the server.

SQLite is intentional for the current single Oracle instance: it avoids
requiring a separate database service, is sufficient for this low-write
announcement workload, and can be backed up by copying `data/news.db`. The
compose app runs `prisma db push` at startup. Back up the `data` directory before
production schema changes.
