import { useEffect, useRef, useState, type DragEvent, type ReactNode, type UIEvent } from "react";
import { callTool, errorMessage, getPathForFile, onToolEvent } from "../../api";
import { Checkbox, Field, FieldHint, inputBaseClass, secondaryButtonClass, Segmented } from "../../components/ui";
import type { ConvertJob, ImageInfo, LoadResult, Options, PreviewResult } from "../../../../main/tools/image_converter";
// Plain data shared with the main process, so the UI applies the same rules.
import {
  IMAGE_FORMATS,
  OUTPUT_CHOICES,
  outputFormat,
  type Compression,
  type ConvertSettings,
  type OutputChoice,
} from "../../../../main/tools/image_converter/formats";

const TOOL_ID = "image_converter";
const call = <T = unknown,>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);

// Wait this long after the last settings change before encoding the preview again.
const PREVIEW_DELAY = 400;

const FORMAT_OPTIONS = OUTPUT_CHOICES.map((value) => ({
  value,
  label: value === "same" ? "Same" : IMAGE_FORMATS[value].label,
}));
const FORMAT_HINTS: Record<OutputChoice, string> = {
  same: "Each image keeps its format. TIFF and SVG images are saved as PNG.",
  jpeg: "Small files for photos. No transparency: transparent areas become white.",
  png: "Lossless and keeps transparency. Best for screenshots and graphics; large for photos.",
  webp: "Smaller than JPEG and PNG at the same quality, with transparency and animation. Opens in all current browsers.",
  avif: "The smallest files, especially for photos, but slower to save and not supported by some older apps.",
  gif: "Up to 256 colors, for simple animations. Large and grainy for photos.",
};
const COMPRESSION_OPTIONS: { value: Compression; label: string }[] = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "strong", label: "Strong" },
  { value: "target", label: "Target size" },
];
const COMPRESSION_HINTS: Record<Compression, string> = {
  none: "Best quality. PNG and GIF stay lossless, and so do they when saved as WebP.",
  light: "Hardly any visible difference. PNGs are reduced to 256 colors, which usually looks the same.",
  medium: "Good balance between quality and size.",
  strong: "Smallest files; the quality loss is visible up close.",
  target: "Lowers the quality of each image, and its size if needed, until it fits. Works with JPEG, WebP and AVIF.",
};
const SIZE_OPTIONS: { value: ConvertSettings["maxSize"]; label: string }[] = [
  { value: 0, label: "Original" },
  { value: 3840, label: "3840" },
  { value: 2560, label: "2560" },
  { value: 1920, label: "1920" },
  { value: 1280, label: "1280" },
  { value: 800, label: "800" },
];
const FORMAT_NAMES: Record<string, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  heif: "AVIF",
  gif: "GIF",
  tiff: "TIFF",
  svg: "SVG",
};

// Checkerboard behind images, so transparent areas are visible.
const checkerClass =
  "bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#ffffff_0%_50%)] bg-size-[16px_16px] " +
  "dark:bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)]";

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "-80%" for a smaller result, "+12%" for a larger one. */
function sizeChange(input: number, output: number) {
  const percent = Math.round((100 * (output - input)) / input);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function droppedPaths(event: DragEvent) {
  return [...event.dataTransfer.files].map((file) => getPathForFile(file)).filter(Boolean);
}

/** Accepts files dropped anywhere on its area. */
function DropArea({
  onDropPaths,
  className,
  children,
}: {
  onDropPaths: (paths: string[]) => void;
  className: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const paths = droppedPaths(e);
        if (paths.length) onDropPaths(paths);
      }}
      className={`${className} ${over ? "outline-2 outline-offset-4 outline-blue-500 outline-dashed" : ""}`}
    >
      {children}
    </div>
  );
}

