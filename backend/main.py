import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import qrcode
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
VIDEO_DIR = BASE_DIR / "uploads"
IMAGE_DIR = BASE_DIR / "images"
QR_DIR = BASE_DIR / "qrcodes"
META_PATH = BASE_DIR / "uploads.json"

PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "500")) * 1024 * 1024

VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

VIDEO_DIR.mkdir(exist_ok=True)
IMAGE_DIR.mkdir(exist_ok=True)
QR_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Sindoor Digital Studio Media QR API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LiveStaticFiles(StaticFiles):
    """StaticFiles that resolves its directory at request time."""

    def __init__(self, directory_provider, **kwargs):
        super().__init__(directory=None, check_dir=False, **kwargs)
        self.directory_provider = directory_provider

    def lookup_path(self, path):
        self.all_directories = [str(self.directory_provider())]
        return super().lookup_path(path)


app.mount("/videos", LiveStaticFiles(lambda: VIDEO_DIR), name="videos")
app.mount("/images", LiveStaticFiles(lambda: IMAGE_DIR), name="images")
app.mount("/qrcodes", LiveStaticFiles(lambda: QR_DIR), name="qrcodes")


def media_kind(extension: str) -> str:
    if extension in VIDEO_EXTENSIONS:
        return "video"
    if extension in IMAGE_EXTENSIONS:
        return "image"
    return ""


def media_dir(kind: str) -> Path:
    return IMAGE_DIR if kind == "image" else VIDEO_DIR


def media_url(kind: str, saved_name: str) -> str:
    folder = "images" if kind == "image" else "videos"
    return f"{PUBLIC_BASE_URL}/{folder}/{saved_name}"


def qr_url(media_id: str) -> str:
    return f"{PUBLIC_BASE_URL}/qrcodes/{media_id}.png"


def load_meta() -> dict[str, dict]:
    if not META_PATH.exists():
        return {}
    try:
        data = json.loads(META_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def save_meta(meta: dict[str, dict]) -> None:
    META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def sync_meta() -> dict[str, dict]:
    """Backfill metadata for media that exists on disk but not in uploads.json."""
    meta = load_meta()
    changed = False

    for entry_id, entry in list(meta.items()):
        extension = Path(entry.get("filename", "")).suffix.lower()
        kind = media_kind(extension)
        if kind and entry.get("kind") != kind:
            entry["kind"] = kind
            changed = True

    for directory, kind in ((VIDEO_DIR, "video"), (IMAGE_DIR, "image")):
        for path in sorted(directory.iterdir()):
            if not path.is_file():
                continue
            media_id = path.stem
            if media_id not in meta:
                stat = path.stat()
                meta[media_id] = {
                    "id": media_id,
                    "filename": path.name,
                    "extension": path.suffix.lower(),
                    "kind": kind,
                    "size_bytes": stat.st_size,
                    "created_at": datetime.fromtimestamp(
                        stat.st_mtime, timezone.utc
                    ).isoformat(),
                }
                changed = True

    if changed:
        save_meta(meta)
    return meta


def media_entry(media_id: str, meta: dict) -> dict:
    extension = meta.get("extension") or Path(meta.get("filename", "")).suffix.lower()
    kind = meta.get("kind") or media_kind(extension) or "video"
    saved_name = f"{media_id}{extension}"
    url = media_url(kind, saved_name)
    return {
        "id": media_id,
        "filename": meta.get("filename", saved_name),
        "kind": kind,
        "media_url": url,
        "video_url": url,
        "qr_url": qr_url(media_id),
        "size_bytes": meta.get("size_bytes", 0),
        "created_at": meta.get("created_at"),
    }


sync_meta()


@app.get("/")
def home():
    return {"message": "Sindoor Digital Studio API is running"}


@app.get("/api/stats")
def stats():
    meta = sync_meta()
    storage = 0
    for directory in (VIDEO_DIR, IMAGE_DIR):
        storage += sum(
            path.stat().st_size for path in directory.iterdir() if path.is_file()
        )
    videos = [entry for entry in meta.values() if entry.get("kind") != "image"]
    images = [entry for entry in meta.values() if entry.get("kind") == "image"]
    return {
        "total_videos": len(videos),
        "total_images": len(images),
        "total_media": len(meta),
        "total_qr_codes": len([p for p in QR_DIR.iterdir() if p.is_file()]),
        "storage_bytes": storage,
        "public_base_url": PUBLIC_BASE_URL,
    }


@app.get("/api/media")
def list_media():
    meta = sync_meta()
    items = [media_entry(media_id, entry) for media_id, entry in meta.items()]
    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return {"media": items, "videos": items}


@app.get("/api/videos")
def list_videos():
    return list_media()


@app.delete("/api/media/{media_id}")
def delete_media(media_id: str):
    meta = load_meta()
    if media_id not in meta:
        raise HTTPException(status_code=404, detail="Media not found")

    entry = meta.pop(media_id)
    extension = entry.get("extension", "")
    kind = entry.get("kind") or media_kind(extension) or "video"
    (media_dir(kind) / f"{media_id}{extension}").unlink(missing_ok=True)
    (QR_DIR / f"{media_id}.png").unlink(missing_ok=True)
    save_meta(meta)
    return {"message": "Media deleted"}


@app.delete("/api/videos/{media_id}")
def delete_video(media_id: str):
    return delete_media(media_id)


def read_image_size(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            return image.size
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(
            status_code=400, detail="That file is not a valid image"
        ) from error


@app.post("/api/upload")
def upload_media(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is missing")

    extension = Path(file.filename).suffix.lower()
    kind = media_kind(extension)
    if not kind:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only MP4, MOV and WebM videos and JPG, PNG, WEBP and GIF "
                "photos are allowed"
            ),
        )

    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
        )

    media_id = uuid4().hex[:12]
    saved_name = f"{media_id}{extension}"
    file_path = media_dir(kind) / saved_name
    qr_path = QR_DIR / f"{media_id}.png"

    try:
        with file_path.open("wb") as destination:
            shutil.copyfileobj(file.file, destination)

        size_bytes = file_path.stat().st_size
        if size_bytes == 0:
            raise HTTPException(status_code=400, detail="That file is empty")

        if kind == "image":
            read_image_size(file_path)

        qr = qrcode.make(media_url(kind, saved_name))
        qr.save(qr_path)

        meta = load_meta()
        meta[media_id] = {
            "id": media_id,
            "filename": file.filename,
            "extension": extension,
            "kind": kind,
            "size_bytes": size_bytes,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        save_meta(meta)

        return {
            "id": media_id,
            "filename": file.filename,
            "kind": kind,
            "media_url": media_url(kind, saved_name),
            "video_url": media_url(kind, saved_name),
            "qr_url": qr_url(media_id),
            "size_bytes": size_bytes,
            "message": f"{kind.capitalize()} uploaded and QR generated successfully",
        }
    except HTTPException:
        file_path.unlink(missing_ok=True)
        qr_path.unlink(missing_ok=True)
        raise
    except Exception as error:
        file_path.unlink(missing_ok=True)
        qr_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Upload or QR generation failed",
        ) from error
    finally:
        file.file.close()
