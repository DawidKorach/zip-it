import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createImagePlaceholder, createShapePreservingImagePlaceholder, getFileKind } from "../dist/media.js";

async function roundTrip(extension, buffer) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zip-it-images-test-"));
	const file = path.join(dir, `source${extension}`);
	try {
		await fs.writeFile(file, buffer);
		return await createShapePreservingImagePlaceholder(`Content/source${extension}`, file);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

// Both modes must use an actual image in the original format, not merely a
// modified filename. Each format's stream is checked by decoding utilities in
// addition to these metadata/round-trip tests.
test("recognizes additional image extensions and creates tiny placeholders", () => {
	for (const extension of [".webp", ".jpe", ".jfif", ".apng", ".dib", ".tif", ".tiff", ".tga", ".ico", ".cur", ".qoi"]) {
		assert.equal(getFileKind(`assets/IMAGE${extension.toUpperCase()}`), "image", extension);
		assert(createImagePlaceholder(`assets/a${extension}`).length > 0, extension);
	}
	assert.equal(getFileKind("Content/texture.dds"), "normal"); // never fake a DDS texture
});

test("WebP lossless placeholder preserves arbitrary canvas dimensions without native tools", async () => {
	const source = Buffer.from(createImagePlaceholder("sample.webp"));
	const dimensions = { width: 320, height: 180 };
	source.writeUInt32LE(((dimensions.height - 1) << 14) | (dimensions.width - 1), 21);
	const result = await roundTrip(".webp", source);
	assert(result);
	assert.deepEqual(result.dimensions, dimensions);
	assert.equal(result.buffer.length, 34);
	assert.equal(result.buffer.toString("ascii", 12, 16), "VP8L");
	assert.deepEqual(result.buffer, source); // same constant-color image is already canonical
	assert.deepEqual((await roundTrip(".webp", result.buffer)).dimensions, dimensions);
});

test("WebP canvas is validated and never emits a fake oversize lossless image", async () => {
	// VP8X supports larger sizes than VP8L; original must be kept if VP8L
	// cannot encode its dimensions.
	const source = Buffer.alloc(30);
	source.write("RIFF", 0, "ascii");
	source.writeUInt32LE(22, 4);
	source.write("WEBPVP8X", 8, "ascii");
	source.writeUInt32LE(10, 16);
	source.writeUIntLE(20_000 - 1, 24, 3);
	source.writeUIntLE(1_000 - 1, 27, 3);
	assert.equal(await roundTrip(".webp", source), null);
	assert.equal(await roundTrip(".webp", Buffer.from("not-webp")), null);
});

test("TGA, TIFF, QOI and DIB preserve shape and remain parseable", async () => {
	const cases = [
		{ extension: ".tga", mutate: (b) => { b.writeUInt16LE(320, 12); b.writeUInt16LE(180, 14); } },
		{ extension: ".tif", mutate: (b) => { b.writeUInt32LE(320, 18); b.writeUInt32LE(180, 30); } },
		{ extension: ".tiff", mutate: (b) => { b.writeUInt32LE(320, 18); b.writeUInt32LE(180, 30); } },
		{ extension: ".qoi", mutate: (b) => { b.writeUInt32BE(320, 4); b.writeUInt32BE(180, 8); } },
		{ extension: ".dib", mutate: (b) => { b.writeInt32LE(320, 4); b.writeInt32LE(180, 8); } },
	];
	for (const { extension, mutate } of cases) {
		const source = Buffer.from(createImagePlaceholder(`test${extension}`));
		mutate(source);
		const result = await roundTrip(extension, source);
		assert(result, `${extension}: missing placeholder`);
		assert.deepEqual(result.dimensions, { width: 320, height: 180 }, extension);
		assert.deepEqual((await roundTrip(extension, result.buffer)).dimensions, result.dimensions, extension);
		assert(result.buffer.length < 10_000, extension);
	}
});

test("ICO and CUR preserve frame sizes/count and cursor hotspots", async () => {
	for (const extension of [".ico", ".cur"]) {
		const png = createImagePlaceholder("icon.png");
		const input = Buffer.alloc(6 + 2 * 16 + png.length * 2);
		input.writeUInt16LE(extension === ".ico" ? 1 : 2, 2);
		input.writeUInt16LE(2, 4);
		for (const [i, size] of [16, 32].entries()) {
			const at = 6 + 16 * i;
			input[at] = size;
			input[at + 1] = size;
			if (extension === ".cur") {
				input.writeUInt16LE(i + 2, at + 4);
				input.writeUInt16LE(i + 3, at + 6);
			}
			input.writeUInt32LE(png.length, at + 8);
			input.writeUInt32LE(38 + png.length * i, at + 12);
			png.copy(input, 38 + png.length * i);
		}
		const result = await roundTrip(extension, input);
		assert(result);
		assert.deepEqual(result.dimensions, { width: 32, height: 32 });
		assert.equal(result.buffer.readUInt16LE(4), 2);
		assert.equal(result.buffer[6], 16);
		assert.equal(result.buffer[22], 32);
		for (let i = 0; i < 2; i++) {
			const at = 6 + 16 * i;
			const pngOffset = result.buffer.readUInt32LE(at + 12);
			assert.equal(result.buffer.toString("ascii", pngOffset + 12, pngOffset + 16), "IHDR");
			assert.equal(result.buffer.readUInt32BE(pngOffset + 16), [16, 32][i]);
			assert.equal(result.buffer.readUInt32BE(pngOffset + 20), [16, 32][i]);
		}
		if (extension === ".cur") {
			assert.equal(result.buffer.readUInt16LE(10), 2);
			assert.equal(result.buffer.readUInt16LE(28), 4);
		}
		assert.deepEqual((await roundTrip(extension, result.buffer)).dimensions, result.dimensions);
	}
});

test("TGA placeholder RLE packets stay within individual image rows", async () => {
	const source = Buffer.from(createImagePlaceholder("source.tga"));
	source.writeUInt16LE(321, 12);
	source.writeUInt16LE(181, 14);
	const result = await roundTrip(".tga", source);
	assert(result);
	const buffer = result.buffer;
	let at = 18;
	for (let row = 0; row < 181; row++) {
		let remaining = 321;
		while (remaining) {
			const packetLength = (buffer[at] & 0x7f) + 1;
			assert((buffer[at] & 0x80) !== 0);
			assert(packetLength <= remaining, `RLE packet crosses row ${row}`);
			remaining -= packetLength;
			at += 4; // packet header and one BGR triple
		}
	}
	assert.equal(at, buffer.length);
});

test("extended WebP VP8X images can be replaced with compact VP8L placeholders", async () => {
	const source = Buffer.alloc(30);
	source.write("RIFF", 0, "ascii");
	source.writeUInt32LE(22, 4);
	source.write("WEBPVP8X", 8, "ascii");
	source.writeUInt32LE(10, 16);
	source.writeUIntLE(1280 - 1, 24, 3);
	source.writeUIntLE(720 - 1, 27, 3);
	const result = await roundTrip(".webp", source);
	assert(result);
	assert.deepEqual(result.dimensions, { width: 1280, height: 720 });
	assert.equal(result.buffer.toString("ascii", 12, 16), "VP8L");
	assert.deepEqual((await roundTrip(".webp", result.buffer)).dimensions, result.dimensions);
});

test("invalid/unsupported images return null rather than silently corrupting originals", async () => {
	for (const extension of [".tif", ".tga", ".qoi", ".ico", ".cur", ".png"]) {
		assert.equal(await roundTrip(extension, Buffer.from("broken")), null, extension);
	}
});