/** The original and the result side by side, scrolled together at 100%. */
function Compare({
  image,
  originalUrl,
  preview,
  loading,
  error,
}: {
  image: ImageInfo;
  originalUrl: string | null;
  preview: PreviewResult | null;
  loading: boolean;
  error: string | null;
}) {
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const panes = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];

  function syncScroll(from: number, event: UIEvent<HTMLDivElement>) {
    const other = panes[1 - from].current;
    if (!other) return;
    other.scrollLeft = event.currentTarget.scrollLeft;
    other.scrollTop = event.currentTarget.scrollTop;
  }

  // At 100% both are drawn at the original's size, so a resized result lines up with it.
  const imageClass = zoom === "fit" ? "h-full w-full object-contain" : "max-w-none";
  const imageStyle = zoom === "fit" ? undefined : { width: image.width, height: image.height };
  const pane = (index: number, label: ReactNode, url: string | null, busy: boolean) => (
    <div className="min-w-0 flex-1">
      <p className="mb-1 truncate text-xs text-gray-500">{label}</p>
      <div
        ref={panes[index]}
        onScroll={(e) => syncScroll(index, e)}
        className={`relative h-64 rounded-md border border-gray-200 dark:border-gray-800 ${zoom === "fit" ? "overflow-hidden" : "overflow-auto"} ${checkerClass}`}
      >
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            className={`${imageClass} ${busy ? "opacity-50" : ""}`}
            style={imageStyle}
          />
        )}
        {busy && (
          <span className="absolute top-2 right-2 rounded bg-gray-900/70 px-2 py-0.5 text-xs text-white">
            Updating...
          </span>
        )}
      </div>
    </div>
  );

  const resultLabel = error ? (
    <span className="text-red-600 dark:text-red-400">{error}</span>
  ) : preview ? (
    <>
      Result · {IMAGE_FORMATS[preview.format].label} · {preview.width}x{preview.height} · {formatBytes(preview.size)}{" "}
      <span
        className={
          preview.size > image.size ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"
        }
      >
        ({sizeChange(image.size, preview.size)})
      </span>
    </>
  ) : (
    "Result"
  );

  return (
    <div className="mt-4">
      <div className="flex gap-3">
        {pane(
          0,
          `Original · ${FORMAT_NAMES[image.format] ?? image.format} · ${image.width}x${image.height} · ${formatBytes(image.size)}`,
          originalUrl,
          false,
        )}
        {pane(1, resultLabel, preview?.url ?? null, loading)}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Segmented
          options={[
            { value: "fit", label: "Fit" },
            { value: "actual", label: "100%" },
          ]}
          value={zoom}
          disabled={false}
          onChange={setZoom}
        />
        <span className="text-xs text-gray-500">
          {preview?.note ??
            (zoom === "actual" ? "Scroll either image to compare details." : "Compare at 100% to judge the quality.")}
        </span>
      </div>
    </div>
  );
}

