// src/media.ts

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { FileKind } from "./types.js";

export const IMAGE_EXTENSIONS = new Set([
	".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".apng", ".webp", ".gif", ".svg",
	".bmp", ".dib", ".tif", ".tiff", ".tga", ".ico", ".cur", ".qoi",
]);
export const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"]);
export const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".m4a", ".wma"]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SHAPE_PLACEHOLDER_RAW_BYTES = 64 * 1024 * 1024;
const MAX_JPEG_DIMENSION = 65_535;
const MAX_GIF_DIMENSION = 65_535;
const MAX_WEBP_DIMENSION = 16_384;
const MAX_ICON_DIMENSION = 256;
const MAX_TGA_DIMENSION = 65_535;
const MAX_QOI_DIMENSION = 0xffff_ffff;

// A valid, single-color, lossless 1x1 VP8L image. Its entropy stream contains
// zero-bit single-symbol Huffman codes, so it represents any canvas size once
// the dimensions in the VP8L header are updated. No native encoder is needed.
const BLACK_WEBP_1X1 = Buffer.from("UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==", "base64");

type ImageDimensions = Readonly<{
	width: number;
	height: number;
}>;

export type ShapePreservingImagePlaceholderResult = Readonly<{
	buffer: Buffer;
	dimensions: ImageDimensions;
}>;

export function getFileKind(relativePath: string): FileKind {
	const extension = path.extname(relativePath).toLowerCase();

	if (IMAGE_EXTENSIONS.has(extension)) {
		return "image";
	}

	if (VIDEO_EXTENSIONS.has(extension)) {
		return "video";
	}

	if (AUDIO_EXTENSIONS.has(extension)) {
		return "audio";
	}

	return "normal";
}

