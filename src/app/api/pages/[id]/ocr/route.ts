import { OcrFailure, ocrPage } from "@/lib/ocr";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const page = await ocrPage(id);
    return Response.json({
      pageId: page.id,
      words: page.words?.length ?? 0,
      characters: page.canonicalText?.length ?? 0,
    });
  } catch (error) {
    if (error instanceof OcrFailure) {
      return Response.json({ error: error.detail }, { status: 502 });
    }
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
