// src/zip.ts

import fs from "node:fs";
import path from "node:path";
import yazl from "yazl";
import {
	createAudioPlaceholder,
	createImagePlaceholder,
	createShapePreservingImagePlaceholder,
	createVideoPlaceholder,
	isFfmpegAvailable,
} from "./media.js";
import type { CliOptions, FileEntry, ZipStats } from "./types.js";

export async function ensureOutputDir(outputPath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
}

export function createInitialStats(includedFiles: number, ignoredFiles: number, ignoredDirectories: number): ZipStats {
	return {
		originalTotalSize: 0,
		zippedInputSize: 0,
		includedFiles,
		ignoredFiles,
		ignoredDirectories,
		replacedImageFiles: 0,
		preservedShapeImageFiles: 0,
		keptOriginalImageFiles: 0,
		replacedVideoFiles: 0,
		replacedAudioFiles: 0,
		keptOriginalVideoFiles: 0,
		keptOriginalAudioFiles: 0,
		warnings: [],
	};
}

export async function createZip(
	entries: readonly FileEntry[],
	options: CliOptions,
	stats: ZipStats,
): Promise<ZipStats> {
	const needsFfmpeg =
		options.media.minify &&
		entries.some(
			(entry) =>
				(entry.kind === "video" && !options.media.keepVideoOriginals) ||
				(entry.kind === "audio" && !options.media.keepAudioOriginals),
		);
	const ffmpegAvailable = needsFfmpeg ? await isFfmpegAvailable() : false;

	if (
		options.media.minify &&
		entries.some((entry) => entry.kind === "video") &&
		!options.media.keepVideoOriginals &&
		!ffmpegAvailable
	) {
		stats.warnings.push("ffmpeg not found. Video files were kept original.");
	}

	if (
		options.media.minify &&
		entries.some((entry) => entry.kind === "audio") &&
		!options.media.keepAudioOriginals &&
		!ffmpegAvailable
	) {
		stats.warnings.push("ffmpeg not found. Audio files were kept original.");
	}

	const zipfile = new yazl.ZipFile();
	const output = fs.createWriteStream(options.output);

	const completion = new Promise<void>((resolve, reject) => {
		output.on("close", resolve);
		output.on("error", reject);
		zipfile.on("error", reject);
	});

	zipfile.outputStream.pipe(output);

	for (const entry of entries) {
		await addEntry(zipfile, entry, options, stats, ffmpegAvailable);
	}

	zipfile.end();
	await completion;

	return stats;
}

async function addEntry(
	zipfile: yazl.ZipFile,
	entry: FileEntry,
	options: CliOptions,
	stats: ZipStats,
	ffmpegAvailable: boolean,
): Promise<void> {
	stats.originalTotalSize += entry.size;

	if (!options.media.minify || entry.kind === "normal") {
		addOriginalFile(zipfile, entry, stats);
		return;
	}

	if (entry.kind === "image") {
		if (options.media.mode === "preserve-shape") {
			const placeholder = await createShapePreservingImagePlaceholder(entry.relativePath, entry.fullPath);

			if (placeholder) {
				stats.zippedInputSize += placeholder.buffer.length;
				stats.replacedImageFiles++;
				stats.preservedShapeImageFiles++;
				zipfile.addBuffer(placeholder.buffer, entry.relativePath, { mtime: new Date(0) });
				return;
			}

			stats.keptOriginalImageFiles++;
			stats.warnings.push(`Could not create shape-preserving image placeholder for ${entry.relativePath}. Kept original.`);
			addOriginalFile(zipfile, entry, stats);
			return;
		}

		const placeholder = createImagePlaceholder(entry.relativePath);
		stats.zippedInputSize += placeholder.length;
		stats.replacedImageFiles++;
		zipfile.addBuffer(placeholder, entry.relativePath, { mtime: new Date(0) });
		return;
	}

	if (entry.kind === "video") {
		if (!options.media.keepVideoOriginals && ffmpegAvailable) {
			const placeholder = await createVideoPlaceholder(entry.relativePath);

			if (placeholder) {
				stats.zippedInputSize += placeholder.length;
				stats.replacedVideoFiles++;
				zipfile.addBuffer(placeholder, entry.relativePath, { mtime: new Date(0) });
				return;
			}

			stats.warnings.push(`Could not create video placeholder for ${entry.relativePath}. Kept original.`);
		}

		stats.keptOriginalVideoFiles++;
		addOriginalFile(zipfile, entry, stats);
		return;
	}

	if (entry.kind === "audio") {
		if (!options.media.keepAudioOriginals && ffmpegAvailable) {
			const placeholder = await createAudioPlaceholder(entry.relativePath);

			if (placeholder) {
				stats.zippedInputSize += placeholder.length;
				stats.replacedAudioFiles++;
				zipfile.addBuffer(placeholder, entry.relativePath, { mtime: new Date(0) });
				return;
			}

			stats.warnings.push(`Could not create audio placeholder for ${entry.relativePath}. Kept original.`);
		}

		stats.keptOriginalAudioFiles++;
		addOriginalFile(zipfile, entry, stats);
	}
}

function addOriginalFile(zipfile: yazl.ZipFile, entry: FileEntry, stats: ZipStats): void {
	stats.zippedInputSize += entry.size;
	zipfile.addFile(entry.fullPath, entry.relativePath, { mtime: new Date(0) });
}