export function createImagePlaceholder(relativePath: string): Buffer {
	const extension = path.extname(relativePath).toLowerCase();

	switch (extension) {
		case ".png":
		case ".apng":
			return bufferFromBase64(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
			);
		case ".jpg":
		case ".jpeg":
		case ".jpe":
		case ".jfif":
			return bufferFromBase64(
				"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QH//Z",
			);
		case ".webp":
			return createWebpPlaceholder({ width: 1, height: 1 }) ?? failToCreatePlaceholder(extension);
		case ".gif":
			return bufferFromBase64("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
		case ".svg":
			return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`, "utf8");
		case ".bmp":
			return createBmpPlaceholder({ width: 1, height: 1 }) ?? failToCreatePlaceholder(extension);
		case ".dib":
			return createDibPlaceholder({ width: 1, height: 1 }) ?? failToCreatePlaceholder(extension);
		case ".tif":
		case ".tiff":
			return createTiffPlaceholder({ width: 1, height: 1 }) ?? failToCreatePlaceholder(extension);
		case ".tga":
			return createTgaPlaceholder({ width: 1, height: 1 }) ?? failToCreatePlaceholder(extension);
		case ".ico":
		case ".cur":
			return createIconPlaceholder(extension, [{ dimensions: { width: 1, height: 1 }, hotspotX: 0, hotspotY: 0 }])
				?? failToCreatePlaceholder(extension);
		case ".qoi":
			return createQoiPlaceholder({ width: 1, height: 1 }) ?? failToCreatePlaceholder(extension);
		default:
			throw new Error(`Unsupported image placeholder extension: ${extension}`);
	}
}

export async function createShapePreservingImagePlaceholder(
	relativePath: string,
	fullPath: string,
): Promise<ShapePreservingImagePlaceholderResult | null> {
	const extension = path.extname(relativePath).toLowerCase();
	const source = await fs.promises.readFile(fullPath);
	// ICO/CUR are collections of differently sized images; preserve all entries,
	// not just the largest canvas, so clients can still select the same size.
	if (extension === ".ico" || extension === ".cur") {
		const icons = readIconEntries(source, extension);
		if (!icons) return null;
		const buffer = createIconPlaceholder(extension, icons);
		if (!buffer) return null;
		const dimensions = icons.reduce((largest, icon) =>
			icon.dimensions.width * icon.dimensions.height > largest.width * largest.height ? icon.dimensions : largest,
			icons[0].dimensions,
		);
		return { buffer, dimensions };
	}

	const dimensions = readImageDimensions(extension, source);

	if (!dimensions) {
		return null;
	}

	const buffer = createImagePlaceholderForDimensions(extension, dimensions);

	if (!buffer) {
		return null;
	}

	return { buffer, dimensions };
}

export async function isFfmpegAvailable(): Promise<boolean> {
	const result = await runProcess("ffmpeg", ["-version"]);
	return result.exitCode === 0;
}

export async function createVideoPlaceholder(relativePath: string): Promise<Buffer | null> {
	const extension = path.extname(relativePath).toLowerCase();
	const tempDir = await createTempDir();

	try {
		const outputPath = getTempMediaPath(tempDir, relativePath, extension);
		const args = [
			"-y",
			"-f",
			"lavfi",
			"-i",
			"color=c=black:s=2x2:r=1",
			"-t",
			"0.04",
			"-an",
			"-pix_fmt",
			"yuv420p",
			...getVideoCodecArgs(extension),
			...getVideoFormatArgs(extension),
			outputPath,
		];

		const result = await runProcess("ffmpeg", args);

		if (result.exitCode !== 0) {
			return null;
		}

		return fs.promises.readFile(outputPath);
	} finally {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	}
}

export async function createAudioPlaceholder(relativePath: string): Promise<Buffer | null> {
	const extension = path.extname(relativePath).toLowerCase();
	const tempDir = await createTempDir();

	try {
		const outputPath = getTempMediaPath(tempDir, relativePath, extension);
		const args = [
			"-y",
			"-f",
			"lavfi",
			"-i",
			"anullsrc=channel_layout=mono:sample_rate=8000",
			"-t",
			"0.05",
			...getAudioCodecArgs(extension),
			outputPath,
		];

		const result = await runProcess("ffmpeg", args);

		if (result.exitCode !== 0) {
			return null;
		}

		return fs.promises.readFile(outputPath);
	} finally {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	}
}

function createImagePlaceholderForDimensions(extension: string, dimensions: ImageDimensions): Buffer | null {
	if (!isValidDimensionPair(dimensions)) {
		return null;
	}

	switch (extension) {
		case ".png":
		case ".apng":
			return createPngPlaceholder(dimensions);
		case ".jpg":
		case ".jpeg":
		case ".jpe":
		case ".jfif":
			return createJpegPlaceholder(dimensions);
		case ".gif":
			return createGifPlaceholder(dimensions);
		case ".svg":
			return createSvgPlaceholder(dimensions);
		case ".bmp":
			return createBmpPlaceholder(dimensions);
		case ".dib":
			return createDibPlaceholder(dimensions);
		case ".webp":
			return createWebpPlaceholder(dimensions);
		case ".tif":
		case ".tiff":
			return createTiffPlaceholder(dimensions);
		case ".tga":
			return createTgaPlaceholder(dimensions);
		case ".qoi":
			return createQoiPlaceholder(dimensions);
		default:
			return null;
	}
}

function readImageDimensions(extension: string, buffer: Buffer): ImageDimensions | null {
	switch (extension) {
		case ".png":
		case ".apng":
			return readPngDimensions(buffer);
		case ".jpg":
		case ".jpeg":
		case ".jpe":
		case ".jfif":
			return readJpegDimensions(buffer);
		case ".gif":
			return readGifDimensions(buffer);
		case ".bmp":
			return readBmpDimensions(buffer);
		case ".dib":
			return readDibDimensions(buffer);
		case ".svg":
			return readSvgDimensions(buffer.toString("utf8"));
		case ".webp":
			return readWebpDimensions(buffer);
		case ".tif":
		case ".tiff":
			return readTiffDimensions(buffer);
		case ".tga":
			return readTgaDimensions(buffer);
		case ".qoi":
			return readQoiDimensions(buffer);
		default:
			return null;
	}
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
		return null;
	}

	return normalizeDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
		return null;
	}

	let offset = 2;

	while (offset < buffer.length) {
		while (offset < buffer.length && buffer[offset] === 0xff) {
			offset++;
		}

		if (offset >= buffer.length) {
			return null;
		}

		const marker = buffer[offset++];

		if (marker === 0xd9 || marker === 0xda) {
			return null;
		}

		if (isStandaloneJpegMarker(marker)) {
			continue;
		}

		if (offset + 2 > buffer.length) {
			return null;
		}

		const segmentLength = buffer.readUInt16BE(offset);
		const segmentStart = offset + 2;
		const nextOffset = offset + segmentLength;

		if (segmentLength < 2 || nextOffset > buffer.length) {
			return null;
		}

		if (isJpegStartOfFrameMarker(marker)) {
			if (segmentStart + 5 > buffer.length) {
				return null;
			}

			return normalizeDimensions(buffer.readUInt16BE(segmentStart + 3), buffer.readUInt16BE(segmentStart + 1));
		}

		offset = nextOffset;
	}

	return null;
}

function readGifDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 10) {
		return null;
	}

	const header = buffer.toString("ascii", 0, 6);

	if (header !== "GIF87a" && header !== "GIF89a") {
		return null;
	}

	return normalizeDimensions(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
}

function readBmpDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 26 || buffer.toString("ascii", 0, 2) !== "BM") {
		return null;
	}

	const dibHeaderSize = buffer.readUInt32LE(14);

	if (dibHeaderSize === 12) {
		if (buffer.length < 26) {
			return null;
		}

		return normalizeDimensions(buffer.readUInt16LE(18), buffer.readUInt16LE(20));
	}

	if (dibHeaderSize < 40 || buffer.length < 26) {
		return null;
	}

	return normalizeDimensions(buffer.readInt32LE(18), Math.abs(buffer.readInt32LE(22)));
}

function readSvgDimensions(source: string): ImageDimensions | null {
	const svgTag = source.match(/<svg\b[^>]*>/i)?.[0];

	if (!svgTag) {
		return null;
	}

	const width = readSvgLengthAttribute(svgTag, "width");
	const height = readSvgLengthAttribute(svgTag, "height");

	if (width && height) {
		return normalizeDimensions(width, height);
	}

	const viewBox = svgTag.match(/\bviewBox\s*=\s*(["'])(.*?)\1/i)?.[2];

	if (!viewBox) {
		return null;
	}

	const parts = viewBox
		.trim()
		.split(/[\s,]+/)
		.map(Number);

	if (parts.length !== 4) {
		return null;
	}

	return normalizeDimensions(parts[2], parts[3]);
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 25 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
		return null;
	}

	const riffSize = buffer.readUInt32LE(4);
	const chunkSize = buffer.readUInt32LE(16);
	if (riffSize < 12 || riffSize + 8 > buffer.length || chunkSize > riffSize - 12 || chunkSize > buffer.length - 20) {
		return null;
	}

	const chunkType = buffer.toString("ascii", 12, 16);
	if (chunkType === "VP8X" && chunkSize >= 10) {
		return normalizeDimensions(readUInt24LE(buffer, 24) + 1, readUInt24LE(buffer, 27) + 1);
	}

	if (chunkType === "VP8 " && chunkSize >= 10 && buffer.length >= 30 &&
		buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
		return normalizeDimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
	}

	if (chunkType === "VP8L" && chunkSize >= 5 && buffer[20] === 0x2f) {
		const bits = buffer.readUInt32LE(21);
		return normalizeDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}

	return null;
}

function createWebpPlaceholder(dimensions: ImageDimensions): Buffer | null {
	if (dimensions.width > MAX_WEBP_DIMENSION || dimensions.height > MAX_WEBP_DIMENSION) return null;

	// VP8L stores (width - 1) and (height - 1) as two 14-bit values.
	// The constant-color entropy stream in this template requires no changes.
	const buffer = Buffer.from(BLACK_WEBP_1X1);
	const canvas = ((dimensions.height - 1) << 14) | (dimensions.width - 1);
	buffer.writeUInt32LE(canvas >>> 0, 21);
	return buffer;
}

function readDibDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 40 || buffer.readUInt32LE(0) < 40) return null;
	return normalizeDimensions(buffer.readInt32LE(4), Math.abs(buffer.readInt32LE(8)));
}

function createDibPlaceholder(dimensions: ImageDimensions): Buffer | null {
	const bmp = createBmpPlaceholder(dimensions);
	return bmp?.subarray(14) ?? null;
}

function readTgaDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 18) return null;
	// Supported TGA image types: indexed, truecolor and grayscale (raw or RLE).
	if (![1, 2, 3, 9, 10, 11].includes(buffer[2])) return null;
	if (![8, 15, 16, 24, 32].includes(buffer[16])) return null;
	return normalizeDimensions(buffer.readUInt16LE(12), buffer.readUInt16LE(14));
}

function createTgaPlaceholder(dimensions: ImageDimensions): Buffer | null {
	if (dimensions.width > MAX_TGA_DIMENSION || dimensions.height > MAX_TGA_DIMENSION) return null;
	// Packets must not span scan lines; some otherwise-valid RLE TGA files
	// cannot be read by decoders that decompress one row at a time.
	const packetsPerRow = Math.ceil(dimensions.width / 128);
	const packets = packetsPerRow * dimensions.height;
	if (packets * 4 > MAX_SHAPE_PLACEHOLDER_RAW_BYTES) return null;
	const buffer = Buffer.alloc(18 + packets * 4);
	buffer[2] = 10; // RLE-encoded truecolor
	buffer.writeUInt16LE(dimensions.width, 12);
	buffer.writeUInt16LE(dimensions.height, 14);
	buffer[16] = 24;
	buffer[17] = 0x20; // top-left origin
	let offset = 18;
	for (let row = 0; row < dimensions.height; row++) {
		for (let remaining = dimensions.width; remaining > 0; offset += 4) {
			const count = Math.min(remaining, 128);
			buffer[offset] = 0x80 | (count - 1);
			remaining -= count;
		}
	}
	return buffer;
}

function readQoiDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 22 || buffer.toString("ascii", 0, 4) !== "qoif") return null;
	if (buffer[12] !== 3 && buffer[12] !== 4) return null;
	return normalizeDimensions(buffer.readUInt32BE(4), buffer.readUInt32BE(8));
}

function createQoiPlaceholder(dimensions: ImageDimensions): Buffer | null {
	if (dimensions.width > MAX_QOI_DIMENSION || dimensions.height > MAX_QOI_DIMENSION) return null;
	const pixels = dimensions.width * dimensions.height;
	const packets = Math.ceil(pixels / 62);
	if (!Number.isSafeInteger(pixels) || packets > MAX_SHAPE_PLACEHOLDER_RAW_BYTES) return null;
	const buffer = Buffer.alloc(14 + packets + 8);
	buffer.write("qoif", 0, "ascii");
	buffer.writeUInt32BE(dimensions.width, 4);
	buffer.writeUInt32BE(dimensions.height, 8);
	buffer[12] = 4;
	buffer[13] = 0;
	// The initial decoder pixel is opaque black: runs alone encode the image.
	for (let i = 0, remaining = pixels; i < packets; i++) {
		const count = Math.min(remaining, 62);
		buffer[14 + i] = 0xc0 | (count - 1);
		remaining -= count;
	}
	buffer[buffer.length - 1] = 1; // QOI end marker
	return buffer;
}

function readTiffDimensions(buffer: Buffer): ImageDimensions | null {
	if (buffer.length < 8) return null;
	const byteOrder = buffer.toString("ascii", 0, 2);
	if (byteOrder !== "II" && byteOrder !== "MM") return null;
	const littleEndian = byteOrder === "II";
	const u16 = (at: number) => littleEndian ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at);
	const u32 = (at: number) => littleEndian ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at);
	if (u16(2) !== 42) return null; // Classic TIFF, not BigTIFF.
	const ifd = u32(4);
	if (ifd > buffer.length - 2) return null;
	const count = u16(ifd);
	if (count > Math.floor((buffer.length - ifd - 2) / 12)) return null;
	let width: number | undefined;
	let height: number | undefined;
	for (let i = 0; i < count; i++) {
		const at = ifd + 2 + i * 12;
		const tag = u16(at);
		if (tag !== 256 && tag !== 257) continue;
		const type = u16(at + 2);
		if (u32(at + 4) !== 1 || (type !== 3 && type !== 4)) return null;
		const value = type === 3 ? u16(at + 8) : u32(at + 8);
		if (tag === 256) width = value;
		else height = value;
	}
	return width !== undefined && height !== undefined ? normalizeDimensions(width, height) : null;
}

function createTiffPlaceholder(dimensions: ImageDimensions): Buffer | null {
	const rowBytes = Math.ceil(dimensions.width / 8);
	const rawBytes = rowBytes * dimensions.height;
	if (rawBytes > MAX_SHAPE_PLACEHOLDER_RAW_BYTES) return null;
	const image = zlib.deflateSync(Buffer.alloc(rawBytes), { level: 9 });
	const tagCount = 10;
	const imageOffset = 8 + 2 + tagCount * 12 + 4;
	const buffer = Buffer.alloc(imageOffset + image.length);
	buffer.write("II", 0, "ascii");
	buffer.writeUInt16LE(42, 2);
	buffer.writeUInt32LE(8, 4);
	buffer.writeUInt16LE(tagCount, 8);
	const tags: readonly (readonly [number, number, number])[] = [
		[256, 4, dimensions.width], // ImageWidth (LONG)
		[257, 4, dimensions.height], // ImageLength (LONG)
		[258, 3, 1], // BitsPerSample (SHORT)
		[259, 3, 8], // Compression: Adobe Deflate
		[262, 3, 1], // PhotometricInterpretation: BlackIsZero
		[273, 4, imageOffset], // StripOffsets
		[277, 3, 1], // SamplesPerPixel
		[278, 4, dimensions.height], // RowsPerStrip
		[279, 4, image.length], // StripByteCounts
		[284, 3, 1], // PlanarConfiguration
	];
	for (let i = 0; i < tags.length; i++) {
		const [tag, type, value] = tags[i];
		const at = 10 + i * 12;
		buffer.writeUInt16LE(tag, at);
		buffer.writeUInt16LE(type, at + 2);
		buffer.writeUInt32LE(1, at + 4);
		if (type === 3) buffer.writeUInt16LE(value, at + 8);
		else buffer.writeUInt32LE(value, at + 8);
	}
	buffer.writeUInt32LE(0, 10 + tagCount * 12);
	image.copy(buffer, imageOffset);
	return buffer;
}

type IconEntry = Readonly<{ dimensions: ImageDimensions; hotspotX: number; hotspotY: number }>;

function readIconEntries(buffer: Buffer, extension: ".ico" | ".cur"): readonly IconEntry[] | null {
	if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0) return null;
	if (buffer.readUInt16LE(2) !== (extension === ".ico" ? 1 : 2)) return null;
	const count = buffer.readUInt16LE(4);
	if (count === 0 || count > 256 || buffer.length < 6 + count * 16) return null;
	const entries: IconEntry[] = [];
	for (let i = 0; i < count; i++) {
		const at = 6 + i * 16;
		const dimensions = { width: buffer[at] || 256, height: buffer[at + 1] || 256 };
		const size = buffer.readUInt32LE(at + 8);
		const start = buffer.readUInt32LE(at + 12);
		if (size < 1 || start > buffer.length || size > buffer.length - start) return null;
		entries.push({
			dimensions,
			hotspotX: extension === ".cur" ? buffer.readUInt16LE(at + 4) : 0,
			hotspotY: extension === ".cur" ? buffer.readUInt16LE(at + 6) : 0,
		});
	}
	return entries;
}

function createIconPlaceholder(extension: ".ico" | ".cur", entries: readonly IconEntry[]): Buffer | null {
	if (entries.length < 1 || entries.length > 256) return null;
	const frames: Buffer[] = [];
	let total = 6 + entries.length * 16;
	for (const entry of entries) {
		const { width, height } = entry.dimensions;
		if (!isValidDimensionPair(entry.dimensions) || width > MAX_ICON_DIMENSION || height > MAX_ICON_DIMENSION) return null;
		const png = createPngPlaceholder(entry.dimensions);
		if (!png) return null;
		frames.push(png);
		total += png.length;
		if (total > MAX_SHAPE_PLACEHOLDER_RAW_BYTES) return null;
	}
	const buffer = Buffer.alloc(total);
	buffer.writeUInt16LE(extension === ".ico" ? 1 : 2, 2);
	buffer.writeUInt16LE(entries.length, 4);
	let offset = 6 + entries.length * 16;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const at = 6 + i * 16;
		buffer[at] = entry.dimensions.width === 256 ? 0 : entry.dimensions.width;
		buffer[at + 1] = entry.dimensions.height === 256 ? 0 : entry.dimensions.height;
		if (extension === ".ico") {
			buffer.writeUInt16LE(1, at + 4); // planes
			buffer.writeUInt16LE(1, at + 6); // bits per pixel
		} else {
			buffer.writeUInt16LE(entry.hotspotX, at + 4);
			buffer.writeUInt16LE(entry.hotspotY, at + 6);
		}
		buffer.writeUInt32LE(frames[i].length, at + 8);
		buffer.writeUInt32LE(offset, at + 12);
		frames[i].copy(buffer, offset);
		offset += frames[i].length;
	}
	return buffer;
}

function createPngPlaceholder(dimensions: ImageDimensions): Buffer | null {
	const rowBytes = Math.ceil(dimensions.width / 8);
	const rawBytes = (rowBytes + 1) * dimensions.height;

	if (rawBytes > MAX_SHAPE_PLACEHOLDER_RAW_BYTES) {
		return null;
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(dimensions.width, 0);
	ihdr.writeUInt32BE(dimensions.height, 4);
	ihdr[8] = 1;
	ihdr[9] = 0;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const raw = Buffer.alloc(rawBytes);

	for (let offset = 0; offset < raw.length; offset += rowBytes + 1) {
		raw[offset] = 0;
	}

	const idat = zlib.deflateSync(raw, { level: 9 });

	return Buffer.concat([
		PNG_SIGNATURE,
		createPngChunk("IHDR", ihdr),
		createPngChunk("IDAT", idat),
		createPngChunk("IEND", Buffer.alloc(0)),
	]);
}

function createJpegPlaceholder(dimensions: ImageDimensions): Buffer | null {
	if (dimensions.width > MAX_JPEG_DIMENSION || dimensions.height > MAX_JPEG_DIMENSION) {
		return null;
	}

	const quantizationTable = Buffer.from([0, ...Array.from({ length: 64 }, () => 1)]);
	const startOfFrame = Buffer.from([
		8,
		(dimensions.height >> 8) & 0xff,
		dimensions.height & 0xff,
		(dimensions.width >> 8) & 0xff,
		dimensions.width & 0xff,
		1,
		1,
		0x11,
		0,
	]);
	const dcHuffmanTable = Buffer.from([0x00, 0x01, ...Array.from({ length: 15 }, () => 0x00), 0x00]);
	const acHuffmanTable = Buffer.from([0x10, 0x01, ...Array.from({ length: 15 }, () => 0x00), 0x00]);
	const startOfScan = Buffer.from([1, 1, 0x00, 0, 63, 0]);
	const scanData = createEmptyJpegScanData(dimensions);

	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		createJpegSegment(
			0xe0,
			Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0, 0]),
		),
		createJpegSegment(0xdb, quantizationTable),
		createJpegSegment(0xc0, startOfFrame),
		createJpegSegment(0xc4, dcHuffmanTable),
		createJpegSegment(0xc4, acHuffmanTable),
		createJpegSegment(0xda, startOfScan),
		scanData,
		Buffer.from([0xff, 0xd9]),
	]);
}

function createGifPlaceholder(dimensions: ImageDimensions): Buffer | null {
	if (dimensions.width > MAX_GIF_DIMENSION || dimensions.height > MAX_GIF_DIMENSION) {
		return null;
	}

	const header = Buffer.from("GIF89a", "ascii");
	const logicalScreen = Buffer.alloc(7);
	logicalScreen.writeUInt16LE(dimensions.width, 0);
	logicalScreen.writeUInt16LE(dimensions.height, 2);
	logicalScreen[4] = 0x80;
	logicalScreen[5] = 0;
	logicalScreen[6] = 0;

	const globalColorTable = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff, 0xff]);
	const imageData = Buffer.from([
		0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
	]);

	return Buffer.concat([header, logicalScreen, globalColorTable, imageData]);
}

function createSvgPlaceholder(dimensions: ImageDimensions): Buffer {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}"></svg>`,
		"utf8",
	);
}

function createBmpPlaceholder(dimensions: ImageDimensions): Buffer | null {
	const rowSize = Math.ceil(dimensions.width / 32) * 4;
	const pixelArraySize = rowSize * dimensions.height;

	if (pixelArraySize > MAX_SHAPE_PLACEHOLDER_RAW_BYTES) {
		return null;
	}

	const headerSize = 14;
	const dibHeaderSize = 40;
	const paletteSize = 8;
	const pixelOffset = headerSize + dibHeaderSize + paletteSize;
	const fileSize = pixelOffset + pixelArraySize;
	const buffer = Buffer.alloc(fileSize);

	buffer.write("BM", 0, "ascii");
	buffer.writeUInt32LE(fileSize, 2);
	buffer.writeUInt32LE(pixelOffset, 10);
	buffer.writeUInt32LE(dibHeaderSize, 14);
	buffer.writeInt32LE(dimensions.width, 18);
	buffer.writeInt32LE(dimensions.height, 22);
	buffer.writeUInt16LE(1, 26);
	buffer.writeUInt16LE(1, 28);
	buffer.writeUInt32LE(0, 30);
	buffer.writeUInt32LE(pixelArraySize, 34);
	buffer.writeInt32LE(2835, 38);
	buffer.writeInt32LE(2835, 42);
	buffer.writeUInt32LE(2, 46);
	buffer.writeUInt32LE(2, 50);
	buffer.writeUInt32LE(0x00000000, 54);
	buffer.writeUInt32LE(0x00ffffff, 58);

	return buffer;
}

function createPngChunk(type: string, data: Buffer): Buffer {
	const typeBuffer = Buffer.from(type, "ascii");
	const chunk = Buffer.alloc(12 + data.length);
	chunk.writeUInt32BE(data.length, 0);
	typeBuffer.copy(chunk, 4);
	data.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);

	return chunk;
}

