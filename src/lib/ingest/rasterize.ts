import { createCanvas } from "@napi-rs/canvas";

export interface RasterPage {
  png: Buffer;
  width: number;
  height: number;
}

/** 2x the PDF's natural size: OCR accuracy on small print falls off sharply below this. */
const SCALE = 2;

export async function rasterizePdf(pdf: Buffer): Promise<RasterPage[]> {
  // pdfjs ships as an ESM build that expects a browser-ish global; the legacy build is
  // the one that runs under Node.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
  }).promise;

  const out: RasterPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // @napi-rs/canvas is API-compatible with the DOM types pdfjs declares.
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    out.push({
      png: canvas.toBuffer("image/png"),
      width: canvas.width,
      height: canvas.height,
    });
  }
  return out;
}
