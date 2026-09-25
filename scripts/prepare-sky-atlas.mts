import { fromFile, writeArrayBuffer } from "geotiff";
import { writeFile, readFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const [input, output, ...bounds] = process.argv.slice(2);
const bbox = bounds.map(Number);
if (
  !input ||
  !output ||
  bbox.length !== 4 ||
  !bbox.every(Number.isFinite) ||
  bbox[0]! < -180 ||
  bbox[2]! > 180 ||
  bbox[1]! < -90 ||
  bbox[3]! > 90 ||
  bbox[0]! >= bbox[2]! ||
  bbox[1]! >= bbox[3]!
)
  throw new Error(
    "Usage: node --import tsx scripts/prepare-sky-atlas.mts input.tif output.tif west south east north"
  );
if (resolve(input) === resolve(output))
  throw new Error("Output must not overwrite the original atlas");
try {
  await stat(output);
  throw new Error("Output already exists");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const tiff = await fromFile(input);
try {
  const image = await tiff.getImage();
  const keys = image.getGeoKeys();
  if (
    keys?.GeographicTypeGeoKey !== 4326 ||
    keys.ProjectedCSTypeGeoKey ||
    keys.GTRasterTypeGeoKey === 2 ||
    image.getSamplesPerPixel() !== 1
  )
    throw new Error("Expected original single-band WGS84 PixelIsArea atlas");
  const [x0, y0] = image.getOrigin(),
    [dx, dy] = image.getResolution();
  if (!(dx! > 0 && dy! < 0)) throw new Error("Unexpected raster orientation");
  const left = Math.max(0, Math.floor((bbox[0]! - x0!) / dx!));
  const top = Math.max(0, Math.floor((bbox[3]! - y0!) / dy!));
  const right = Math.min(image.getWidth(), Math.ceil((bbox[2]! - x0!) / dx!));
  const bottom = Math.min(image.getHeight(), Math.ceil((bbox[1]! - y0!) / dy!));
  const width = right - left,
    height = bottom - top;
  if (width <= 0 || height <= 0 || width * height > 1_000_000)
    throw new Error("Choose a covered region of at most one million pixels");
  const raster = await image.readRasters({
    window: [left, top, right, bottom],
    samples: [0],
    interleave: true
  });
  const data = Float32Array.from(raster as Float32Array);
  const noData = image.getGDALNoData();
  const bytes = new Uint8Array(
    writeArrayBuffer(data, {
      width,
      height,
      BitsPerSample: [32],
      SampleFormat: [3],
      SamplesPerPixel: 1,
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
      ModelPixelScale: [dx!, -dy!, 0],
      ModelTiepoint: [0, 0, 0, x0! + left * dx!, y0! + top * dy!, 0],
      ...(noData !== null ? { GDAL_NODATA: String(noData) } : {})
    })
  );
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  const metadata = {
    dataset: "World Atlas 2015",
    modelYear: 2015,
    unit: "mcd/m²",
    component: "artificial-zenith",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bbox: [x0! + left * dx!, y0! + bottom * dy!, x0! + right * dx!, y0! + top * dy!],
    width,
    height,
    resolutionDegrees: [dx, -dy!],
    transformation: "unscaled pixel window, Float32",
    citations: [
      "https://doi.org/10.5880/GFZ.1.4.2016.001",
      "https://doi.org/10.1126/sciadv.1600377"
    ],
    license: JSON.parse(
      await readFile(new URL("../docs/sky-atlas-license.json", import.meta.url), "utf8")
    )
  };
  await writeFile(`${output}.json`, JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({ output, bytes: bytes.length, ...metadata, license: "CC BY-NC 4.0" }, null, 2)
  );
} finally {
  await tiff.close();
}