function Results({ job, onShow }: { job: ConvertJob; onShow: (path: string) => void }) {
  const saved = job.results.filter((result) => result.output);
  const failed = job.results.length - saved.length;
  const before = saved.reduce((total, result) => total + result.inputSize, 0);
  const after = saved.reduce((total, result) => total + result.outputSize, 0);

  return (
    <div className="mt-2">
      {saved.length > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Saved {saved.length} {saved.length === 1 ? "image" : "images"}: {formatBytes(before)} → {formatBytes(after)} (
          {sizeChange(before, after)}){" · "}
          <button type="button" className="text-blue-600 hover:underline" onClick={() => onShow(saved[0].output!)}>
            Show in folder
          </button>
        </p>
      )}
      {failed > 0 && <p className="text-sm text-red-600 dark:text-red-400">{failed} could not be converted.</p>}
      {job.state === "canceled" && <p className="text-sm text-gray-500">Conversion canceled.</p>}
      {job.results.length > 1 || failed > 0 || job.results.some((result) => result.note) ? (
        <ul className="mt-3 flex flex-col gap-1 text-xs">
          {job.results.map((result, i) => (
            <li key={i} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate" title={result.output ?? result.path}>
                {result.output ? result.output.split(/[\\/]/).at(-1) : result.name}
                {result.note && <span className="text-gray-500"> · {result.note}</span>}
                {result.error && <span className="text-red-600 dark:text-red-400"> · {result.error}</span>}
              </span>
              {result.output && (
                <span
                  className={`shrink-0 ${result.outputSize > result.inputSize ? "text-amber-700 dark:text-amber-400" : "text-gray-500"}`}
                >
                  {formatBytes(result.inputSize)} → {formatBytes(result.outputSize)} (
                  {sizeChange(result.inputSize, result.outputSize)})
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function ImageConverter() {
  const [settings, setSettings] = useState<ConvertSettings | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [job, setJob] = useState<ConvertJob | null>(null);
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  useEffect(() => {
    call<Options>("options")
      .then((opts) => {
        setSettings(opts.settings);
        setFolder(opts.folder);
        setJob(opts.job);
      })
      .catch((err) => setError(errorMessage(err)));
    return onToolEvent(TOOL_ID, "job", (payload) => setJob(payload as ConvertJob));
  }, []);

  const image: ImageInfo | undefined = images[selected];

  // The original as the browser can show it (TIFFs are converted to PNG).
  useEffect(() => {
    setOriginalUrl(image?.previewUrl ?? image?.thumbnail ?? null);
    if (!image || image.previewUrl) return;
    let current = true;
    call<PreviewResult>("preview", image.path, "original")
      .then((result) => current && setOriginalUrl(result.url))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [image]);

  // Encode the selected image with the current settings, shortly after they stop changing.
  useEffect(() => {
    if (!image || !settings) {
      setPreview(null);
      return;
    }
    let current = true;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      call<PreviewResult>("preview", image.path, settings)
        .then((result) => {
          if (!current) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((err) => {
          if (!current) return;
          setPreview(null);
          setPreviewError(errorMessage(err));
        })
        .finally(() => current && setPreviewLoading(false));
    }, PREVIEW_DELAY);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [image, settings]);

  const update = (changes: Partial<ConvertSettings>) => setSettings((current) => current && { ...current, ...changes });

  function selectFormat(format: OutputChoice) {
    // PNG and GIF have no quality setting to aim for a size with.
    const lossless = format !== "same" && !IMAGE_FORMATS[format].lossy;
    update(lossless && settings?.compression === "target" ? { format, compression: "medium" } : { format });
  }

  async function add(method: "openFiles" | "load", ...args: unknown[]) {
    setLoading(true);
    setError(null);
    try {
      const result = await call<LoadResult>(method, ...args);
      setLoadErrors(result.errors);
      setImages((current) => {
        const known = new Set(current.map((item) => item.path));
        return [...current, ...result.images.filter((item) => !known.has(item.path))];
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function remove(index: number) {
    setImages((current) => current.filter((_, i) => i !== index));
    setSelected((current) => (index < current || current === images.length - 1 ? Math.max(0, current - 1) : current));
  }

  async function convert() {
    if (!settings) return;
    setError(null);
    try {
      setJob(
        await call<ConvertJob>(
          "convert",
          images.map((item) => item.path),
          settings,
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!settings || !job) {
    return error ? (
      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
    ) : (
      <p className="text-gray-500">Loading...</p>
    );
  }

  const running = job.state === "running";
  const outputs = images.map((item) => outputFormat(settings.format, item.format));
  const lossless = settings.format !== "same" && !IMAGE_FORMATS[settings.format].lossy;
  const warnings: string[] = [];
  if (images.some((item, i) => item.frames > 1 && !IMAGE_FORMATS[outputs[i]].animation)) {
    warnings.push("Animated images keep only their first frame in this format.");
  }
  if (images.some((item, i) => item.hasAlpha && outputs[i] === "jpeg")) {
    warnings.push("Transparent areas become white in JPEG.");
  }
  if (settings.compression === "target" && outputs.some((format) => !IMAGE_FORMATS[format].lossy)) {
    warnings.push(
      "Target size cannot be used for PNG and GIF images: choose JPEG, WebP or AVIF as the format to convert them.",
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold">Image Converter</h2>
      <p className="mt-1 mb-8 text-sm text-gray-500">
        Convert images between JPEG, PNG, WebP, AVIF and GIF, and compress or resize them to make the files smaller. The
        originals are never changed.
      </p>

      {!images.length ? (
        <DropArea
          onDropPaths={(paths) => add("load", paths)}
          className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-700"
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {loading ? "Reading the images..." : "Drop images here"}
          </p>
          <button type="button" className={secondaryButtonClass} disabled={loading} onClick={() => add("openFiles")}>
            Open images...
          </button>
          <p className="text-xs text-gray-500">JPEG, PNG, WebP, AVIF, GIF, TIFF or SVG. Several at once is fine.</p>
        </DropArea>
      ) : (
        <>
          <DropArea onDropPaths={(paths) => add("load", paths)} className="rounded-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {images.length} {images.length === 1 ? "image" : "images"} ·{" "}
                {formatBytes(images.reduce((total, item) => total + item.size, 0))}
              </p>
              <div className="flex gap-3 text-sm">
                <button
                  type="button"
                  className="text-blue-600 hover:underline disabled:opacity-50"
                  disabled={running || loading}
                  onClick={() => add("openFiles")}
                >
                  {loading ? "Reading..." : "Add images"}
                </button>
                <button
                  type="button"
                  className="text-gray-500 hover:underline disabled:opacity-50"
                  disabled={running}
                  onClick={() => {
                    setImages([]);
                    setSelected(0);
                    setLoadErrors([]);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-gray-200 dark:border-gray-800">
              {images.map((item, i) => (
                <li
                  key={item.path}
                  onClick={() => setSelected(i)}
                  className={`flex cursor-pointer items-center gap-3 px-2 py-1.5 ${
                    i === selected ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-gray-50 dark:hover:bg-gray-900"
                  }`}
                >
                  <img
                    src={item.thumbnail}
                    alt=""
                    className={`size-10 shrink-0 rounded object-contain ${checkerClass}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={item.path}>
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {FORMAT_NAMES[item.format] ?? item.format} · {item.width}x{item.height}
                      {item.frames > 1 && ` · ${item.frames} frames`} · {formatBytes(item.size)}
                      {outputs[i] !== outputFormat("same", item.format) && ` → ${IMAGE_FORMATS[outputs[i]].label}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    title="Remove"
                    disabled={running}
                    className="shrink-0 rounded px-2 text-gray-400 hover:text-red-600 disabled:opacity-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(i);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </DropArea>
          {image && (
            <Compare
              image={image}
              originalUrl={originalUrl}
              preview={preview}
              loading={previewLoading}
              error={previewError}
            />
          )}
        </>
      )}
      {loadErrors.length > 0 && (
        <p className="mt-2 text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">
          Could not open:{"\n"}
          {loadErrors.join("\n")}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <Field label="Format">
          <Segmented options={FORMAT_OPTIONS} value={settings.format} disabled={running} onChange={selectFormat} />
        </Field>
        <FieldHint>{FORMAT_HINTS[settings.format]}</FieldHint>
        <Field label="Compress">
          <Segmented
            options={COMPRESSION_OPTIONS.filter((option) => !(lossless && option.value === "target"))}
            value={settings.compression}
            disabled={running}
            onChange={(compression) => update({ compression })}
          />
        </Field>
        {settings.compression === "target" && (
          <Field label="Target size">
            <input
              type="number"
              min={1}
              step={10}
              className={`${inputBaseClass} w-28`}
              value={settings.targetSizeKb}
              disabled={running}
              onChange={(e) => update({ targetSizeKb: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span className="text-sm text-gray-500">KB per image</span>
          </Field>
        )}
        <FieldHint>{COMPRESSION_HINTS[settings.compression]}</FieldHint>
        <Field label="Max size">
          <Segmented
            options={SIZE_OPTIONS}
            value={settings.maxSize}
            disabled={running}
            onChange={(maxSize) => update({ maxSize })}
          />
          {settings.maxSize > 0 && <span className="text-sm text-gray-500">px</span>}
        </Field>
        <FieldHint>Longest side in pixels. Smaller images are never enlarged.</FieldHint>
        <Field label="Metadata">
          <Checkbox
            label="Keep camera info, date and location"
            checked={settings.keepMetadata}
            disabled={running}
            onChange={(keepMetadata) => update({ keepMetadata })}
          />
        </Field>
        <FieldHint>Removed by default: it makes files smaller and photos may contain where they were taken.</FieldHint>
        <Field label="Save to">
          <span className="min-w-0 flex-1 truncate text-sm" title={folder ?? undefined}>
            {folder ?? "Next to the original files"}
          </span>
          {folder && (
            <button
              type="button"
              className="text-sm text-gray-500 hover:underline"
              disabled={running}
              onClick={() => call<null>("resetFolder").then(setFolder)}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={running}
            onClick={() => call<string | null>("chooseFolder").then(setFolder)}
          >
            Browse...
          </button>
        </Field>
        {warnings.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{warnings.join(" ")}</p>}
      </div>

      <div className="mt-8 mb-4 flex items-center gap-3">
        {running ? (
          <button type="button" className={`${secondaryButtonClass} w-44`} onClick={() => call("cancel")}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={convert}
            disabled={!images.length}
            className="w-44 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {images.length > 1 ? `Convert ${images.length} images` : "Convert"}
          </button>
        )}
        {running && (
          <div className="flex-1">
            <p className="mb-1 truncate text-xs text-gray-500">
              {job.results.length + 1} of {job.total}
              {job.current && ` · ${job.current}`}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full bg-blue-600 transition-[width]"
                style={{ width: `${(100 * job.results.length) / job.total}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {(job.state === "done" || job.state === "canceled") && (
        <Results job={job} onShow={(path) => call("showFile", path)} />
      )}
      {error && <p className="mt-2 text-sm whitespace-pre-wrap text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
