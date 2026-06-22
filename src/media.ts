// src/media.ts

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileKind } from "./types.js";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".bmp"]);
export const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"]);
export const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".m4a", ".wma"]);

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
			return bufferFromBase64(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
			);
		case ".jpg":
		case ".jpeg":
			return bufferFromBase64(
				"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QH//Z",
			);
		case ".webp":
			return bufferFromBase64("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
		case ".gif":
			return bufferFromBase64("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
		case ".svg":
			return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`, "utf8");
		case ".bmp":
			return createBmpPlaceholder();
		default:
			throw new Error(`Unsupported image placeholder extension: ${extension}`);
	}
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
			throw new Error(`Unsupported audio placeholder extension: ${extension}`);
	}
}

async function createTempDir(): Promise<string> {
	return fs.promises.mkdtemp(path.join(os.tmpdir(), "zip-it-media-"));
}

function getTempMediaPath(tempDir: string, relativePath: string, extension: string): string {
	const hash = crypto.createHash("sha1").update(relativePath).digest("hex").slice(0, 12);
	return path.join(tempDir, `placeholder-${hash}${extension}`);
}

function bufferFromBase64(value: string): Buffer {
	return Buffer.from(value.replace(/\s+/g, ""), "base64");
}

function createBmpPlaceholder(): Buffer {
	return Buffer.from([
		0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00,
		0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00,
		0x00, 0x00, 0x13, 0x0b, 0x00, 0x00, 0x13, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x00,
	]);
}
