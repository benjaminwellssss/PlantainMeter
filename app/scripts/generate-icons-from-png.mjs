import sharp from "sharp";
import pngToIco from "png-to-ico";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, "../src-tauri/icons");
const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node generate-icons-from-png.mjs <source.png>");
  process.exit(1);
}

const sourceBuffer = await sharp(sourcePath).png().toBuffer();
const sizes = [16, 32, 48, 64, 128, 256];

const pngBuffers = await Promise.all(
  sizes.map((size) => sharp(sourceBuffer).resize(size, size).png().toBuffer())
);

const ico32 = await pngToIco([pngBuffers[1]]);
writeFileSync(resolve(iconsDir, "32x32.ico"), ico32);

const mainIco = await pngToIco(pngBuffers);
writeFileSync(resolve(iconsDir, "icon.ico"), mainIco);

writeFileSync(resolve(iconsDir, "icon.png"), pngBuffers[5]);

console.log("Generated: icon.ico, 32x32.ico, icon.png from", sourcePath);
