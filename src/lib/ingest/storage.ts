import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export async function storePageImage(
  documentId: string,
  pageIndex: number,
  png: Buffer,
): Promise<string> {
  const dir = path.join(UPLOAD_DIR, documentId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${pageIndex}.png`);
  await writeFile(file, png);
  return path.relative(process.cwd(), file);
}

export function resolvePageImage(imagePath: string): string {
  return path.join(process.cwd(), imagePath);
}
