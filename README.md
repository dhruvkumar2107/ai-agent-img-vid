# Sindoor Digital Studio

A minimal app: upload a **photo or video**, get a shareable link and a printable QR code.

## Structure

- `backend/` — FastAPI app (`/api/upload`, `/api/stats`, `/api/media`, `DELETE /api/media/{id}`)
- `frontend/` — Next.js 16 + React 19 + Tailwind 4 app router

## Quick start

### Backend

1. `cd backend`
2. `python -m venv .venv && .venv\Scripts\activate` (Windows)
3. `pip install -r requirements.txt` (or `pip install -r requirements-dev.txt` for tests)
4. `.venv\Scripts\uvicorn main:app --port 8000 --reload`

### Frontend

1. `cd frontend`
2. `npm install`
3. `npm run dev`
4. Open http://localhost:3000

## Environment variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLIC_BASE_URL` | (auto) | Public origin for QR codes & shareable links. **If unset, "auto", or a loopback address (localhost/127.0.0.1), the origin is derived from the incoming request headers** (`X-Forwarded-Proto`, `X-Forwarded-Host`, `Host`). Set explicitly only when running behind a proxy that doesn't forward the original host. |
| `FRONTEND_ORIGINS` | `http://localhost:3000` | Comma-separated list of allowed CORS origins (e.g. `https://myapp.vercel.app,https://myapp.example.com`). |
| `MAX_UPLOAD_MB` | `500` | Maximum upload size in megabytes. |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API base URL (must match the public origin used by the backend). |

## Deployment

### Render (Backend) + Vercel (Frontend) — Recommended

1. **Render**: Create a Web Service from this repo. Set Root Directory to `backend/`. Build Command: `pip install -r requirements.txt`. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
   - Add env vars: `FRONTEND_ORIGINS=https://your-frontend.vercel.app` (and any other origins). **Do not set `PUBLIC_BASE_URL`** — the service auto-detects its public URL from Render's proxy headers.
   - **Important**: Render Free tier uses an **ephemeral filesystem**. Uploaded files and `uploads.json` are lost on every deploy/restart. For persistence, attach a Render Disk (Settings → Disks) and mount it at `/app/uploads`, `/app/images`, `/app/qrcodes`, then update `VIDEO_DIR`, `IMAGE_DIR`, `QR_DIR`, `META_PATH` in `main.py` or via env vars.

2. **Vercel**: Import the repo. Set Root Directory to `frontend/`. Add env var `NEXT_PUBLIC_API_URL=https://your-backend.onrender.com`.

3. Push to `main` — both platforms auto-deploy.

### Docker (Single host)

```bash
docker build -t sindoor-studio .
docker run -p 8000:8000 -e PUBLIC_BASE_URL=https://your.domain -e FRONTEND_ORIGINS=https://your.domain sindoor-studio
```

## Tests

### Backend

```bash
cd backend
.venv\Scripts\pytest -v
```

## Build

### Frontend

```bash
cd frontend
npm run build
npm run start
```

## Notes

- **Photo & video support**: Both `image/*` and `video/*` uploads are accepted. Photos are served from `/images/`, videos from `/videos/`.
- **QR codes** are generated per upload and served from `/qrcodes/{id}.png`.
- **Self-healing QR**: If the public origin changes (e.g. first deploy had `PUBLIC_BASE_URL=http://localhost:8000`, then it's unset), existing QR codes are regenerated on the next API request so scanned links point to the new origin.
- **Placeholder files**: `.gitkeep` files in `uploads/`, `images/`, `qrcodes/` are ignored and never appear in the media list.
- API base URL is configurable via env vars. If running on another host, set `PUBLIC_BASE_URL` and `NEXT_PUBLIC_API_URL` accordingly.