function createJpegSegment(marker: number, data: Buffer): Buffer {
	const segment = Buffer.alloc(data.length + 4);
	segment[0] = 0xff;
	segment[1] = marker;
	segment.writeUInt16BE(data.length + 2, 2);
	data.copy(segment, 4);

	return segment;
}

function createEmptyJpegScanData(dimensions: ImageDimensions): Buffer {
	const blocks = Math.ceil(dimensions.width / 8) * Math.ceil(dimensions.height / 8);
	const writer = new JpegBitWriter();

	for (let index = 0; index < blocks; index++) {
		writer.writeBit(0);
		writer.writeBit(0);
	}

	return writer.finish();
}

class JpegBitWriter {
	private currentByte = 0;
	private bitCount = 0;
	private readonly bytes: number[] = [];

	writeBit(bit: 0 | 1): void {
		this.currentByte = (this.currentByte << 1) | bit;
		this.bitCount++;

		if (this.bitCount === 8) {
			this.pushByte(this.currentByte);
			this.currentByte = 0;
			this.bitCount = 0;
		}
	}

	finish(): Buffer {
		if (this.bitCount > 0) {
			this.currentByte = (this.currentByte << (8 - this.bitCount)) | ((1 << (8 - this.bitCount)) - 1);
			this.pushByte(this.currentByte);
			this.currentByte = 0;
			this.bitCount = 0;
		}

		return Buffer.from(this.bytes);
	}

