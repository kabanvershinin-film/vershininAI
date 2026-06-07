"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SiBytedance, SiGooglegemini, SiOpenai } from "react-icons/si";
import { generateImage, generateI2I, resumeProviderTask, uploadFile } from "../muapi.js";
import { loadProviderConfig } from "../providers/config.js";
import ModelParameterControls, {
  createInitialModelParams,
  sanitizeModelParams,
} from "./ModelParameterControls.jsx";
import {
  resolveI2IModelForUpload,
  resolveT2IModelForClear,
} from "./image-model-mode-utils.js";
import {
  studioVisibleT2IModels as t2iModels,
  studioVisibleI2IModels as i2iModels,
  getAspectRatiosForModel,
  getResolutionsForModel,
  getQualityFieldForModel,
  getAspectRatiosForI2IModel,
  getResolutionsForI2IModel,
  getQualityFieldForI2IModel,
  getMaxImagesForI2IModel,
  getEffectsForI2IModel,
  getDefaultEffectForI2IModel,
} from "../models.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const IMAGE_MODEL_PARAM_SKIP_KEYS = [
  "prompt",
  "aspect_ratio",
  "resolution",
  "quality",
  "image_url",
  "images_list",
  "name",
  "api_key",
];

async function downloadImage(url, filename) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
}

// ─── UploadButton (inline picker) ───────────────────────────────────────────

const IMAGE_HISTORY_DB_NAME = "hg_image_studio_assets";
const IMAGE_HISTORY_DB_VERSION = 1;
const IMAGE_HISTORY_STORE_NAME = "generated_images";
const IMAGE_HISTORY_DB_REF_PREFIX = "indexeddb://image-history/";
const IMAGE_GENERATION_STALE_MS = 12 * 60 * 60 * 1000;

function isInlineImageDataUrl(url) {
  return typeof url === "string" && /^data:image\//i.test(url);
}

function isActiveImageGenerationRunning(execution) {
  return execution?.status === "running" || execution?.status === "submitting";
}

function isImageGenerationExecutionExpired(execution) {
  const startedAt = Date.parse(execution?.startedAt || "");
  return !Number.isFinite(startedAt) || Date.now() - startedAt > IMAGE_GENERATION_STALE_MS;
}

function isRunnableImageGenerationExecution(execution) {
  const requestIds = Array.isArray(execution?.requestIds) ? execution.requestIds : [];
  return (
    isActiveImageGenerationRunning(execution) &&
    !isImageGenerationExecutionExpired(execution) &&
    Boolean(execution?.requestId || requestIds.length > 0)
  );
}

