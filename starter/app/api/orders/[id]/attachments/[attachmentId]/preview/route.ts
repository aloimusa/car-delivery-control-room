import { execFile } from "node:child_process"
import { mkdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { NextResponse } from "next/server"
import { attachmentPath, attachmentsDir, readAttachmentManifest } from "@/lib/attachments"

export const runtime = "nodejs"

const run = promisify(execFile)
/** First pages rendered once, kept next to the attachments (git-ignored). */
const cacheDir = join(attachmentsDir, ".previews")

/**
 * The first page of a PDF attachment as a PNG, so a document tile shows the document and not an icon. Rendered with
 * poppler's pdftoppm on first request and cached; without poppler the tile falls back to its icon (404 here).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await context.params
  const attachment = (await readAttachmentManifest()).find((entry) => entry.id === attachmentId && entry.order_id === id)
  if (!attachment) return NextResponse.json({ error: "No such attachment on this order" }, { status: 404 })
  if (attachment.content_type !== "application/pdf") return NextResponse.json({ error: "Only PDF attachments have a rendered preview" }, { status: 404 })
  const target = join(cacheDir, `${attachment.id}.png`)
  const fresh = await stat(target).then((info) => info.size > 0).catch(() => false)
  if (!fresh) {
    try {
      await mkdir(cacheDir, { recursive: true })
      // -singlefile writes exactly <prefix>.png; 72 dpi is plenty for a tile and keeps the file small.
      await run("pdftoppm", ["-png", "-r", "72", "-f", "1", "-l", "1", "-singlefile", attachmentPath(attachment), join(cacheDir, attachment.id)], { timeout: 15_000 })
    } catch (error) {
      return NextResponse.json({ error: `No preview: ${error instanceof Error ? error.message.split("\n")[0] : "render failed"}` }, { status: 404 })
    }
  }
  const png = await readFile(target)
  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } })
}
