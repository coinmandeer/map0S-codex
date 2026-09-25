import { NodeIO, Logger, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function resizeTextures(document: Document, size: number) {
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const compressed = await sharp(Buffer.from(image), { limitInputPixels: 16 * 1024 * 1024 })
      .resize(size, size, { fit: "inside", withoutEnlargement: true, kernel: "nearest" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    texture.setImage(new Uint8Array(compressed)).setMimeType("image/png");
  }
}
function metrics(doc: Document, bytes: Uint8Array) {
  let triangles = 0,
    drawCalls = 0,
    textureBytes = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      drawCalls++;
      triangles +=
        (primitive.getIndices()?.getCount() ??
          primitive.getAttribute("POSITION")?.getCount() ??
          0) / 3;
    }
  for (const t of doc.getRoot().listTextures()) {
    const size = t.getSize();
    if (size) textureBytes += size[0] * size[1] * 4;
  }
  return { bytes: bytes.byteLength, triangles: Math.floor(triangles), drawCalls, textureBytes };
}
/** Asset-only optimization: same token, appearance and materials; no changes to map rendering. */
export async function optimizeGotchi(source: Uint8Array) {
  const high = await io.readBinary(source);
  high.setLogger(new Logger(Logger.Verbosity.SILENT));
  await resizeTextures(high, 512);
  await high.transform(dedup(), prune());
  const highBytes = await io.writeBinary(high);
  const low = await io.readBinary(highBytes);
  low.setLogger(new Logger(Logger.Verbosity.SILENT));
  await MeshoptSimplifier.ready;
  await low.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 })
  );
  await resizeTextures(low, 256);
  await low.transform(prune());
  const lowBytes = await io.writeBinary(low);
  return {
    high: { data: highBytes, ...metrics(high, highBytes) },
    low: { data: lowBytes, ...metrics(low, lowBytes) }
  };
}