	private pushByte(byte: number): void {
		this.bytes.push(byte);

		if (byte === 0xff) {
			this.bytes.push(0x00);
		}
	}
}

function crc32(buffer: Buffer): number {
	let crc = 0xffffffff;

	for (const byte of buffer) {
		crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): readonly number[] {
	const table: number[] = [];

	for (let index = 0; index < 256; index++) {
		let value = index;

		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}

		table.push(value >>> 0);
	}

	return table;
}

function isStandaloneJpegMarker(marker: number): boolean {
	return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function isJpegStartOfFrameMarker(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function readSvgLengthAttribute(svgTag: string, attributeName: string): number | null {
	const value = svgTag.match(new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2]?.trim();

	if (!value || value.endsWith("%")) {
		return null;
	}

	const match = value.match(/^([+-]?(?:\d+\.?\d*|\.\d+))/);

	if (!match) {
		return null;
	}

	const parsed = Number(match[1]);

	return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDimensions(width: number, height: number): ImageDimensions | null {
	const normalized = {
		width: Math.round(Math.abs(width)),
		height: Math.round(Math.abs(height)),
	};

	return isValidDimensionPair(normalized) ? normalized : null;
}

function isValidDimensionPair(dimensions: ImageDimensions): boolean {
	return (
		Number.isSafeInteger(dimensions.width) &&
		Number.isSafeInteger(dimensions.height) &&
		dimensions.width > 0 &&
		dimensions.height > 0
	);
}

function readUInt24LE(buffer: Buffer, offset: number): number {
	return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function runProcess(command: string, args: readonly string[]): Promise<{ exitCode: number; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});

		let stderr = "";

		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});

		child.on("error", () => {
			resolve({ exitCode: -1, stderr });
		});

		child.on("close", (exitCode) => {
			resolve({ exitCode: exitCode ?? -1, stderr });
		});
	});
}

