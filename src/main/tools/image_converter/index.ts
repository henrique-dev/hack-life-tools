import { stat, writeFile } from "node:fs/promises";
import { basename, dirname, parse } from "node:path";
import sharp, { type Metadata, type Sharp } from "sharp";
import type { Host } from "../../host";
import { uniquePath } from "../../lib/ffmpeg";
import { errorMessage } from "../../lib/util";
import type { Tool, ToolApi } from "../types";
import {
  IMAGE_FORMATS,
  INPUT_EXTENSIONS,
  isLosslessSource,
  outputFormat,
  type Compression,
  type ConvertSettings,
  type ImageFormat,
} from "./formats";

export type { Compression, ConvertSettings, ImageFormat, OutputChoice } from "./formats";

const TOOL_ID = "image_converter";
const THUMBNAIL_SIZE = 96;
// Formats Chromium shows in an <img>; others (TIFF) are previewed through a PNG.
const DISPLAYABLE = new Set(["jpeg", "png", "webp", "heif", "gif", "svg"]);
// Target size: quality range searched, and how much to shrink the image when even
// the lowest quality is too large.
const TARGET_MIN_QUALITY = 30;
const TARGET_STEPS = 7;
const TARGET_SCALE_STEP = 0.8;
const TARGET_MAX_SHRINKS = 8;
const MIN_SIDE = 16;

// Without the cache, files are not kept open (on Windows, open files cannot be moved or deleted).
sharp.cache(false);

type Level = Exclude<Compression, "target">;

/** Quality of the lossy formats for each compression level. AVIF looks the same at lower numbers. */
const QUALITY: Record<"jpeg" | "webp" | "avif", Record<Level, number>> = {
  jpeg: { none: 95, light: 85, medium: 75, strong: 60 },
  webp: { none: 95, light: 85, medium: 75, strong: 60 },
  avif: { none: 80, light: 65, medium: 52, strong: 40 },
};
/** PNG: lossless without compression, otherwise reduced to a palette (like TinyPNG). */
const PNG_PALETTE: Record<Exclude<Level, "none">, { quality: number; colours: number }> = {
  light: { quality: 90, colours: 256 },
  medium: { quality: 75, colours: 256 },
  strong: { quality: 55, colours: 128 },
};
const GIF_LEVELS: Record<Level, { colours: number; interFrameMaxError: number }> = {
  none: { colours: 256, interFrameMaxError: 0 },
  light: { colours: 256, interFrameMaxError: 2 },
  medium: { colours: 128, interFrameMaxError: 5 },
  strong: { colours: 64, interFrameMaxError: 10 },
};

export interface ImageInfo {
  path: string;
  name: string;
  size: number;
  width: number;
  height: number;
  /** As sharp names it: "jpeg", "png", "webp", "heif" (AVIF), "gif", "tiff", "svg". */
  format: string;
  frames: number;
  hasAlpha: boolean;
  /** Small image for the file list. */
  thumbnail: string;
  /** URL of the original for the comparison view, or null to use preview(..., "original"). */
  previewUrl: string | null;
}

export interface LoadResult {
  images: ImageInfo[];
  /** Files that could not be read, with the reason. */
  errors: string[];
}

export interface Encoded {
  data: Buffer;
  format: ImageFormat;
  width: number;
  height: number;
  /** Something the user should know, e.g. that the image was resized to reach the target size. */
  note: string | null;
}

export interface PreviewResult {
  url: string;
  size: number;
  width: number;
  height: number;
  format: ImageFormat;
  note: string | null;
}

export interface ConvertResult {
  path: string;
  name: string;
  output: string | null;
  inputSize: number;
  outputSize: number;
  width: number;
  height: number;
  note: string | null;
  error: string | null;
}

export interface ConvertJob {
  state: "idle" | "running" | "done" | "canceled";
  total: number;
  /** Name of the image being converted. */
  current: string | null;
  results: ConvertResult[];
}

export interface Options {
  settings: ConvertSettings;
  /** null: save next to the originals. */
  folder: string | null;
  job: ConvertJob;
}

const idleJob = (): ConvertJob => ({ state: "idle", total: 0, current: null, results: [] });

