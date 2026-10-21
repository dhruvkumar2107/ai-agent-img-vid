export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export type MediaKind = "video" | "image";

export interface Stats {
  total_videos: number;
  total_images: number;
  total_media: number;
  total_qr_codes: number;
  storage_bytes: number;
  public_base_url: string;
}

export interface Media {
  id: string;
  filename: string;
  kind: MediaKind;
  media_url: string;
  video_url: string;
  qr_url: string;
  size_bytes: number;
  created_at: string | null;
}

export interface UploadResult extends Omit<Media, "size_bytes" | "created_at"> {
  message: string;
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  } catch {
    throw new Error(
      "Cannot reach the API server. Is the backend running on port 8000?",
    );
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<T>;
}

export function fetchStats(): Promise<Stats> {
  return getJson<Stats>("/api/stats");
}

export function fetchMedia(): Promise<{ media: Media[] }> {
  return getJson<{ media: Media[] }>("/api/media");
}

export async function deleteMedia(id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/media/${id}`, { method: "DELETE" });
  } catch {
    throw new Error("Cannot reach the API server.");
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export function uploadMedia(
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as UploadResult);
      } else {
        const detail = (body as { detail?: unknown } | null)?.detail;
        reject(
          new Error(
            typeof detail === "string" ? detail : "Upload failed. Try again.",
          ),
        );
      }
    };

    xhr.onerror = () =>
      reject(
        new Error(
          "Cannot reach the API server. Is the backend running on port 8000?",
        ),
      );

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // fall through
  }
  return `Request failed (${response.status})`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function detectMediaKind(file: File): MediaKind | null {
  const lower = file.name.toLowerCase();
  if (
    VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension)) ||
    VIDEO_TYPES.includes(file.type)
  ) {
    return "video";
  }
  if (
    IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension)) ||
    IMAGE_TYPES.includes(file.type)
  ) {
    return "image";
  }
  return null;
}

export function validateMediaFile(file: File): string | null {
  if (!detectMediaKind(file)) {
    return "Only MP4, MOV or WebM videos and JPG, PNG, WEBP or GIF photos are allowed.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "File is too large (max 500 MB).";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  return null;
}