function getVideoCodecArgs(extension: string): string[] {
	switch (extension) {
		case ".webm":
			return ["-c:v", "libvpx-vp9", "-b:v", "1k"];
		case ".mp4":
		case ".m4v":
		case ".mov":
		case ".mkv":
			return ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "51"];
		case ".avi":
			return ["-c:v", "mpeg4", "-q:v", "31"];
		default:
			throw new Error(`Unsupported video codec extension: ${extension}`);
	}
}

function getVideoFormatArgs(extension: string): string[] {
	switch (extension) {
		case ".mp4":
		case ".m4v":
		case ".mov":
			return ["-f", "mp4", "-movflags", "+faststart"];
		case ".webm":
			return ["-f", "webm"];
		case ".mkv":
			return ["-f", "matroska"];
		case ".avi":
			return ["-f", "avi"];
		default:
			throw new Error(`Unsupported video placeholder extension: ${extension}`);
	}
}

function getAudioCodecArgs(extension: string): string[] {
	switch (extension) {
		case ".wav":
			return ["-c:a", "pcm_s16le"];
		case ".mp3":
			return ["-c:a", "libmp3lame", "-b:a", "8k"];
		case ".ogg":
			return ["-c:a", "libvorbis", "-b:a", "8k"];
		case ".flac":
			return ["-c:a", "flac"];
		case ".m4a":
			return ["-c:a", "aac", "-b:a", "8k"];
		case ".wma":
			return ["-c:a", "wmav2", "-b:a", "8k"];
		default:
			throw new Error(`Unsupported audio codec extension: ${extension}`);
	}
}

async function createTempDir(): Promise<string> {
	return fs.promises.mkdtemp(path.join(os.tmpdir(), "zip-it-media-"));
}

function getTempMediaPath(tempDir: string, relativePath: string, extension: string): string {
	const hash = crypto.createHash("sha1").update(relativePath).digest("hex").slice(0, 12);
	return path.join(tempDir, `placeholder-${hash}${extension}`);
}

function failToCreatePlaceholder(extension: string): never {
	throw new Error(`Could not create image placeholder for extension: ${extension}`);
}

function bufferFromBase64(value: string): Buffer {
	return Buffer.from(value.replace(/\s+/g, ""), "base64");
}
