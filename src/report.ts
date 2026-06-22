// src/report.ts

import { isFfmpegAvailable } from "./media.js";
import type { CliOptions, DryRunReport, FileEntry, ProfileResolution, ZipStats } from "./types.js";

export async function buildDryRunReport(entries: readonly FileEntry[], options: CliOptions): Promise<DryRunReport> {
	const largestFiles = [...entries].sort((left, right) => right.size - left.size).slice(0, 10);
	const hasVideo = entries.some((entry) => entry.kind === "video");
	const hasAudio = entries.some((entry) => entry.kind === "audio");
	const needsFfmpeg =
		options.media.minify &&
		((hasVideo && !options.media.keepVideoOriginals) || (hasAudio && !options.media.keepAudioOriginals));
	const ffmpegAvailable = needsFfmpeg ? await isFfmpegAvailable() : false;
	const warnings: string[] = [];

	if (needsFfmpeg && !ffmpegAvailable) {
		if (hasVideo && !options.media.keepVideoOriginals) {
			warnings.push("ffmpeg not found. Video files would be kept original.");
		}

		if (hasAudio && !options.media.keepAudioOriginals) {
			warnings.push("ffmpeg not found. Audio files would be kept original.");
		}
	}

	return {
		largestFiles,
		mediaReplacementPlan: {
			images: options.media.minify ? entries.filter((entry) => entry.kind === "image").length : 0,
			videos:
				options.media.minify && !options.media.keepVideoOriginals && ffmpegAvailable
					? entries.filter((entry) => entry.kind === "video").length
					: 0,
			audio:
				options.media.minify && !options.media.keepAudioOriginals && ffmpegAvailable
					? entries.filter((entry) => entry.kind === "audio").length
					: 0,
			keptVideos:
				!options.media.minify || options.media.keepVideoOriginals || !ffmpegAvailable
					? entries.filter((entry) => entry.kind === "video").length
					: 0,
			keptAudio:
				!options.media.minify || options.media.keepAudioOriginals || !ffmpegAvailable
					? entries.filter((entry) => entry.kind === "audio").length
					: 0,
		},
		warnings,
	};
}

export function printStartReport(options: CliOptions, profile: ProfileResolution): void {
	console.log(`📁 Root: ${options.root}`);
	console.log(`📦 Output: ${options.output}`);
	console.log(`🧩 Profile: ${profile.effectiveProfile} (requested: ${profile.requestedProfile})`);
	console.log(
		`🔎 Detected: node=${profile.detected.node ? "yes" : "no"}, dotnet=${profile.detected.dotnet ? "yes" : "no"}`,
	);
	console.log(`🧱 Ignore groups: ${profile.activeIgnoreGroups.join(", ")}`);
}

export function printDryRunReport(
	options: CliOptions,
	profile: ProfileResolution,
	entries: readonly FileEntry[],
	ignoredFiles: number,
	ignoredDirectories: number,
	sensitiveFiles: readonly string[],
	dryRun: DryRunReport,
): void {
	console.log("🧪 Dry run only. No ZIP was created.");
	console.log(`🧩 Profile: ${profile.effectiveProfile}`);
	console.log(`📄 Included files: ${entries.length}`);
	console.log(`🚫 Ignored files: ${ignoredFiles}`);
	console.log(`🚫 Ignored directories: ${ignoredDirectories}`);
	console.log(`🖼️ Images to replace: ${dryRun.mediaReplacementPlan.images}`);
	console.log(`🎞️ Videos to replace: ${dryRun.mediaReplacementPlan.videos}`);
	console.log(`🔇 Audio files to replace: ${dryRun.mediaReplacementPlan.audio}`);

	if (dryRun.mediaReplacementPlan.keptVideos > 0) {
		console.log(`🎞️ Video files kept original: ${dryRun.mediaReplacementPlan.keptVideos}`);
	}

	if (dryRun.mediaReplacementPlan.keptAudio > 0) {
		console.log(`🔊 Audio files kept original: ${dryRun.mediaReplacementPlan.keptAudio}`);
	}

	printLargestFiles(dryRun.largestFiles);
	printWarnings([...buildSensitiveWarnings(sensitiveFiles), ...dryRun.warnings]);

	if (options.media.minify === false) {
		console.log("🧰 Media minimization: disabled");
	}
}

export function printZipReport(
	output: string,
	profile: ProfileResolution,
	stats: ZipStats,
	sensitiveFiles: readonly string[],
): void {
	console.log(`✅ ZIP created: ${output}`);
	console.log(`🧩 Profile: ${profile.effectiveProfile}`);
	console.log(`📦 Original input size: ${formatBytes(stats.originalTotalSize)}`);
	console.log(`📉 ZIP input after media minimization: ${formatBytes(stats.zippedInputSize)}`);
	console.log(`📄 Included files: ${stats.includedFiles}`);
	console.log(`🚫 Ignored files: ${stats.ignoredFiles}`);
	console.log(`🚫 Ignored directories: ${stats.ignoredDirectories}`);
	console.log(`🖼️ Replaced image files: ${stats.replacedImageFiles}`);
	console.log(`🎞️ Replaced video files: ${stats.replacedVideoFiles}`);
	console.log(`🔇 Replaced audio files: ${stats.replacedAudioFiles}`);

	if (stats.keptOriginalVideoFiles > 0) {
		console.log(`🎞️ Video files kept original: ${stats.keptOriginalVideoFiles}`);
	}

	if (stats.keptOriginalAudioFiles > 0) {
		console.log(`🔊 Audio files kept original: ${stats.keptOriginalAudioFiles}`);
	}

	printWarnings([...buildSensitiveWarnings(sensitiveFiles), ...stats.warnings]);
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) {
		return "0 B";
	}

	const units = ["B", "KB", "MB", "GB"];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;

	return `${value.toFixed(2)} ${units[exponent]}`;
}

function printLargestFiles(entries: readonly FileEntry[]): void {
	console.log("📊 Largest included files:");

	if (entries.length === 0) {
		console.log("  - none");
		return;
	}

	for (const entry of entries) {
		console.log(`  - ${formatBytes(entry.size)} ${entry.relativePath}`);
	}
}

function printWarnings(warnings: readonly string[]): void {
	const uniqueWarnings = [...new Set(warnings)];
	console.log(`⚠️ Warnings: ${uniqueWarnings.length}`);

	for (const warning of uniqueWarnings) {
		console.log(`  - ${warning}`);
	}
}

function buildSensitiveWarnings(sensitiveFiles: readonly string[]): string[] {
	return sensitiveFiles.map((file) => `Sensitive file ignored: ${file}`);
}
