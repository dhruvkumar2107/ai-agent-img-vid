# Sindoor Digital Studio

A minimal app: upload a video, get a shareable link and a printable QR code.

## Structure

- `backend/` — FastAPI app (`/api/upload`, `/api/stats`, `/api/videos`, `DELETE /api/videos/{id}`)
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
- `PUBLIC_BASE_URL` (default `http://localhost:8000`)
- `FRONTEND_ORIGINS` (default `http://localhost:3000`, comma-separated)
- `MAX_UPLOAD_MB` (default `500`)

### Frontend
- `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`)

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

- Uploaded files are saved under `backend/uploads/`, QRs under `backend/qrcodes/`, metadata in `backend/uploads.json`.
- API base URL is configurable via env vars. If running on another host, set `PUBLIC_BASE_URL` and `NEXT_PUBLIC_API_URL` accordingly.