import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 128


def make_png_bytes(color=(255, 0, 120)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (240, 160), color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    images = tmp_path / "images"
    qrcodes = tmp_path / "qrcodes"
    uploads.mkdir()
    images.mkdir()
    qrcodes.mkdir()
    monkeypatch.setattr(main, "VIDEO_DIR", uploads)
    monkeypatch.setattr(main, "IMAGE_DIR", images)
    monkeypatch.setattr(main, "QR_DIR", qrcodes)
    monkeypatch.setattr(main, "META_PATH", tmp_path / "uploads.json")
    with TestClient(main.app) as test_client:
        yield test_client


def upload_files(name: str = "clip.mp4", content: bytes = FAKE_MP4):
    return {"file": (name, io.BytesIO(content), "video/mp4")}


def upload_photo(name: str = "photo.png", content: bytes | None = None):
    payload = content if content is not None else make_png_bytes()
    return {"file": (name, io.BytesIO(payload), "image/png")}


def test_home(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "message" in response.json()


def test_upload_creates_video_and_qr(client):
    response = client.post("/api/upload", files=upload_files("my clip.mp4"))
    assert response.status_code == 200
    body = response.json()

    assert body["filename"] == "my clip.mp4"
    assert len(body["id"]) == 12
    assert body["kind"] == "video"
    assert body["video_url"].endswith(f"/videos/{body['id']}.mp4")
    assert body["media_url"] == body["video_url"]
    assert body["qr_url"].endswith(f"/qrcodes/{body['id']}.png")
    assert body["size_bytes"] == len(FAKE_MP4)

    video_path = main.VIDEO_DIR / f"{body['id']}.mp4"
    qr_path = main.QR_DIR / f"{body['id']}.png"
    assert video_path.exists()
    assert qr_path.exists()
    assert qr_path.read_bytes()[:8] == PNG_MAGIC


def test_upload_creates_photo_and_qr(client):
    response = client.post("/api/upload", files=upload_photo())
    assert response.status_code == 200
    body = response.json()

    assert body["filename"] == "photo.png"
    assert body["kind"] == "image"
    assert body["media_url"].endswith(f"/images/{body['id']}.png")
    assert body["video_url"] == body["media_url"]
    assert body["qr_url"].endswith(f"/qrcodes/{body['id']}.png")
    assert body["size_bytes"] > 0

    image_path = main.IMAGE_DIR / f"{body['id']}.png"
    qr_path = main.QR_DIR / f"{body['id']}.png"
    assert image_path.exists()
    assert qr_path.exists()
    assert qr_path.read_bytes()[:8] == PNG_MAGIC

    with Image.open(image_path) as image:
        assert image.size == (240, 160)


def test_upload_photo_is_served_over_http(client):
    uploaded = client.post("/api/upload", files=upload_photo()).json()

    response = client.get(f"/images/{uploaded['id']}.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"

    qr_response = client.get(f"/qrcodes/{uploaded['id']}.png")
    assert qr_response.status_code == 200
    assert qr_response.content[:8] == PNG_MAGIC


def test_upload_rejects_non_image_payload_with_image_extension(client):
    response = client.post(
        "/api/upload", files=upload_photo("fake.png", b"not really an image")
    )
    assert response.status_code == 400
    assert "image" in response.json()["detail"].lower()
    assert list(main.IMAGE_DIR.iterdir()) == []
    assert list(main.QR_DIR.iterdir()) == []


def test_upload_rejects_disallowed_extension(client):
    response = client.post("/api/upload", files=upload_files("evil.exe"))
    assert response.status_code == 400
    assert "MP4" in response.json()["detail"]


def test_upload_rejects_empty_file(client):
    response = client.post("/api/upload", files=upload_files("empty.mp4", b""))
    assert response.status_code == 400


def test_upload_rejects_oversized_file(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 16)
    response = client.post("/api/upload", files=upload_files())
    assert response.status_code == 413


def test_stats_and_media_listing(client):
    stats = client.get("/api/stats").json()
    assert stats["total_videos"] == 0
    assert stats["total_images"] == 0
    assert stats["total_media"] == 0
    assert stats["total_qr_codes"] == 0
    assert stats["storage_bytes"] == 0
    assert stats["public_base_url"] == main.PUBLIC_BASE_URL

    uploaded = client.post("/api/upload", files=upload_files()).json()
    photo = client.post("/api/upload", files=upload_photo()).json()

    stats = client.get("/api/stats").json()
    assert stats["total_videos"] == 1
    assert stats["total_images"] == 1
    assert stats["total_media"] == 2
    assert stats["total_qr_codes"] == 2
    assert stats["storage_bytes"] == uploaded["size_bytes"] + photo["size_bytes"]

    items = client.get("/api/media").json()["media"]
    assert len(items) == 2
    kinds = {item["id"]: item["kind"] for item in items}
    assert kinds[uploaded["id"]] == "video"
    assert kinds[photo["id"]] == "image"
    assert all(item["qr_url"].endswith(f"/qrcodes/{item['id']}.png") for item in items)


def test_legacy_videos_endpoint_still_works(client):
    client.post("/api/upload", files=upload_files())
    payload = client.get("/api/videos").json()
    assert "media" in payload
    assert len(payload["media"]) == 1


def test_delete_video_removes_everything(client):
    uploaded = client.post("/api/upload", files=upload_files()).json()
    video_id = uploaded["id"]

    response = client.delete(f"/api/videos/{video_id}")
    assert response.status_code == 200

    assert not (main.VIDEO_DIR / f"{video_id}.mp4").exists()
    assert not (main.QR_DIR / f"{video_id}.png").exists()
    assert client.get("/api/media").json()["media"] == []
    assert client.get("/api/stats").json()["total_media"] == 0


def test_delete_photo_removes_image_and_qr(client):
    uploaded = client.post("/api/upload", files=upload_photo()).json()
    photo_id = uploaded["id"]

    response = client.delete(f"/api/media/{photo_id}")
    assert response.status_code == 200

    assert not (main.IMAGE_DIR / f"{photo_id}.png").exists()
    assert not (main.QR_DIR / f"{photo_id}.png").exists()
    assert client.get("/api/media").json()["media"] == []


def test_delete_unknown_media_returns_404(client):
    assert client.delete("/api/videos/nope").status_code == 404


def test_sync_meta_backfills_existing_files(client):
    orphan = main.VIDEO_DIR / "deadbeef0000.webm"
    orphan.write_bytes(FAKE_MP4)
    orphan_photo = main.IMAGE_DIR / "cafebabe0000.jpg"
    orphan_photo.write_bytes(make_png_bytes())

    meta = main.sync_meta()

    assert "deadbeef0000" in meta
    entry = meta["deadbeef0000"]
    assert entry["filename"] == "deadbeef0000.webm"
    assert entry["kind"] == "video"
    assert entry["size_bytes"] == len(FAKE_MP4)
    assert entry["created_at"]

    assert "cafebabe0000" in meta
    assert meta["cafebabe0000"]["kind"] == "image"

    listed = client.get("/api/media").json()["media"]
    assert any(item["id"] == "deadbeef0000" for item in listed)
    assert any(item["id"] == "cafebabe0000" for item in listed)
    assert main.META_PATH.exists()


def test_qr_points_to_the_public_media_url(client):
    uploaded = client.post("/api/upload", files=upload_photo()).json()
    assert uploaded["media_url"] == f"{main.PUBLIC_BASE_URL}/images/{uploaded['id']}.png"
    assert uploaded["qr_url"] == f"{main.PUBLIC_BASE_URL}/qrcodes/{uploaded['id']}.png"