function createImageGenerationExecution({
  providerId,
  mode,
  modelId,
  modelName,
  prompt,
  aspectRatio,
  quality,
  requestCount,
  referenceCount,
}) {
  const now = new Date().toISOString();
  return {
    id: `image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    mediaType: "image",
    operation: mode === "i2i" ? "i2i" : "t2i",
    providerId: providerId || "memefast",
    status: "running",
    progress: 5,
    stage: "提交任务",
    prompt: prompt || "",
    modelId,
    modelName,
    aspectRatio,
    quality: quality || "",
    requestCount: requestCount || 1,
    completedCount: 0,
    requestId: null,
    requestIds: [],
    referenceCount: referenceCount || 0,
    startedAt: now,
    updatedAt: now,
  };
}

function serializeActiveGeneration(execution) {
  if (!execution) return null;
  return {
    ...execution,
    resultUrls: Array.isArray(execution.resultUrls)
      ? execution.resultUrls.filter((url) => url && !isInlineImageDataUrl(url)).slice(0, 20)
      : [],
  };
}

function imageHistoryDbAvailable() {
  return typeof window !== "undefined" && Boolean(window.indexedDB);
}

function safeImageHistoryKeyPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function createImageHistoryDbKey(entry) {
  const id = safeImageHistoryKeyPart(entry?.id) || Math.random().toString(36).slice(2, 10);
  const timestamp = Number.isFinite(Date.parse(entry?.timestamp))
    ? Date.parse(entry.timestamp)
    : Date.now();
  return `generated-${id}-${timestamp}`;
}

function toImageHistoryDbRef(key) {
  return `${IMAGE_HISTORY_DB_REF_PREFIX}${encodeURIComponent(key)}`;
}

function imageHistoryDbKeyFromRef(url) {
  if (typeof url !== "string" || !url.startsWith(IMAGE_HISTORY_DB_REF_PREFIX)) return "";
  try {
    return decodeURIComponent(url.slice(IMAGE_HISTORY_DB_REF_PREFIX.length));
  } catch {
    return "";
  }
}

function openImageHistoryDb() {
  if (!imageHistoryDbAvailable()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IMAGE_HISTORY_DB_NAME, IMAGE_HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_HISTORY_STORE_NAME)) {
        db.createObjectStore(IMAGE_HISTORY_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open image history store"));
  });
}

async function writeImageHistoryDataUrl(key, dataUrl) {
  const db = await openImageHistoryDb();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_HISTORY_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_HISTORY_STORE_NAME).put({
      key,
      dataUrl,
      updatedAt: new Date().toISOString(),
    });
    transaction.oncomplete = () => {
      db.close();
      resolve(true);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Failed to persist generated image"));
    };
  });
}

async function readImageHistoryDataUrl(key) {
  const db = await openImageHistoryDb();
  if (!db) return "";
  return new Promise((resolve, reject) => {
    let settled = false;
    const transaction = db.transaction(IMAGE_HISTORY_STORE_NAME, "readonly");
    const request = transaction.objectStore(IMAGE_HISTORY_STORE_NAME).get(key);
    request.onsuccess = () => {
      settled = true;
      resolve(request.result?.dataUrl || "");
    };
    request.onerror = () => {
      settled = true;
      reject(request.error || new Error("Failed to read generated image"));
    };
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      if (!settled) reject(transaction.error || new Error("Failed to read generated image"));
    };
  });
}

async function persistImageHistoryEntry(entry) {
  if (!entry?.url || !isInlineImageDataUrl(entry.url)) return entry;
  const indexedDbKey = entry.indexedDbKey || createImageHistoryDbKey(entry);
  try {
    const stored = await writeImageHistoryDataUrl(indexedDbKey, entry.url);
    return stored ? { ...entry, indexedDbKey } : entry;
  } catch (err) {
    console.warn("Failed to persist ImageStudio generated image data:", err);
    return entry;
  }
}

function serializeImageHistoryEntry(entry) {
  if (!entry) return null;
  if (entry.indexedDbKey && isInlineImageDataUrl(entry.url)) {
    return {
      ...entry,
      url: toImageHistoryDbRef(entry.indexedDbKey),
    };
  }
  if (isInlineImageDataUrl(entry.url)) {
    return {
      ...entry,
      url: "",
      skippedInlineStorage: true,
    };
  }
  return entry;
}

async function hydrateImageHistoryEntry(entry) {
  if (!entry) return null;
  const indexedDbKey = entry.indexedDbKey || imageHistoryDbKeyFromRef(entry.url);
  if (!indexedDbKey) return entry.url ? entry : null;
  try {
    const dataUrl = await readImageHistoryDataUrl(indexedDbKey);
    if (!dataUrl) return entry.url && !entry.url.startsWith(IMAGE_HISTORY_DB_REF_PREFIX) ? entry : null;
    return {
      ...entry,
      indexedDbKey,
      url: dataUrl,
    };
  } catch (err) {
    console.warn("Failed to hydrate ImageStudio generated image data:", err);
    return entry.url && !entry.url.startsWith(IMAGE_HISTORY_DB_REF_PREFIX) ? entry : null;
  }
}

async function hydratePersistedImageHistory(entries = []) {
  const hydrated = await Promise.all(entries.map((entry) => hydrateImageHistoryEntry(entry)));
  return hydrated.filter((entry) => entry?.url);
}

function UploadButton({ apiKey, modelId, maxImages, onSelect, onClear, initialUrls = [] }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedEntries, setSelectedEntries] = useState([]); // [{url, thumbnail}]
  const [uploadHistory, setUploadHistory] = useState([]); // [{id, name, url, thumbnail}]
  const [lastUploadProgress, setLastUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setPanelOpen(false);
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [panelOpen]);

  // Sync initialUrls from parent (e.g. restored from localStorage)
  useEffect(() => {
    if (initialUrls && initialUrls.length > 0) {
      // Avoid infinite loops by only updating if URLs actually changed
      const currentUrls = selectedEntries.map(e => e.url);
      const isSame = initialUrls.length === currentUrls.length && initialUrls.every(u => currentUrls.includes(u));
      if (isSame) return;

      const newEntries = initialUrls.map(url => ({ url }));
      setSelectedEntries(newEntries);
      
      // Also ensure they are in the history panel
      setUploadHistory(prev => {
        const existingUrls = prev.map(h => h.url);
        const missing = initialUrls
          .filter(u => !existingUrls.includes(u))
          .map(u => ({ id: `restored-${u}`, name: "Restored Image", url: u, progress: 100 }));
        return [...missing, ...prev];
      });
    }
  }, [initialUrls]); // eslint-disable-line react-hooks/exhaustive-deps

  // When maxImages changes, trim excess selections
  useEffect(() => {
    if (selectedEntries.length > maxImages) {
      const trimmed = selectedEntries.slice(0, maxImages);
      setSelectedEntries(trimmed);
      if (trimmed.length === 0) onClear?.();
    }
    if (fileInputRef.current) {
      fileInputRef.current.multiple = maxImages > 1;
    }
  }, [maxImages]); // eslint-disable-line react-hooks/exhaustive-deps

  const fireOnSelect = useCallback(
    (entries) => {
      if (!entries.length) return;
      const urls = entries.map((e) => e.url);
      onSelect({ url: urls[0], urls, thumbnail: entries[0].url });
    },
    [onSelect],
  );

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = "";

    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    const tooLarge = files.filter((f) => f.size > MAX_IMAGE_SIZE);
    if (tooLarge.length > 0) {
      alert(
        `The following images are too large (max 10MB): ${tooLarge.map((f) => f.name).join(", ")}`,
      );
      return;
    }

    setUploading(true);
    try {
      const toUpload =
        maxImages === 1
          ? files.slice(0, 1)
          : files.slice(0, maxImages - selectedEntries.length || 1);

      await Promise.all(
        toUpload.map(async (file) => {
          const id = Date.now().toString() + Math.random();

          // Add a placeholder to history immediately without local preview
          const placeholder = { id, name: file.name, url: null, progress: 0 };
          setUploadHistory((prev) => [placeholder, ...prev]);

          try {
            const uploadedUrl = await uploadFile(
              apiKey,
              file,
              (pct) => {
                setLastUploadProgress(pct);
                setUploadHistory((prev) =>
                  prev.map((h) => (h.id === id ? { ...h, progress: pct } : h)),
                );
              },
              { modelId },
            );

            // Update history with real URL and Mark as 100%
            setUploadHistory((prev) =>
              prev.map((h) => {
                if (h.id === id) {
                  return { ...h, url: uploadedUrl, progress: 100 };
                }
                return h;
              }),
            );

            // Auto-select if there's room
            if (selectedEntries.length < maxImages) {
              const newEntry = { url: uploadedUrl };
              setSelectedEntries((prev) => [...prev, newEntry]);

              if (maxImages === 1) {
                fireOnSelect([newEntry]);
                setPanelOpen(false);
              }
            }
          } catch (err) {
            console.error("[UploadButton] Upload failed for", file.name, err);
            setUploadHistory((prev) => prev.filter((h) => h.id !== id));
            throw err;
          }
        }),
      );
    } catch (err) {
      alert(`Image upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      setLastUploadProgress(0);
    }
  };

  const handleCellClick = (entry) => {
    const selIdx = selectedEntries.findIndex((e) => e.url === entry.url);
    const isSelected = selIdx !== -1;
    const atMax =
      maxImages > 1 && !isSelected && selectedEntries.length >= maxImages;
    if (atMax) return;

    if (maxImages === 1) {
      const newSelected = [{ url: entry.url, localUrl: entry.localUrl }];
      setSelectedEntries(newSelected);
      fireOnSelect(newSelected);
      setPanelOpen(false);
    } else {
      let next;
      if (isSelected) {
        next = selectedEntries.filter((_, i) => i !== selIdx);
        if (next.length === 0) onClear?.();
      } else {
        next = [
          ...selectedEntries,
          { url: entry.url, localUrl: entry.localUrl },
        ];
      }
      setSelectedEntries(next);
    }
  };

  const handleRemoveFromHistory = (e, entry) => {
    e.stopPropagation();
    if (entry.localUrl) URL.revokeObjectURL(entry.localUrl);
    setUploadHistory((prev) => prev.filter((h) => h.id !== entry.id));

    const next = selectedEntries.filter((s) => s.url !== entry.url);
    if (next.length !== selectedEntries.length) {
      setSelectedEntries(next);
      if (next.length === 0) onClear?.();
    }
  };

  const handleDone = (e) => {
    e.stopPropagation();
    fireOnSelect(selectedEntries);
    setPanelOpen(false);
  };

  const reset = () => {
    setSelectedEntries([]);
    setPanelOpen(false);
  };

  // expose reset via ref pattern — parent calls reset() directly
  // (handled by parent through uploadedImageUrls state reset)

  const isMulti = maxImages > 1;
  const count = selectedEntries.length;
  const hasSelection = count > 0;

  // Trigger icon content
  let triggerContent;
  if (hasSelection || uploading) {
    const mainEntry = selectedEntries[0] || uploadHistory[0];
    const canAddMore = isMulti && count < maxImages;
    let badge;
    if (uploading && !hasSelection) {
      badge = (
        <div className="flex flex-col items-center justify-center w-full h-full absolute inset-0 bg-black/80 z-20 backdrop-blur-[2px]">
          <svg className="w-8 h-8 -rotate-90">
            <circle
              cx="16"
              cy="16"
              r="14"
              stroke="currentColor"
              strokeWidth="2"
              fill="transparent"
              className="text-white/10"
            />
            <circle
              cx="16"
              cy="16"
              r="14"
              stroke="currentColor"
              strokeWidth="2"
              fill="transparent"
              strokeDasharray={88}
              strokeDashoffset={88 - (88 * lastUploadProgress) / 100}
              className="text-primary transition-all duration-300"
            />
          </svg>
          <span className="absolute text-[9px] font-black text-primary leading-none">
            {lastUploadProgress}%
          </span>
        </div>
      );
    } else if (count > 1) {
      badge = (
        <div className="absolute bottom-0.5 right-0.5 min-w-[16px] h-4 bg-primary rounded-full flex items-center justify-center px-0.5">
          <span className="text-[9px] font-black text-black leading-none">
            {count}
          </span>
        </div>
      );
    } else if (canAddMore) {
      badge = (
        <div className="absolute bottom-0.5 right-0.5 min-w-[16px] h-4 bg-white/80 rounded-full flex items-center justify-center px-0.5 border border-primary/60">
          <span className="text-[9px] font-black text-black leading-none">
            +
          </span>
        </div>
      );
    } else {
      badge = (
        <div className="absolute bottom-0.5 right-0.5 min-w-[16px] h-4 bg-primary rounded-full flex items-center justify-center px-0.5">
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="black"
            strokeWidth="4"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      );
    }
    triggerContent = (
      <>
        {uploading && hasSelection && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-30">
            <div className="w-4 h-4 rounded-full border border-primary/30 border-t-primary animate-spin mb-0.5" />
            <span className="text-[8px] font-black text-primary">
              {lastUploadProgress}%
            </span>
          </div>
        )}
        {count > 1 ? (
          <div className="relative w-full h-full p-1.5 flex items-center justify-center">
            {/* Bottom Image */}
            {selectedEntries[1]?.url && (
              <div className="absolute top-1 left-1 w-6 h-6 rounded-md border border-black/40 overflow-hidden shadow-lg rotate-[-8deg] translate-x-[-1px] translate-y-[-1px]">
                <img
                  src={selectedEntries[1].url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            {/* Top Image */}
            {selectedEntries[0]?.url && (
              <div className="absolute bottom-1 right-1 w-7 h-7 rounded-sm border-[1.5px] border-black/60 overflow-hidden shadow-2xl z-10 rotate-[4deg] translate-x-[1px] translate-y-[1px]">
                <img
                  src={selectedEntries[0].url}
                  alt=""
                  className={`w-full h-full object-cover transition-all duration-300 ${
                    uploading && hasSelection ? "blur-[2px] opacity-60" : "opacity-100"
                  }`}
                />
              </div>
            )}
          </div>
        ) : mainEntry?.url ? (
          <img
            src={mainEntry.url}
            alt=""
            className={`w-full h-full object-cover transition-all duration-300 ${
              uploading && hasSelection ? "blur-[2px] scale-110 opacity-60" : "blur-0 scale-100 opacity-100"
            }`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-white/5 animate-pulse">
            <div className="w-4 h-4 rounded-full border border-primary/20 border-t-primary animate-spin mb-0.5" />
            <span className="text-[8px] font-black text-primary">
              {lastUploadProgress}%
            </span>
          </div>
        )}
        {!uploading && badge}
      </>
    );
  } else {
    triggerContent = (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-white/40 group-hover:text-primary transition-colors"
      >
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="2"
          ry="2"
        />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    );
  }

  const triggerTitle = hasSelection
    ? count > 1
      ? `${count} of ${maxImages} images selected — click to manage`
      : isMulti
        ? `1 image selected — click to add more (up to ${maxImages})`
        : "Reference image"
    : isMulti
      ? `Add up to ${maxImages} images`
      : "Reference image";

  return (
    <div className="relative">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={isMulti}
        className="absolute w-px h-px opacity-0 pointer-events-none"
        tabIndex={-1}
        onChange={handleFileChange}
      />

      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        title={triggerTitle}
        onClick={(e) => {
          e.stopPropagation();
          setPanelOpen((o) => !o);
        }}
        className={`w-10 h-10 shrink-0 rounded-full border transition-all flex items-center justify-center relative overflow-hidden mt-1.5 bg-white/5 hover:bg-white/10 group ${
          hasSelection
            ? "border-primary/60 hover:border-primary/40"
            : "border-white/10 hover:border-primary/40"
        }`}
      >
        {triggerContent}
      </button>

      {/* Panel */}
      {panelOpen && (
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 bottom-[calc(100%+8px)] left-0 bg-[#111] rounded-xl p-3 shadow-4xl border border-white/10 w-96"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-1 pb-3 mb-2 border-b border-white/5">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-secondary">
                Reference Images
              </span>
              {isMulti && (
                <span className="text-[9px] text-muted">
                  Select up to {maxImages} images
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isMulti && hasSelection && (
                <button
                  type="button"
                  onClick={handleDone}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary text-black rounded-xl text-xs font-black transition-all hover:scale-105"
                >
                  ✓ Done ({count})
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                  window.setTimeout(() => setPanelOpen(false), 0);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-xs font-bold transition-all border border-primary/20"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {isMulti ? "Upload files" : "Upload new"}
              </button>
            </div>
          </div>

          {/* Grid or empty state */}
          {uploadHistory.length === 0 ? (
            <div className="py-6 flex flex-col items-center gap-2 opacity-40">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-secondary"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="text-xs text-secondary">No uploads yet</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto custom-scrollbar pr-0.5">
              {uploadHistory.map((entry) => {
                const selIdx = selectedEntries.findIndex(
                  (e) => e.url === entry.url,
                );
                const isSelected = selIdx !== -1;
                const atMax =
                  isMulti && !isSelected && selectedEntries.length >= maxImages;

                return (
                  <div
                    key={entry.id}
                    title={entry.name}
                    onClick={() => entry.url && handleCellClick(entry)}
                    className={`relative rounded-xl overflow-hidden border-2 cursor-pointer group/cell aspect-square transition-all ${
                      isSelected
                        ? "border-primary shadow-glow"
                        : "border-white/10 hover:border-white/30"
                    } ${atMax ? "opacity-40 cursor-not-allowed" : ""} ${!entry.url ? "cursor-wait" : ""}`}
                  >
                    {entry.url ? (
                      <img
                        src={entry.url}
                        alt={entry.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-white/5 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin mb-1" />
                        <span className="text-[10px] font-black text-primary">
                          {entry.progress}%
                        </span>
                      </div>
                    )}

                    {/* Hover overlay with delete */}
                    {entry.url && (
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/cell:opacity-100 transition-opacity flex items-end justify-end p-1">
                        <button
                          type="button"
                          title="Remove from history"
                          onClick={(e) => handleRemoveFromHistory(e, entry)}
                          className="w-5 h-5 bg-red-500/80 hover:bg-red-500 rounded-md flex items-center justify-center transition-colors"
                        >
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="3"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* Selection badge */}
                    {isSelected && (
                      <div className="absolute top-1 left-1 min-w-[20px] h-5 bg-primary rounded-full flex items-center justify-center px-1">
                        {isMulti ? (
                          <span className="text-[10px] font-black text-black">
                            {selIdx + 1}
                          </span>
                        ) : (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="black"
                            strokeWidth="4"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom bar for multi-select */}
          {isMulti && hasSelection && (
            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
              <span className="text-xs text-secondary">
                {count} of {maxImages} selected
              </span>
              <button
                type="button"
                onClick={handleDone}
                className="px-4 py-1.5 bg-primary text-black rounded-xl text-xs font-black transition-all hover:scale-105"
              >
                Use Selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ModelDropdown ────────────────────────────────────────────────────────────

const MODEL_BRANDS = [
  {
    key: "nano-banana",
    label: "Nano Banana",
    mark: "NB",
    Icon: SiGooglegemini,
    className: "bg-amber-500/15 text-amber-300 border-amber-400/20",
    match: (id) => id.includes("nano-banana"),
  },
  {
    key: "seedream",
    label: "Seedream",
    mark: "SD",
    Icon: SiBytedance,
    className: "bg-rose-500/15 text-rose-300 border-rose-400/20",
    match: (id) => id.includes("seedream") || id.includes("doubao"),
  },
  {
    key: "gpt-image",
    label: "GPT Image",
    mark: "GPT",
    Icon: SiOpenai,
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20",
    match: (id) => id.includes("gpt-image"),
  },
  {
    key: "flux",
    label: "Flux",
    mark: "FLX",
    className: "bg-sky-500/15 text-sky-300 border-sky-400/20",
    match: (id) => id.includes("flux"),
  },
  {
    key: "wan",
    label: "Wan",
    mark: "WAN",
    className: "bg-cyan-500/15 text-cyan-300 border-cyan-400/20",
    match: (id) => id.includes("wan"),
  },
  {
    key: "qwen",
    label: "Qwen",
    mark: "QW",
    className: "bg-violet-500/15 text-violet-300 border-violet-400/20",
    match: (id) => id.includes("qwen"),
  },
  {
    key: "midjourney",
    label: "Midjourney",
    mark: "MJ",
    className: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/20",
    match: (id) => id.includes("midjourney"),
  },
  {
    key: "kling",
    label: "Kling",
    mark: "KL",
    className: "bg-lime-500/15 text-lime-300 border-lime-400/20",
    match: (id) => id.includes("kling"),
  },
  {
    key: "grok",
    label: "Grok",
    mark: "GX",
    className: "bg-neutral-400/15 text-neutral-200 border-neutral-300/20",
    match: (id) => id.includes("grok"),
  },
  {
    key: "minimax",
    label: "Minimax",
    mark: "MM",
    className: "bg-orange-500/15 text-orange-300 border-orange-400/20",
    match: (id) => id.includes("minimax"),
  },
];

const OTHER_MODEL_BRAND = {
  key: "other",
  label: "Other",
  mark: "AI",
  className: "bg-primary/10 text-primary border-white/5",
};

function getModelBrand(model) {
  const id = (model?.id || "").toLowerCase();
  return MODEL_BRANDS.find((brand) => brand.match(id)) || OTHER_MODEL_BRAND;
}

function groupModelsByBrand(models) {
  const groups = [];
  const groupByKey = new Map();

  models.forEach((model) => {
    const brand = getModelBrand(model);
    if (!groupByKey.has(brand.key)) {
      const group = { brand, models: [] };
      groupByKey.set(brand.key, group);
      groups.push(group);
    }
    groupByKey.get(brand.key).models.push(model);
  });

  return groups;
}

function ModelBrandLogo({ brand, size = "large" }) {
  const Icon = brand.Icon;
  const sizeClass = size === "large" ? "w-10 h-10" : "w-5 h-5";
  const iconClass = size === "large" ? "w-4.5 h-4.5" : "w-3 h-3";

  return (
    <div
      className={`${sizeClass} ${brand.className} border rounded-full flex items-center justify-center shadow-inner`}
      title={`${brand.label} logo`}
      aria-label={`${brand.label} logo`}
    >
      {Icon ? (
        <Icon className={iconClass} aria-hidden="true" />
      ) : (
        <span className="text-[8px] font-bold uppercase leading-none">
          {brand.mark}
        </span>
      )}
    </div>
  );
}

function ModelDropdown({ models, selectedModel, onSelect, onClose }) {
  const [search, setSearch] = useState("");

  const filtered = models.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2 h-full max-h-[60vh]">
      <div className="border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-2.5 border border-white/5 focus-within:border-primary/50 transition-colors">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search models..."
            value={search}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none text-xs text-white focus:ring-0 w-full p-0 focus:outline-none"
          />
        </div>
      </div>
      <div className="text-xs font-medium text-secondary py-2 shrink-0">
        Available models
      </div>
      <div className="flex flex-col gap-1.5 overflow-y-auto custom-scrollbar pr-1 pb-2">
        {groupModelsByBrand(filtered).map(({ brand, models: brandModels }) => (
          <div key={brand.key} className="flex flex-col gap-1.5">
            <div className="px-1.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
              {brand.label}
            </div>
            {brandModels.map((m) => (
              <div
                key={m.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(m);
                  onClose();
                }}
                className={`flex items-center justify-between p-3.5 hover:bg-white/5 rounded-lg cursor-pointer transition-all border border-transparent hover:border-white/5 ${
                  selectedModel === m.id ? "bg-white/5 border-white/5" : ""
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <ModelBrandLogo brand={brand} />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white tracking-tight">
                      {m.name}
                    </span>
                  </div>
                </div>
                {selectedModel === m.id && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="4"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SimpleDropdown ───────────────────────────────────────────────────────────

function SimpleDropdown({ title, options, selected, onSelect, onClose }) {
  return (
    <>
      <div className="text-xs font-medium text-muted pb-2 border-b border-white/5 mb-2">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {options.map((opt) => (
          <div
            key={opt}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(opt);
              onClose();
            }}
            className="flex items-center justify-between p-2 hover:bg-white/5 rounded-md cursor-pointer transition-all group"
          >
            <span className="text-xs font-bold text-white opacity-80 group-hover:opacity-100">
              {opt}
            </span>
            {selected === opt && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="4"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function ImageGenerationExecutionPanel({ execution, onResume, onDismiss }) {
  if (!execution) return null;

  const isRunning = isActiveImageGenerationRunning(execution);
  const progress = Math.max(0, Math.min(100, Number(execution.progress || 0)));
  const requestIds = Array.isArray(execution.requestIds)
    ? execution.requestIds.filter(Boolean)
    : [];
  const taskLabel = execution.requestId || requestIds[0] || "等待任务号";
  const title =
    execution.status === "failed"
      ? "任务失败"
      : execution.status === "completed"
        ? "任务完成"
        : "任务执行";
  const statusText =
    execution.status === "failed"
      ? (execution.error || "生成失败")
      : execution.status === "completed"
        ? "生成完成"
        : `${execution.stage || "生成中"}...`;

  return (
    <div className="absolute left-4 right-4 top-4 md:left-auto md:right-6 md:top-6 md:w-[360px] z-50">
      <div className="rounded-lg border border-white/10 bg-[#080808]/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isRunning && (
                <span className="h-2 w-2 rounded-full bg-[#22d3ee] animate-pulse" />
              )}
              <div className="text-xs font-bold text-white">{title}</div>
            </div>
            <div className="text-[11px] text-white/45 mt-1 truncate">
              {execution.modelName || execution.modelId || "Image model"}
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="h-7 w-7 rounded-md border border-white/10 bg-white/[0.03] text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
            title="清除执行记录"
          >
            x
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-white/45">状态</span>
            <span className={execution.status === "failed" ? "text-red-300" : "text-white/75"}>
              {statusText}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full bg-[#22d3ee] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-white/45">
            <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2 py-1.5">
              <div>比例</div>
              <div className="text-white/70 mt-0.5">{execution.aspectRatio || "-"}</div>
            </div>
            <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2 py-1.5">
              <div>数量</div>
              <div className="text-white/70 mt-0.5">
                {execution.completedCount || 0}/{execution.requestCount || 1}
              </div>
            </div>
          </div>
          <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2 py-1.5">
            <div className="text-[11px] text-white/45">Task ID</div>
            <div className="text-[11px] text-white/70 font-mono truncate mt-0.5" title={taskLabel}>
              {taskLabel}
            </div>
          </div>
          {execution.prompt && (
            <div className="text-[11px] leading-relaxed text-white/45 line-clamp-2" title={execution.prompt}>
              {execution.prompt}
            </div>
          )}
          {isRunnableImageGenerationExecution(execution) && (
            <button
              type="button"
              onClick={onResume}
              className="w-full h-9 rounded-md bg-white/10 hover:bg-white/15 text-white/80 text-xs font-semibold transition-colors"
            >
              继续等待结果
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ImageStudio({
  apiKey,
  onGenerationComplete,
  historyItems,
  droppedFiles,
  onFilesHandled,
}) {
  const PERSIST_KEY = "hg_image_studio_persistent";

  // ── Model / mode state ──────────────────────────────────────────────────
  const [imageMode, setImageMode] = useState(false); // false=t2i, true=i2i
  const [selectedModelId, setSelectedModelId] = useState(t2iModels[0].id);
  const [selectedModelName, setSelectedModelName] = useState(t2iModels[0].name);
  const [selectedAr, setSelectedAr] = useState(
    t2iModels[0].inputs?.aspect_ratio?.default || "1:1",
  );
  const [selectedQuality, setSelectedQuality] = useState(() => {
    const resolutions = getResolutionsForModel(t2iModels[0].id);
    return resolutions[0] || null;
  });
  const [selectedEffect, setSelectedEffect] = useState("");
  const [maxImages, setMaxImages] = useState(1);

  // ── Prompt / upload state ───────────────────────────────────────────────
  const [prompt, setPrompt] = useState("");
  const [uploadedImageUrls, setUploadedImageUrls] = useState([]);

  // ── UI state ────────────────────────────────────────────────────────────
  const [dropdownOpen, setDropdownOpen] = useState(null); // 'model' | 'ar' | 'quality' | null
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const [activeGeneration, setActiveGeneration] = useState(null);

  // ── Canvas / history state ──────────────────────────────────────────────
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [activeHistoryIdx, setActiveHistoryIdx] = useState(0);
  const [batchSize, setBatchSize] = useState(1);
  const [localHistory, setLocalHistory] = useState([]); // [{id,url,prompt,model,aspect_ratio,timestamp}]
  const [modelParams, setModelParams] = useState(() =>
    createInitialModelParams(t2iModels[0], {}, IMAGE_MODEL_PARAM_SKIP_KEYS),
  );

  // Use prop history if provided, otherwise local
  const history = historyItems ?? localHistory;

  // ── Refs ────────────────────────────────────────────────────────────────
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);
  const localHistoryRef = useRef([]);
  const currentImageRef = useRef(null);
  const activeGenerationRef = useRef(null);
  const uploadPickerResetRef = useRef(null); // not used directly — managed via key

  const setActiveGenerationStatus = useCallback((updatesOrUpdater) => {
    setActiveGeneration((prev) => {
      const updates = typeof updatesOrUpdater === "function"
        ? updatesOrUpdater(prev)
        : updatesOrUpdater;
      const next = updates
        ? {
            ...(prev || {}),
            ...updates,
            updatedAt: new Date().toISOString(),
          }
        : null;
      activeGenerationRef.current = next;
      try {
        const stored = JSON.parse(localStorage.getItem(PERSIST_KEY) || "{}");
        localStorage.setItem(
          PERSIST_KEY,
          JSON.stringify({
            ...stored,
            activeGeneration: serializeActiveGeneration(next),
          }),
        );
      } catch (err) {
        console.warn("Failed to immediately save ImageStudio active generation:", err);
      }
      return next;
    });
  }, []);

  // ── Close dropdown on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(null);
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [dropdownOpen]);

  // ── Persistence: Load ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    try {
      const stored = localStorage.getItem(PERSIST_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.imageMode !== undefined) setImageMode(data.imageMode);
        if (data.selectedModelId) setSelectedModelId(data.selectedModelId);
        if (data.selectedModelName) setSelectedModelName(data.selectedModelName);
        if (data.selectedAr) setSelectedAr(data.selectedAr);
        if (data.selectedQuality) setSelectedQuality(data.selectedQuality);
        if (data.selectedEffect) setSelectedEffect(data.selectedEffect);
        if (data.maxImages) setMaxImages(data.maxImages);
        if (data.prompt) setPrompt(data.prompt);
        if (data.uploadedImageUrls) setUploadedImageUrls(data.uploadedImageUrls);
        if (data.batchSize) setBatchSize(data.batchSize);
        if (data.localHistory) {
          localHistoryRef.current = data.localHistory;
          hydratePersistedImageHistory(data.localHistory).then((hydratedHistory) => {
            if (cancelled) return;
            localHistoryRef.current = hydratedHistory;
            setLocalHistory(hydratedHistory);
          });
        }
        if (data.currentImage) {
          currentImageRef.current = data.currentImage;
          hydrateImageHistoryEntry(data.currentImage).then((hydratedCurrentImage) => {
            if (cancelled || !hydratedCurrentImage?.url) return;
            currentImageRef.current = hydratedCurrentImage;
            setCurrentImageUrl(hydratedCurrentImage.url);
          });
        }
        if (data.activeGeneration && typeof data.activeGeneration === "object") {
          const restoredGeneration = isImageGenerationExecutionExpired(data.activeGeneration)
            ? {
                ...data.activeGeneration,
                status: "failed",
                progress: 0,
                stage: "已过期",
                error: "任务记录已超过可恢复时间",
              }
            : data.activeGeneration;
          activeGenerationRef.current = restoredGeneration;
          setActiveGeneration(restoredGeneration);
          setGenerating(isActiveImageGenerationRunning(restoredGeneration));
        }
        if (data.modelParams && typeof data.modelParams === "object") {
          setModelParams(data.modelParams);
        }
      }
    } catch (err) {
      console.warn("Failed to load ImageStudio persistence:", err);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Adjust height on load ────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      handleTextareaInput();
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  // ── Persistence: Save ────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const state = {
          imageMode,
          selectedModelId,
          selectedModelName,
          selectedAr,
          selectedQuality,
          selectedEffect,
          maxImages,
          prompt,
          uploadedImageUrls,
          batchSize,
          localHistory: localHistoryRef.current.map(serializeImageHistoryEntry),
          currentImage: serializeImageHistoryEntry(currentImageRef.current),
          activeGeneration: serializeActiveGeneration(activeGenerationRef.current),
          modelParams,
        };
        localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("Failed to save ImageStudio persistence:", err);
      }
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [
    imageMode,
    selectedModelId,
    selectedModelName,
    selectedAr,
    selectedQuality,
    selectedEffect,
    maxImages,
    prompt,
    uploadedImageUrls,
    batchSize,
    localHistory,
    currentImageUrl,
    activeGeneration,
    modelParams,
  ]);

  const processDroppedImages = async (files) => {
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    const tooLarge = files.filter((f) => f.size > MAX_IMAGE_SIZE);
    if (tooLarge.length > 0) {
      alert(
        `The following images are too large (max 10MB): ${tooLarge.map((f) => f.name).join(", ")}`
      );
      return;
    }

    setGenerating(true); // Show as generating/busy
    try {
      const toUpload =
        uploadMaxImages === 1 ? files.slice(0, 1) : files.slice(0, uploadMaxImages);
      const urls = await Promise.all(
        toUpload.map(async (file) => {
          try {
            return await uploadFile(apiKey, file, undefined, { modelId: selectedModelId });
          } catch (err) {
            console.error(
              "[ImageStudio] Drop upload failed for",
              file.name,
              err
            );
            throw err;
          }
        })
      );

      handleUploadSelect({ urls });
    } catch (err) {
      alert(`Image upload failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // ── Handle Dropped Files ────────────────────────────────────────────────
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      const imageFiles = droppedFiles.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        processDroppedImages(imageFiles);
      }
      onFilesHandled?.();
    }
  }, [droppedFiles, onFilesHandled, processDroppedImages]);

  // ── Derived: current model lists & helpers ───────────────────────────────
  const currentModels = imageMode ? i2iModels : t2iModels;
  const currentModelObj = currentModels.find((m) => m.id === selectedModelId);
  const selectedModelBrand = getModelBrand({ id: selectedModelId });
  const currentAspectRatios = imageMode
    ? getAspectRatiosForI2IModel(selectedModelId)
    : getAspectRatiosForModel(selectedModelId);
  const currentResolutions = imageMode
    ? getResolutionsForI2IModel(selectedModelId)
    : getResolutionsForModel(selectedModelId);
  const currentQualityField = imageMode
    ? getQualityFieldForI2IModel(selectedModelId)
    : getQualityFieldForModel(selectedModelId);
  const showQualityBtn = currentResolutions.length > 0;
  const currentEffects = imageMode ? getEffectsForI2IModel(selectedModelId) : [];
  const showEffectBtn = currentEffects.length > 0;
  const pairedUploadModel = imageMode
    ? null
    : resolveI2IModelForUpload(selectedModelId, i2iModels);
  const uploadMaxImages = imageMode
    ? maxImages
    : pairedUploadModel
      ? getMaxImagesForI2IModel(pairedUploadModel.id)
      : maxImages;

  useEffect(() => {
    if (currentModelObj || currentModels.length === 0) return;
    const first = currentModels[0];
    const ars = imageMode
      ? getAspectRatiosForI2IModel(first.id)
      : getAspectRatiosForModel(first.id);
    const resolutions = imageMode
      ? getResolutionsForI2IModel(first.id)
      : getResolutionsForModel(first.id);
    const effects = imageMode ? getEffectsForI2IModel(first.id) : [];
    setSelectedModelId(first.id);
    setSelectedModelName(first.name);
    setSelectedAr(ars[0] || "1:1");
    setSelectedQuality(resolutions[0] || null);
    setSelectedEffect(
      effects.length > 0
        ? getDefaultEffectForI2IModel(first.id) || effects[0]
        : "",
    );
    setMaxImages(imageMode ? getMaxImagesForI2IModel(first.id) : 1);
    setModelParams((prev) =>
      createInitialModelParams(first, prev, IMAGE_MODEL_PARAM_SKIP_KEYS),
    );
  }, [currentModelObj, currentModels, imageMode]);

  useEffect(() => {
    setModelParams((prev) =>
      createInitialModelParams(currentModelObj, prev, IMAGE_MODEL_PARAM_SKIP_KEYS),
    );
  }, [currentModelObj?.id]);

  // ── Textarea auto-resize ─────────────────────────────────────────────────
  const handleTextareaInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = window.innerWidth < 768 ? 150 : 250;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  };

  // ── Upload picker callbacks ──────────────────────────────────────────────
  const handleUploadSelect = useCallback(
    ({ url, urls }) => {
      const newUrls = urls || [url];
      setUploadedImageUrls(newUrls);

      const currentT2I = t2iModels.find((m) => m.id === selectedModelId);
      if (!imageMode && currentT2I?.inputs?.image_url) {
        return;
      }

      if (!imageMode) {
        const nextI2I = resolveI2IModelForUpload(selectedModelId, i2iModels);
        if (!nextI2I) return;
        const ars = getAspectRatiosForI2IModel(nextI2I.id);
        const resolutions = getResolutionsForI2IModel(nextI2I.id);
        const effects = getEffectsForI2IModel(nextI2I.id);
        setImageMode(true);
        setSelectedModelId(nextI2I.id);
        setSelectedModelName(nextI2I.name);
        setSelectedAr(ars[0] || "1:1");
        setSelectedQuality(resolutions[0] || null);
        setSelectedEffect(effects.length > 0 ? (getDefaultEffectForI2IModel(nextI2I.id) || effects[0]) : "");
        setMaxImages(getMaxImagesForI2IModel(nextI2I.id));
        setModelParams((prev) =>
          createInitialModelParams(nextI2I, prev, IMAGE_MODEL_PARAM_SKIP_KEYS),
        );
      }
    },
    [imageMode, selectedModelId],
  );

  const handleUploadClear = useCallback(() => {
    setUploadedImageUrls([]);
    if (!imageMode) return;
    setImageMode(false);
    const nextT2I = resolveT2IModelForClear(selectedModelId, t2iModels);
    if (!nextT2I) return;
    const ars = getAspectRatiosForModel(nextT2I.id);
    const resolutions = getResolutionsForModel(nextT2I.id);
    setSelectedModelId(nextT2I.id);
    setSelectedModelName(nextT2I.name);
    setSelectedAr(ars[0] || "1:1");
    setSelectedQuality(resolutions[0] || null);
    setSelectedEffect("");
    setMaxImages(1);
    setModelParams((prev) =>
      createInitialModelParams(nextT2I, prev, IMAGE_MODEL_PARAM_SKIP_KEYS),
    );
  }, [imageMode, selectedModelId]);

  // ── Model selection ──────────────────────────────────────────────────────
  const handleModelSelect = (m) => {
    const ars = imageMode
      ? getAspectRatiosForI2IModel(m.id)
      : getAspectRatiosForModel(m.id);
    const resolutions = imageMode
      ? getResolutionsForI2IModel(m.id)
      : getResolutionsForModel(m.id);
    setSelectedModelId(m.id);
    setSelectedModelName(m.name);
    setSelectedAr(ars[0] || "1:1");
    setSelectedQuality(resolutions[0] || null);
    setModelParams((prev) =>
      createInitialModelParams(m, prev, IMAGE_MODEL_PARAM_SKIP_KEYS),
    );
    if (imageMode) {
      setMaxImages(getMaxImagesForI2IModel(m.id));
      const effects = getEffectsForI2IModel(m.id);
      setSelectedEffect(effects.length > 0 ? (getDefaultEffectForI2IModel(m.id) || effects[0]) : "");
    } else {
      setSelectedEffect("");
    }
  };

  // ── History helpers ──────────────────────────────────────────────────────
  const addToHistory = useCallback(
    async (entry) => {
      const persistedEntry = await persistImageHistoryEntry(entry);
      if (!historyItems) {
        const nextHistory = [persistedEntry, ...localHistoryRef.current.slice(0, 49)];
        localHistoryRef.current = nextHistory;
        setLocalHistory(nextHistory);
        try {
          const stored = JSON.parse(localStorage.getItem(PERSIST_KEY) || "{}");
          localStorage.setItem(
            PERSIST_KEY,
            JSON.stringify({
              ...stored,
              localHistory: nextHistory.map(serializeImageHistoryEntry),
              currentImage: serializeImageHistoryEntry(persistedEntry),
            }),
          );
        } catch (err) {
          console.warn("Failed to immediately save ImageStudio history:", err);
        }
      }
      setActiveHistoryIdx(0);
      currentImageRef.current = persistedEntry;
      setCurrentImageUrl(persistedEntry.url);
    },
    [historyItems],
  );

  const commitImageGenerationResult = useCallback(
    async (res, executionSnapshot = activeGenerationRef.current) => {
      if (!res?.url) return false;
      const entry = {
        id: res.id || res.taskId || res.request_id || Math.random().toString(36).substring(7),
        url: res.url,
        prompt: executionSnapshot?.prompt || prompt.trim(),
        model: executionSnapshot?.modelId || selectedModelId,
        aspect_ratio: executionSnapshot?.aspectRatio || selectedAr,
        timestamp: new Date().toISOString(),
      };
      await addToHistory(entry);
      onGenerationComplete?.({
        url: res.url,
        model: entry.model,
        prompt: entry.prompt,
        type: "image",
      });
      return true;
    },
    [addToHistory, onGenerationComplete, prompt, selectedAr, selectedModelId],
  );

  const resumeImageGenerationTask = useCallback(async () => {
    const execution = activeGenerationRef.current;
    if (!isRunnableImageGenerationExecution(execution)) return;
    setGenerating(true);
    setGenerateError(null);
    setActiveGenerationStatus({
      status: "running",
      progress: Math.max(35, Number(execution.progress || 0)),
      stage: "继续等待结果",
    });
    try {
      const requestIds = Array.isArray(execution.requestIds) && execution.requestIds.length > 0
        ? execution.requestIds
        : [execution.requestId].filter(Boolean);
      let completedCount = execution.completedCount || 0;
      for (const requestId of requestIds) {
        const res = await resumeProviderTask(apiKey, {
          taskId: requestId,
          requestId,
          providerId: execution.providerId,
          mediaType: "image",
          modelId: execution.modelId,
        });
        const committed = await commitImageGenerationResult(res, execution);
        if (committed) {
          completedCount += 1;
          setActiveGenerationStatus({
            completedCount,
            progress: Math.min(95, Math.round((completedCount / Math.max(1, requestIds.length)) * 90) + 5),
            stage: "保存结果",
          });
        }
      }
      setActiveGenerationStatus({
        status: "completed",
        progress: 100,
        stage: "生成完成",
        completedCount: Math.max(completedCount, requestIds.length),
      });
    } catch (e) {
      console.error("[ImageStudio] Resume generation failed:", e);
      setGenerateError(e.message.slice(0, 80));
      setActiveGenerationStatus({
        status: "failed",
        progress: 0,
        stage: "任务失败",
        error: e.message,
      });
      setTimeout(() => setGenerateError(null), 4000);
    } finally {
      setGenerating(false);
    }
  }, [apiKey, commitImageGenerationResult, setActiveGenerationStatus]);

  // ── View state ─────────────────────────────────────

  const resetToPrompt = () => {
    setCurrentImageUrl(null);
    setPrompt("");
    setUploadedImageUrls([]);
    setImageMode(false);
    const defaultT2I = t2iModels[0];
    const ars = getAspectRatiosForModel(defaultT2I.id);
    const resolutions = getResolutionsForModel(defaultT2I.id);
    setSelectedModelId(defaultT2I.id);
    setSelectedModelName(defaultT2I.name);
    setSelectedAr(ars[0] || "1:1");
    setSelectedQuality(resolutions[0] || null);
    setSelectedEffect("");
    setMaxImages(1);
    setModelParams((prev) =>
      createInitialModelParams(defaultT2I, prev, IMAGE_MODEL_PARAM_SKIP_KEYS),
    );
  };

  // ── Generation ───────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (generating) return;

    if (imageMode) {
      if (uploadedImageUrls.length === 0) {
        alert("Please upload a reference image first.");
        return;
      }
    } else {
      if (!prompt.trim()) {
        alert("Please enter a prompt to generate an image.");
        return;
      }
    }

    try {
      const sanitizedModelParams = sanitizeModelParams(
        modelParams,
        currentModelObj,
        IMAGE_MODEL_PARAM_SKIP_KEYS,
      );
      const requestCount = currentModelObj?.inputs?.num_images ? 1 : batchSize;
      const providerId = loadProviderConfig().selectedProviderId || "memefast";
      const execution = createImageGenerationExecution({
        providerId,
        mode: imageMode ? "i2i" : "t2i",
        modelId: selectedModelId,
        modelName: selectedModelName,
        prompt: prompt.trim(),
        aspectRatio: selectedAr,
        quality: selectedQuality,
        requestCount,
        referenceCount: uploadedImageUrls.length,
      });
      activeGenerationRef.current = execution;
      setActiveGenerationStatus({ ...execution, status: "running", progress: 5, stage: "提交任务" });
      setGenerating(true);
      setGenerateError(null);

      const results = await Promise.all(
        Array.from({ length: requestCount }).map(async (_, index) => {
          const onRequestId = (requestId) => {
            setActiveGenerationStatus((prev) => {
              const requestIds = Array.from(new Set([...(prev?.requestIds || []), requestId].filter(Boolean)));
              return {
                status: "running",
                progress: Math.max(Number(prev?.progress || 5), 25),
                stage: "生成中",
                requestId: prev?.requestId || requestId,
                requestIds,
              };
            });
          };
          if (imageMode) {
            const genParams = {
              ...sanitizedModelParams,
              model: selectedModelId,
              images_list: uploadedImageUrls,
              image_url: uploadedImageUrls[0],
              aspect_ratio: selectedAr,
              onRequestId,
            };
            if (prompt.trim()) genParams.prompt = prompt.trim();
            if (currentQualityField && selectedQuality) {
              genParams[currentQualityField] = selectedQuality;
            }
            if (showEffectBtn && selectedEffect) genParams.name = selectedEffect;
            return await generateI2I(apiKey, genParams);
          } else {
            const genParams = {
              ...sanitizedModelParams,
              model: selectedModelId,
              prompt: prompt.trim(),
              aspect_ratio: selectedAr,
              onRequestId,
            };
            if (currentModelObj?.inputs?.image_url && uploadedImageUrls[0]) {
              genParams.image_url = uploadedImageUrls[0];
            }
            if (currentQualityField && selectedQuality) {
              genParams[currentQualityField] = selectedQuality;
            }
            return await generateImage(apiKey, genParams);
          }
        })
      );

      let completedCount = 0;
      for (const res of results) {
        const committed = await commitImageGenerationResult(res, execution);
        if (committed) {
          completedCount += 1;
          setActiveGenerationStatus({
            completedCount,
            progress: Math.min(95, Math.round((completedCount / Math.max(1, requestCount)) * 90) + 5),
            stage: "保存结果",
          });
        }
      }
      setActiveGenerationStatus({
        status: "completed",
        progress: 100,
        stage: "生成完成",
        completedCount,
      });
    } catch (e) {
      console.error("[ImageStudio] Generation failed:", e);
      setGenerateError(e.message.slice(0, 80));
      setActiveGenerationStatus({
        status: "failed",
        progress: 0,
        stage: "任务失败",
        error: e.message,
      });
      setTimeout(() => setGenerateError(null), 4000);
    } finally {
      setGenerating(false);
    }
  };

  const placeholderText =
    uploadedImageUrls.length > 1
      ? `${uploadedImageUrls.length} images selected — describe the transformation (optional)`
      : imageMode
        ? "Describe how to transform this image (optional)"
        : "Describe the image you want to create";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative p-4 md:p-6 overflow-hidden">
      <ImageGenerationExecutionPanel
        execution={activeGeneration}
        onResume={resumeImageGenerationTask}
        onDismiss={() => {
          setActiveGenerationStatus(null);
          setGenerating(false);
        }}
      />
      
      {/* ── CENTRAL GALLERY AREA ── */}
      <div className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto custom-scrollbar pb-40 lg:pb-32 px-2">
        {history.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 w-full pt-4 animate-fade-in-up">
            {history.map((entry, idx) => (
              <div
                key={entry.id || idx}
                className="relative group rounded-lg overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-xl hover:border-primary/50 transition-all duration-300 flex flex-col"
              >
                <img
                  src={entry.url}
                  alt={entry.prompt?.substring(0, 30) || "Generated image"}
                  className="w-full aspect-square object-cover bg-black/40 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setFullscreenUrl(entry.url)}
                />
                
                {/* Overlay actions */}
                <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    title="Fullscreen"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullscreenUrl(entry.url);
                    }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title="Download"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadImage(entry.url, `muapi-${entry.id || idx}.jpg`);
                    }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                  </button>
                </div>

                {/* Prompt & Details */}
                <div className="p-3 bg-black/80 backdrop-blur-sm border-t border-white/5 flex-1 flex flex-col justify-between gap-2">
                  <p className="text-white/70 text-xs line-clamp-3 leading-relaxed" title={entry.prompt}>
                    {entry.prompt || "No prompt provided"}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded border border-primary/20">
                      {entry.model?.replace("-", " ")}
                    </span>
                    <span className="text-[10px] text-white/40">{entry.aspect_ratio}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full animate-fade-in-up transition-all duration-700 min-h-[50vh]">
            <div className="mb-12 relative group">
              <div className="absolute inset-0 bg-primary/10 blur-[120px] rounded-full opacity-30 group-hover:opacity-60 transition-opacity duration-1000" />
              <div className="relative w-24 h-24 md:w-32 md:h-32 bg-white/[0.02] rounded-[2rem] flex items-center justify-center border border-white/[0.05] overflow-hidden backdrop-blur-sm">
                <div className="w-16 h-16 bg-primary/5 rounded-2xl flex items-center justify-center border border-primary/10 relative z-10 transition-transform duration-500 group-hover:scale-110">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-primary opacity-80"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div className="absolute top-4 right-4 text-[10px] text-primary/40 animate-pulse">
                  ✨
                </div>
              </div>
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight mb-4 text-center px-4">
              <span className="text-white/40 font-medium">START CREATING WITH</span>
              <br />
              <span className="text-white">IMAGE STUDIO</span>
            </h1>
            <p className="text-white/40 text-sm md:text-base font-medium tracking-wide text-center max-w-lg leading-relaxed">
              Describe a scene, character, mood, or style — and watch it come to life
            </p>
          </div>
        )}
      </div>

      {/* ── BOTTOM PROMPT BAR ── */}
      <div 
        className="absolute bottom-4 w-full max-w-[95%] lg:max-w-4xl z-40 animate-fade-in-up" 
        style={{ animationDelay: "0.2s" }}
      >
        <div className="w-full bg-[#0a0a0a]/80 backdrop-blur-3xl rounded-md border border-white/10 p-4 flex flex-col gap-2 shadow-2xl">
          {/* Top row: upload picker + textarea */}
          <div className="flex items-center gap-2">
            <UploadButton
              apiKey={apiKey}
              modelId={selectedModelId}
              maxImages={uploadMaxImages}
              onSelect={handleUploadSelect}
              onClear={handleUploadClear}
              initialUrls={uploadedImageUrls}
            />
            <div className="flex-1 flex flex-col gap-2">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onInput={handleTextareaInput}
                placeholder={placeholderText}
                rows={1}
                className="w-full bg-transparent border-none text-white text-sm placeholder:text-white/20 focus:outline-none resize-none pt-1 leading-relaxed min-h-[40px] max-h-[150px] md:max-h-[250px] overflow-y-auto custom-scrollbar"
              />
            </div>
          </div>

          <ModelParameterControls
            model={currentModelObj}
            params={modelParams}
            onChange={setModelParams}
            skipKeys={IMAGE_MODEL_PARAM_SKIP_KEYS}
            className="px-1"
          />

          {/* Bottom row: controls + generate */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-white/[0.03] relative">
            {/* Left controls */}
            <div className="flex items-center gap-2 relative flex-wrap pb-1 md:pb-0">
              {/* Model button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropdownOpen((o) => (o === "model" ? null : "model"));
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] rounded-md transition-all border border-white/[0.03] group whitespace-nowrap"
                >
                  <ModelBrandLogo brand={selectedModelBrand} size="small" />
                  <span className="text-xs font-semibold text-white/70 group-hover:text-[#22d3ee] transition-colors">
                    {selectedModelName}
                  </span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {dropdownOpen === "model" && (
                  <div
                    ref={dropdownRef}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-[calc(100%+12px)] left-0 z-50 bg-[#0a0a0a] rounded-lg p-3 shadow-2xl border border-white/[0.05] w-[calc(100vw-3rem)] max-w-xs"
                  >
                    <ModelDropdown
                      models={currentModels}
                      selectedModel={selectedModelId}
                      onSelect={handleModelSelect}
                      onClose={() => setDropdownOpen(null)}
                    />
                  </div>
                )}
              </div>

              {/* Aspect ratio button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropdownOpen((o) => (o === "ar" ? null : "ar"));
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] rounded-md transition-all border border-white/[0.03] group whitespace-nowrap"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-40 text-white">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  </svg>
                  <span className="text-[11px] font-semibold text-white/70 group-hover:text-[#22d3ee] transition-colors">
                    {selectedAr}
                  </span>
                </button>

                {dropdownOpen === "ar" && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-[calc(100%+12px)] left-0 z-50 bg-[#0a0a0a] rounded-md p-3 max-h-[40vh] overflow-y-auto custom-scrollbar shadow-2xl border border-white/10 min-w-[160px]"
                  >
                    <SimpleDropdown
                      title="Aspect Ratio"
                      options={currentAspectRatios}
                      selected={selectedAr}
                      onSelect={(val) => setSelectedAr(val)}
                      onClose={() => setDropdownOpen(null)}
                    />
                  </div>
                )}
              </div>

              {/* Quality/resolution button */}
              {showQualityBtn && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropdownOpen((o) => (o === "quality" ? null : "quality"));
                    }}
                    className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] rounded-md transition-all border border-white/[0.03] group whitespace-nowrap"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-40 text-white">
                      <path d="M6 2L3 6v15a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6z" />
                    </svg>
                    <span className="text-[11px] font-semibold text-white/70 group-hover:text-[#22d3ee] transition-colors">
                      {selectedQuality || currentResolutions[0]}
                    </span>
                  </button>

                  {dropdownOpen === "quality" && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute bottom-[calc(100%+12px)] left-0 z-50 bg-[#0a0a0a] rounded-md p-3 max-h-[40vh] overflow-y-auto custom-scrollbar shadow-2xl border border-white/[0.05] min-w-[160px]"
                    >
                      <SimpleDropdown
                        title="Resolution"
                        options={currentResolutions}
                        selected={selectedQuality}
                        onSelect={(val) => setSelectedQuality(val)}
                        onClose={() => setDropdownOpen(null)}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Effect type button */}
              {showEffectBtn && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropdownOpen((o) => (o === "effect" ? null : "effect"));
                    }}
                    className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] rounded-md transition-all border border-white/[0.03] group whitespace-nowrap"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-40 text-white">
                      <path d="M5 3l14 9-14 9V3z" />
                    </svg>
                    <span className="text-[11px] font-semibold text-white/70 group-hover:text-[#22d3ee] transition-colors max-w-[140px] truncate">
                      {selectedEffect || "Effect"}
                    </span>
                  </button>

                  {dropdownOpen === "effect" && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute bottom-[calc(100%+12px)] left-0 z-50 bg-[#0a0a0a] rounded-md p-3 max-h-[40vh] overflow-y-auto custom-scrollbar shadow-2xl border border-white/[0.05] min-w-[200px]"
                    >
                      <SimpleDropdown
                        title="Effect Type"
                        options={currentEffects}
                        selected={selectedEffect}
                        onSelect={(val) => setSelectedEffect(val)}
                        onClose={() => setDropdownOpen(null)}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Batch size selector */}
              <div className="flex items-center gap-1 bg-white/[0.03] rounded-md p-1 border border-white/[0.03]">
                {[1, 2, 3, 4].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setBatchSize(num)}
                    className={`w-7 h-7 flex items-center justify-center rounded-md text-[10px] font-black transition-all ${
                      batchSize === num
                        ? "bg-[#22d3ee] text-black shadow-lg shadow-[#22d3ee]/20"
                        : "text-white/40 hover:text-white/80 hover:bg-white/5"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="bg-[#22d3ee] text-black px-4 py-2 rounded-md font-medium text-sm hover:bg-[#e5ff33] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 w-full sm:w-auto shadow-lg shadow-[#22d3ee]/10 disabled:opacity-50 disabled:cursor-not-allowed z-10"
            >
              {generating ? (
                <>
                  <span className="animate-spin inline-block text-black">◌</span>
                  Generating...
                </>
              ) : generateError ? (
                `Error: ${generateError}`
              ) : (
                <>
                  <span>Generate</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── FULLSCREEN IMAGE MODAL ── */}
      {fullscreenUrl && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-fade-in"
          onClick={() => setFullscreenUrl(null)}
        >
          <button
            type="button"
            className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors border border-white/10"
            onClick={(e) => {
              e.stopPropagation();
              setFullscreenUrl(null);
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img 
            src={fullscreenUrl} 
            alt="Fullscreen Preview" 
            className="max-w-[95vw] max-h-[95vh] rounded-2xl shadow-2xl object-contain animate-scale-up" 
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