function formatKb(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function readMetadata(path: string): Promise<Metadata> {
  const meta = await sharp(path).metadata();
  if (!meta.format || !meta.width || !meta.height) throw new Error("not a supported image");
  return meta;
}

/** Width and height after rotating by the EXIF orientation. */
function orientedSize(meta: Metadata) {
  const height = meta.pageHeight ?? meta.height!;
  const swap = (meta.orientation ?? 1) >= 5;
  return swap ? { width: height, height: meta.width! } : { width: meta.width!, height };
}

/**
 * Encode an image with the settings. `quality` overrides the level's quality
 * (lossy formats), and `scale` shrinks it further (both used to reach a target size).
 */
async function encodeOnce(path: string, meta: Metadata, settings: ConvertSettings, quality?: number, scale = 1) {
  const format = outputFormat(settings.format, meta.format!);
  const frames = meta.pages ?? 1;
  const animated = IMAGE_FORMATS[format].animation && frames > 1;
  let image: Sharp = sharp(path, { animated, limitInputPixels: false }).autoOrient();

  const size = orientedSize(meta);
  const fit = settings.maxSize ? Math.min(1, settings.maxSize / Math.max(size.width, size.height)) : 1;
  if (fit * scale < 1) {
    const width = Math.max(MIN_SIDE, Math.round(size.width * fit * scale));
    image = image.resize({ width, withoutEnlargement: true });
  }
  if (settings.keepMetadata) image = image.keepMetadata();

  const level: Level = settings.compression === "target" ? "none" : settings.compression;
  switch (format) {
    case "jpeg":
      // JPEG has no transparency: transparent areas become white instead of black.
      if (meta.hasAlpha) image = image.flatten({ background: "#ffffff" });
      image = image.jpeg({ quality: quality ?? QUALITY.jpeg[level], mozjpeg: true });
      break;
    case "webp":
      image =
        level === "none" && quality === undefined && isLosslessSource(meta.format!)
          ? image.webp({ lossless: true, effort: 6 })
          : image.webp({ quality: quality ?? QUALITY.webp[level], effort: 6, smartSubsample: true });
      break;
    case "avif":
      image = image.avif({ quality: quality ?? QUALITY.avif[level], effort: 4 });
      break;
    case "png":
      image =
        level === "none"
          ? image.png({ compressionLevel: 9, adaptiveFiltering: true })
          : image.png({ compressionLevel: 9, palette: true, effort: 10, ...PNG_PALETTE[level] });
      break;
    case "gif":
      image = image.gif({ effort: 10, ...GIF_LEVELS[level] });
      break;
  }

  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  // For animations, info.height is the height of all frames stacked.
  const height = info.pageHeight ?? info.height;
  return { data, format, width: info.width, height };
}

/** Encode an image; with compression "target", find the best quality (and, if needed, size) that fits. */
async function encode(path: string, settings: ConvertSettings): Promise<Encoded> {
  const meta = await readMetadata(path);
  if (settings.compression !== "target") return { ...(await encodeOnce(path, meta, settings)), note: null };

  const format = outputFormat(settings.format, meta.format!);
  if (!IMAGE_FORMATS[format].lossy) {
    throw new Error(
      `Target size works with JPEG, WebP and AVIF, not ${IMAGE_FORMATS[format].label}. Choose one of them or another compression.`,
    );
  }
  const target = settings.targetSizeKb * 1024;
  const maxQuality = QUALITY[format as keyof typeof QUALITY].none;

  let scale = 1;
  let smallest: Awaited<ReturnType<typeof encodeOnce>> | null = null;
  for (let shrink = 0; shrink <= TARGET_MAX_SHRINKS; shrink++) {
    // Binary search for the highest quality under the target.
    let low = TARGET_MIN_QUALITY;
    let high = maxQuality;
    let best: Awaited<ReturnType<typeof encodeOnce>> | null = null;
    for (let step = 0; step < TARGET_STEPS && low <= high; step++) {
      const quality = Math.round((low + high) / 2);
      const result = await encodeOnce(path, meta, settings, quality, scale);
      if (!smallest || result.data.length < smallest.data.length) smallest = result;
      if (result.data.length <= target) {
        best = result;
        low = quality + 1;
      } else {
        high = quality - 1;
      }
    }
    if (best) {
      const size = orientedSize(meta);
      const resized =
        scale < 1
          ? `Resized to ${best.width}x${best.height} (from ${size.width}x${size.height}) to fit ${formatKb(target)}.`
          : null;
      return { ...best, note: resized };
    }
    scale *= TARGET_SCALE_STEP;
    if (Math.max(...Object.values(orientedSize(meta))) * scale < MIN_SIDE) break;
  }
  return { ...smallest!, note: `Could not get under ${formatKb(target)}; this is the smallest result.` };
}

function dataUrl(data: Buffer, format: ImageFormat) {
  return `data:image/${format};base64,${data.toString("base64")}`;
}

/**
 * Converts images between JPEG, PNG, WebP, AVIF and GIF, compresses and resizes
 * them with sharp (libvips). The originals are never changed.
 */
class ImageConverterApi implements ToolApi {
  private settings: ConvertSettings = {
    format: "same",
    compression: "medium",
    targetSizeKb: 500,
    maxSize: 0,
    keepMetadata: false,
  };
  private folder: string | null = null;
  private job: ConvertJob = idleJob();
  private canceled = false;

  constructor(private readonly host: Host) {}

  options(): Options {
    return { settings: this.settings, folder: this.folder, job: this.job };
  }

  async openFiles(): Promise<LoadResult> {
    const paths = await this.host.pickFiles([
      { name: "Images", extensions: INPUT_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ]);
    return this.load(paths);
  }

  /** Read images chosen by the user (also used for files dropped on the window). */
  async load(paths: string[]): Promise<LoadResult> {
    const images: ImageInfo[] = [];
    const errors: string[] = [];
    for (const path of paths) {
      try {
        const meta = await readMetadata(path);
        const thumbnail = await sharp(path, { limitInputPixels: false })
          .autoOrient()
          .resize(THUMBNAIL_SIZE * 2, THUMBNAIL_SIZE * 2, { fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();
        const { width, height } = orientedSize(meta);
        images.push({
          path,
          name: basename(path),
          size: (await stat(path)).size,
          width,
          height,
          format: meta.format!,
          frames: meta.pages ?? 1,
          hasAlpha: meta.hasAlpha ?? false,
          thumbnail: dataUrl(thumbnail, "png"),
          // The <img> would ignore the EXIF orientation of TIFFs, and cannot show them at all.
          previewUrl: DISPLAYABLE.has(meta.format!) ? this.host.mediaUrl(path) : null,
        });
      } catch (err) {
        errors.push(`${basename(path)}: ${errorMessage(err)}`);
      }
    }
    return { images, errors };
  }

  /** The image as it would be saved with these settings, or the original as PNG ("original", for TIFF). */
  async preview(path: string, settings: ConvertSettings | "original"): Promise<PreviewResult> {
    if (settings === "original") {
      const { data, info } = await sharp(path, { limitInputPixels: false })
        .autoOrient()
        .png()
        .toBuffer({ resolveWithObject: true });
      return {
        url: dataUrl(data, "png"),
        size: data.length,
        width: info.width,
        height: info.height,
        format: "png",
        note: null,
      };
    }
    const result = await encode(path, settings);
    return {
      url: dataUrl(result.data, result.format),
      size: result.data.length,
      width: result.width,
      height: result.height,
      format: result.format,
      note: result.note,
    };
  }

  async chooseFolder() {
    const folder = await this.host.pickFolder(this.folder ?? "");
    if (folder) this.folder = folder;
    return this.folder;
  }

  /** Save next to the originals again. */
  resetFolder() {
    this.folder = null;
    return this.folder;
  }

  showFile(path: string) {
    this.host.showInFolder(path);
  }

  getJob() {
    return this.job;
  }

  convert(paths: string[], settings: ConvertSettings) {
    if (this.job.state === "running") throw new Error("A conversion is already running.");
    if (!paths.length) throw new Error("Add some images first.");
    this.settings = settings;
    this.canceled = false;
    this.job = { state: "running", total: paths.length, current: null, results: [] };
    this.emit();
    void this.run(paths, settings);
    return this.job;
  }

  cancel() {
    this.canceled = true;
    return this.job;
  }

  shutdown() {
    this.canceled = true;
  }

  private async run(paths: string[], settings: ConvertSettings) {
    for (const path of paths) {
      if (this.canceled) break;
      const name = basename(path);
      this.job = { ...this.job, current: name };
      this.emit();
      const result: ConvertResult = {
        path,
        name,
        output: null,
        inputSize: 0,
        outputSize: 0,
        width: 0,
        height: 0,
        note: null,
        error: null,
      };
      try {
        result.inputSize = (await stat(path)).size;
        const encoded = await encode(path, settings);
        // A new file next to the original (or in the chosen folder), never over it.
        const { name: base, ext } = parse(path);
        const sameFormat =
          IMAGE_FORMATS[encoded.format].extension === ext.slice(1).toLowerCase().replace("jpeg", "jpg");
        const output = uniquePath(
          this.folder ?? dirname(path),
          sameFormat ? `${base}_compressed` : base,
          IMAGE_FORMATS[encoded.format].extension,
        );
        await writeFile(output, encoded.data, { flag: "wx" });
        Object.assign(result, {
          output,
          outputSize: encoded.data.length,
          width: encoded.width,
          height: encoded.height,
          note: encoded.note,
        });
      } catch (err) {
        result.error = errorMessage(err);
      }
      this.job = { ...this.job, results: [...this.job.results, result] };
      this.emit();
    }
    this.job = { ...this.job, state: this.canceled ? "canceled" : "done", current: null };
    this.emit();
  }

  private emit() {
    this.host.emit(TOOL_ID, "job", this.job);
  }
}

const tool: Tool = {
  name: "Image Converter",
  description: "Convert images between JPEG, PNG, WebP, AVIF and GIF, compress them and reduce their size.",
  createApi: (host) => new ImageConverterApi(host),
};

export default tool;
