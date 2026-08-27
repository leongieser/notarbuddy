import { PDFDocument } from "pdf-lib";
import { rasterizePdf } from "@/lib/ingest/rasterize";

/**
 * Turns a crisp rendered PDF into something closer to what actually arrives at a notary's
 * office: a photocopy of a printout, scanned at an angle on a tired machine.
 *
 * Everything downstream — OCR, the geometry-based reading order, and above all the
 * pixel-measured strike detection — has only ever been exercised on clean renders. This
 * exists so those assumptions get tested before a reviewer tests them for us.
 */

export interface ScanOptions {
  /** Page rotation in degrees; real scans are rarely square. */
  skewDegrees: number;
  /** Per-pixel luminance jitter, 0–255. */
  noise: number;
  /** How far white paper drifts towards grey. */
  greyLift: number;
  /** JPEG quality of the re-encoded page, 0–1. */
  quality: number;
  /** Rasterization scale; ~4 approximates 300 dpi for A4, 1.5 a low-resolution scan. */
  scale: number;
}

/**
 * Calibrated against what Vision can still read. Harsher settings were tried first and
 * dropped mean word confidence from 0.95 to 0.54, turning "Bestandsverzeichnis" into
 * "Betanzos" — that tests the OCR vendor's limits, not this pipeline.
 *
 * Resolution dominates noise: the same artefacts are harmless at 300 dpi and fatal at 100.
 */
export const MILD: ScanOptions = {
  skewDegrees: 0.3,
  noise: 3,
  greyLift: 8,
  quality: 0.9,
  scale: 4,
};

export const HARSH: ScanOptions = {
  skewDegrees: 0.8,
  noise: 6,
  greyLift: 16,
  quality: 0.8,
  scale: 2.5,
};

/**
 * Deliberately past the point Vision can read. Not a failed sample — a test that a barely
 * legible scan is reported as such rather than transcribed into confident nonsense.
 */
export const UNREADABLE: ScanOptions = {
  skewDegrees: 1.4,
  noise: 22,
  greyLift: 30,
  quality: 0.4,
  scale: 1.4,
};

async function degradePage(png: Buffer, options: ScanOptions): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(png);

  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");

  // Paper, then the page laid down slightly askew on it.
  ctx.fillStyle = `rgb(${255 - options.greyLift},${255 - options.greyLift},${255 - options.greyLift})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((options.skewDegrees * Math.PI) / 180);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  ctx.drawImage(image, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = frame;
  for (let i = 0; i < data.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 2 * options.noise;
    data[i] = Math.max(0, Math.min(255, data[i] + jitter));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + jitter));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + jitter));
  }
  ctx.putImageData(frame, 0, 0);

  // JPEG round-trip so the ringing artefacts around glyphs and rules are real.
  return canvas.toBuffer("image/jpeg", options.quality);
}

export async function scanify(
  pdf: Buffer,
  options: ScanOptions,
): Promise<Buffer> {
  const pages = await rasterizePdf(pdf, options.scale);
  const out = await PDFDocument.create();

  for (const page of pages) {
    const jpg = await out.embedJpg(await degradePage(page.png, options));
    const sheet = out.addPage([page.width, page.height]);
    sheet.drawImage(jpg, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    });
  }

  return Buffer.from(await out.save());
}
