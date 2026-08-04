// src/zip.ts

import fs from "node:fs";
import path from "node:path";
import { createArchiveWriter } from "./archive-writer.js";
import {
	createAudioPlaceholder,
	createImagePlaceholder,
	createShapePreservingImagePlaceholder,
	createVideoPlaceholder,
	isFfmpegAvailable,
} from "./media.js";
import type { CliOptions, FileEntry, ZipStats } from "./types.js";
import { inspectZipArchive } from "./zip-inspector.js";

export async function ensureOutputDir(outputPath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
}

export function createInitialStats(
	includedFiles: number,
	ignoredFiles: number,
	ignoredDirectories: number,
	gitIgnoredFiles = 0,
	scopeExcludedFiles = 0,
): ZipStats {
	return {
		originalTotalSize: 0,
		archiveInputSize: 0,
		archiveSize: 0,
		includedFiles,
		ignoredFiles,
		ignoredDirectories,
		gitIgnoredFiles,
		scopeExcludedFiles,
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

export async function createArchive(
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
	addFfmpegWarnings(entries, options, stats, ffmpegAvailable);

	try {
		const writer = await createArchiveWriter(options.output, options.archive);
		for (const entry of entries) {
			await addEntry(writer, entry, options, stats, ffmpegAvailable);
		}
		await writer.finalize();
	} catch (error) {
		await fs.promises.rm(options.output, { force: true }).catch(() => undefined);
		throw error;
	}

	const diagnostics =
		options.archive.format === "zip"
			? await inspectZipArchive(options.output)
			: { archiveSize: (await fs.promises.stat(options.output)).size };
	stats.archiveSize = diagnostics.archiveSize;
	stats.compressedPayloadSize = diagnostics.compressedPayloadSize;
	stats.archiveMetadataSize = diagnostics.archiveMetadataSize;
	return stats;
}

/** @deprecated Use createArchive. Kept for source compatibility. */
export const createZip = createArchive;

async function addEntry(
	writer: Awaited<ReturnType<typeof createArchiveWriter>>,
	entry: FileEntry,
	options: CliOptions,
	stats: ZipStats,
	ffmpegAvailable: boolean,
): Promise<void> {
	stats.originalTotalSize += entry.size;

	if (!options.media.minify || entry.kind === "normal") {
		await addOriginalFile(writer, entry, stats);
		return;
	}

	if (entry.kind === "image") {
		if (options.media.mode === "preserve-shape") {
			const placeholder = await createShapePreservingImagePlaceholder(entry.relativePath, entry.fullPath);
			if (placeholder) {
				stats.archiveInputSize += placeholder.buffer.length;
				stats.replacedImageFiles++;
				stats.preservedShapeImageFiles++;
				await writer.addBuffer(placeholder.buffer, entry.relativePath);
				return;
			}

			stats.keptOriginalImageFiles++;
			stats.warnings.push(`Could not create shape-preserving image placeholder for ${entry.relativePath}. Kept original.`);
			await addOriginalFile(writer, entry, stats);
			return;
		}

		const placeholder = createImagePlaceholder(entry.relativePath);
		stats.archiveInputSize += placeholder.length;
		stats.replacedImageFiles++;
		await writer.addBuffer(placeholder, entry.relativePath);
		return;
	}

	if (entry.kind === "video") {
		if (!options.media.keepVideoOriginals && ffmpegAvailable) {
			const placeholder = await createVideoPlaceholder(entry.relativePath);
			if (placeholder) {
				stats.archiveInputSize += placeholder.length;
				stats.replacedVideoFiles++;
				await writer.addBuffer(placeholder, entry.relativePath);
				return;
			}
			stats.warnings.push(`Could not create video placeholder for ${entry.relativePath}. Kept original.`);
		}

		stats.keptOriginalVideoFiles++;
		await addOriginalFile(writer, entry, stats);
		return;
	}

	if (entry.kind === "audio") {
		if (!options.media.keepAudioOriginals && ffmpegAvailable) {
			const placeholder = await createAudioPlaceholder(entry.relativePath);
			if (placeholder) {
				stats.archiveInputSize += placeholder.length;
				stats.replacedAudioFiles++;
				await writer.addBuffer(placeholder, entry.relativePath);
				return;
			}
			stats.warnings.push(`Could not create audio placeholder for ${entry.relativePath}. Kept original.`);
		}

		stats.keptOriginalAudioFiles++;
		await addOriginalFile(writer, entry, stats);
	}
}

async function addOriginalFile(
	writer: Awaited<ReturnType<typeof createArchiveWriter>>,
	entry: FileEntry,
	stats: ZipStats,
): Promise<void> {
	stats.archiveInputSize += entry.size;
	await writer.addFile(entry.fullPath, entry.relativePath, entry.size);
}

function addFfmpegWarnings(
	entries: readonly FileEntry[],
	options: CliOptions,
	stats: ZipStats,
	ffmpegAvailable: boolean,
): void {
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
}
