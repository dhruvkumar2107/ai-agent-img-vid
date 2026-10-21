"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  API_BASE,
  deleteMedia,
  detectMediaKind,
  fetchMedia,
  fetchStats,
  formatBytes,
  uploadMedia,
  validateMediaFile,
  type Media,
  type MediaKind,
  type Stats,
  type UploadResult,
} from "@/lib/api";

function kindLabel(kind: MediaKind): string {
  return kind === "image" ? "Photo" : "Video";
}

function kindBadge(kind: MediaKind): string {
  return kind === "image"
    ? "bg-sky-500/15 text-sky-300 border-sky-500/40"
    : "bg-pink-500/15 text-pink-300 border-pink-500/40";
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const refreshData = useCallback(async () => {
    try {
      const [nextStats, nextMedia] = await Promise.all([
        fetchStats(),
        fetchMedia(),
      ]);
      setStats(nextStats);
      setMedia(nextMedia.media);
      setDataError(null);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Failed to load data");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStats(), fetchMedia()])
      .then(([nextStats, nextMedia]) => {
        if (cancelled) return;
        setStats(nextStats);
        setMedia(nextMedia.media);
        setDataError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDataError(
          error instanceof Error ? error.message : "Failed to load data",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectFile = (selected: File | null) => {
    setResult(null);
    setUploadError(null);
    if (!selected) {
      setFile(null);
      setFileError(null);
      return;
    }
    const error = validateMediaFile(selected);
    setFileError(error);
    setFile(error ? null : selected);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    selectFile(event.dataTransfer.files?.[0] ?? null);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    setUploadError(null);
    setUploading(true);
    setProgress(0);
    try {
      const uploaded = await uploadMedia(file, setProgress);
      setResult(uploaded);
      setFile(null);
      setFileError(null);
      if (inputRef.current) inputRef.current.value = "";
      await refreshData();
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Upload failed. Try again.",
      );
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setUploadError("Could not copy the link. Select it manually instead.");
    }
  };

  const handleDelete = async (item: Media) => {
    const confirmed = window.confirm(
      `Delete "${item.filename}" and its QR code? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await deleteMedia(item.id);
      await refreshData();
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const selectedKind = file ? detectMediaKind(file) : null;

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white md:p-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10">
          <p className="text-sm font-semibold tracking-[0.3em] text-pink-400">
            SINDOOR DIGITAL STUDIO
          </p>
          <h1 className="mt-3 text-4xl font-bold md:text-5xl">
            Photo &amp; Video QR Studio
          </h1>
          <p className="mt-3 text-slate-400">
            Upload a photo or a video. Get a shareable link and a printable QR
            code.
          </p>
        </header>

        {dataError && (
          <div className="mb-6 rounded-xl border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
            {dataError}
          </div>
        )}

        <section className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-slate-400">Total Media</p>
            <h2 className="mt-3 text-3xl font-bold">
              {stats ? stats.total_media : "—"}
            </h2>
            <p className="mt-2 text-xs text-slate-500">
              {stats ? `${stats.total_videos} videos · ${stats.total_images} photos` : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-slate-400">QR Codes Generated</p>
            <h2 className="mt-3 text-3xl font-bold">
              {stats ? stats.total_qr_codes : "—"}
            </h2>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-slate-400">Storage Used</p>
            <h2 className="mt-3 text-3xl font-bold">
              {stats ? formatBytes(stats.storage_bytes) : "—"}
            </h2>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6 md:p-8">
          <h2 className="text-2xl font-semibold">Upload Photo or Video</h2>
          <p className="mt-2 text-slate-400">
            MP4, MOV or WebM videos and JPG, PNG, WEBP or GIF photos up to 500 MB.
            A QR code is generated instantly.
          </p>

          {result ? (
            <div className="mt-6 rounded-xl border border-pink-900/60 bg-slate-950 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-semibold text-pink-400">{result.filename}</p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${kindBadge(result.kind)}`}
                >
                  {kindLabel(result.kind)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {result.message} Share the link or print the QR code.
              </p>

              <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-start">
                <div className="space-y-2 text-center">
                  <Image
                    src={result.qr_url}
                    alt={`QR code for ${result.filename}`}
                    width={176}
                    height={176}
                    priority
                    unoptimized
                    className="h-44 w-44 rounded-lg border border-slate-700 bg-white p-2"
                  />
                  <p className="text-xs text-slate-500">Scan to open</p>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {kindLabel(result.kind)} link
                  </p>
                  <p className="mt-1 break-all rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200">
                    {result.media_url}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-semibold hover:bg-pink-500"
                      onClick={() => handleCopy(result.media_url)}
                    >
                      {copied === result.media_url ? "Copied!" : "Copy link"}
                    </button>
                    <a
                      href={result.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-pink-400"
                    >
                      Open {kindLabel(result.kind).toLowerCase()}
                    </a>
                    <button
                      className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-pink-400"
                      onClick={() =>
                        handleDownload(result.qr_url, `qr-${result.id}.png`)
                      }
                    >
                      Download QR
                    </button>
                    <button
                      className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-400 hover:border-pink-400 hover:text-white"
                      onClick={() => setResult(null)}
                    >
                      Upload another
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!uploading) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`mt-6 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  dragging
                    ? "border-pink-400 bg-pink-500/5"
                    : "border-slate-700 hover:border-pink-400"
                }`}
              >
                <span className="text-4xl">☁️</span>
                <span className="mt-4 font-medium">
                  Choose a photo or video file
                </span>
                <span className="mt-2 text-sm text-slate-400">
                  Drag &amp; drop, or click to browse · MP4, MOV, WebM, JPG, PNG,
                  WEBP, GIF
                </span>
                <input
                  ref={inputRef}
                  id="media-upload-input"
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,image/gif"
                  className="mt-4 max-w-full text-sm"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>

              {fileError && (
                <p className="mt-4 text-sm text-red-400">{fileError}</p>
              )}

              {file && previewUrl && (
                <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
                  {selectedKind === "image" ? (
                    <Image
                      src={previewUrl}
                      alt="Selected preview"
                      width={96}
                      height={96}
                      unoptimized
                      className="h-24 w-24 rounded-lg border border-slate-700 object-cover"
                    />
                  ) : (
                    <video
                      src={previewUrl}
                      muted
                      playsInline
                      className="h-24 w-24 rounded-lg border border-slate-700 bg-black object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="break-all text-sm font-medium text-pink-300">
                      {file.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {kindLabel(selectedKind ?? "video")} ·{" "}
                      {formatBytes(file.size)}
                    </p>
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="mt-4 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
                  {uploadError}
                </div>
              )}

              {uploading && (
                <div className="mt-6">
                  <div className="flex items-center justify-between text-sm text-slate-400">
                    <span>Uploading…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-pink-500 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                disabled={!file || uploading || Boolean(fileError)}
                className="mt-6 rounded-xl bg-pink-600 px-6 py-3 font-semibold hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleUpload}
              >
                {uploading
                  ? `Uploading ${progress}%`
                  : "Upload & Generate QR"}
              </button>
            </>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6 md:p-8">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Recent Uploads</h2>
            <button
              className="text-sm text-slate-400 hover:text-pink-400"
              onClick={() => void refreshData()}
            >
              Refresh
            </button>
          </div>

          {media.length === 0 ? (
            <p className="mt-4 text-slate-500">
              Nothing uploaded yet. Upload your first photo or video above.
            </p>
          ) : (
            <ul className="mt-5 grid gap-4 md:grid-cols-2">
              {media.map((item) => (
                <li
                  key={item.id}
                  className="flex gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4"
                >
                  {item.kind === "image" ? (
                    <Image
                      src={item.media_url}
                      alt={item.filename}
                      width={80}
                      height={80}
                      unoptimized
                      className="h-20 w-20 shrink-0 rounded-md border border-slate-700 bg-white object-cover"
                    />
                  ) : (
                    <Image
                      src={item.qr_url}
                      alt={`QR code for ${item.filename}`}
                      width={80}
                      height={80}
                      unoptimized
                      className="h-20 w-20 shrink-0 rounded-md border border-slate-700 bg-white p-1"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{item.filename}</p>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindBadge(item.kind)}`}
                      >
                        {kindLabel(item.kind)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatBytes(item.size_bytes)}
                      {item.created_at
                        ? ` · ${new Date(item.created_at).toLocaleString()}`
                        : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={item.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold hover:bg-pink-500"
                      >
                        Open
                      </a>
                      <button
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold hover:border-pink-400"
                        onClick={() => handleCopy(item.media_url)}
                      >
                        {copied === item.media_url ? "Copied!" : "Copy link"}
                      </button>
                      <button
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold hover:border-pink-400"
                        onClick={() =>
                          handleDownload(item.qr_url, `qr-${item.id}.png`)
                        }
                      >
                        QR
                      </button>
                      <button
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:border-red-500 hover:text-red-400"
                        onClick={() => void handleDelete(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-10 space-y-1 text-center text-xs text-slate-600">
          <p>API: {API_BASE}</p>
          {stats && <p>QR links point to: {stats.public_base_url}</p>}
        </footer>
      </div>
    </main>
  );
}
