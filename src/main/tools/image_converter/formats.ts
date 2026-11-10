// Output formats and settings of the Image Converter. Plain data and functions
// only, so the UI can import this module too.

export type ImageFormat = "jpeg" | "png" | "webp" | "avif" | "gif";

/** "same": each image keeps its format (see outputFormat()). */
export type OutputChoice = "same" | ImageFormat;

export interface ImageFormatInfo {
  label: string;
  extension: string;
  /** Quality can be lowered gradually, so a target size can be aimed for. */
  lossy: boolean;
  transparency: boolean;
  animation: boolean;
}

export const IMAGE_FORMATS: Record<ImageFormat, ImageFormatInfo> = {
  jpeg: { label: "JPEG", extension: "jpg", lossy: true, transparency: false, animation: false },
  png: { label: "PNG", extension: "png", lossy: false, transparency: true, animation: false },
  webp: { label: "WebP", extension: "webp", lossy: true, transparency: true, animation: true },
  avif: { label: "AVIF", extension: "avif", lossy: true, transparency: true, animation: false },
  gif: { label: "GIF", extension: "gif", lossy: false, transparency: true, animation: true },
};

export const OUTPUT_CHOICES: OutputChoice[] = ["same", "jpeg", "png", "webp", "avif", "gif"];

/** Formats that can be opened, as file extensions. */
export const INPUT_EXTENSIONS = ["jpg", "jpeg", "jfif", "png", "webp", "avif", "gif", "tif", "tiff", "svg"];

export type Compression = "none" | "light" | "medium" | "strong" | "target";

export interface ConvertSettings {
  format: OutputChoice;
  compression: Compression;
  /** For compression "target", per image. */
  targetSizeKb: number;
  /** Longest side in pixels; 0 keeps the original size. Images are never enlarged. */
  maxSize: 0 | 3840 | 2560 | 1920 | 1280 | 800;
  /** Keep EXIF (camera, date, location), ICC and XMP data. */
  keepMetadata: boolean;
}

/**
 * Output format for an image whose format sharp reports as `input` (e.g. "jpeg",
 * "heif" for AVIF). With "same", formats that cannot be written (TIFF, SVG) become PNG.
 */
export function outputFormat(choice: OutputChoice, input: string): ImageFormat {
  if (choice !== "same") return choice;
  if (input === "heif") return "avif";
  return input in IMAGE_FORMATS ? (input as ImageFormat) : "png";
}

/** Formats whose source pixels are exact, so "no compression" can stay lossless. */
export function isLosslessSource(input: string) {
  return input === "png" || input === "gif" || input === "tiff" || input === "svg";
}
