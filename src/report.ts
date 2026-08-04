// src/report.ts

import { archiveDisplayName } from "./archive-writer.js";
import { isFfmpegAvailable } from "./media.js";
import type {
	CliOptions,
	DryRunReport,
	FileEntry,
	ProfileResolution,
	ScanResult,
	ScopeResult,
	VerbosityLevel,
	ZipStats,
} from "./types.js";

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

export function printProgress(message: string, verbosity: VerbosityLevel): void {
	if (verbosity >= 1) {
		console.log(message);
	}
}

export function printStartReport(options: CliOptions, profile: ProfileResolution): void {
	if (options.verbosity < 1) {
		return;
	}

	console.log(`📁 Root: ${options.root}`);
	console.log(`📦 Output: ${options.output}`);
	console.log(`🗜️ Archive: ${options.archive.format}, level ${options.archive.compressionLevel}`);
	console.log(`🧩 Profile: ${profile.effectiveProfile} (requested: ${profile.requestedProfile})`);
	console.log(`🗂️ Selection: ${options.selection.mode}`);
	console.log(`🎯 Scope: ${formatScope(options)}`);
	if (options.target) {
		console.log(`🎛️ Target: ${options.target}`);
	}

	if (options.verbosity >= 2) {
		const detectedText = Object.entries(profile.detected)
			.map(([kind, detected]) => `${kind}=${detected ? "yes" : "no"}`)
			.join(", ");
		console.log(`🔎 Detected: ${detectedText}`);
		console.log(`🧱 Ignore groups: ${profile.activeIgnoreGroups.join(", ")}`);
		console.log(`🧠 ZIP small-file buffer: ${formatBytes(options.archive.smallFileBufferThreshold)}`);
	}

	console.log(`🖼️ Media mode: ${formatMediaMode(options)}`);
	if (options.verbosity >= 4) {
		console.log("🛠️ Dev options:");
		console.log(formatJson({ options, profile }));
	}
}

export function printDryRunReport(
	options: CliOptions,
	profile: ProfileResolution,
	entries: readonly FileEntry[],
	scan: ScanResult,
	scope: ScopeResult,
	dryRun: DryRunReport,
): void {
	const warnings = [
		...buildSensitiveWarnings(scan.sensitiveFiles),
		...scan.warnings,
		...scope.warnings,
		...dryRun.warnings,
	];

	if (options.verbosity === 0) {
		console.log(
			`🧪 Dry run: ${entries.length} files would be included, ${formatIgnoredCount(scan.ignoredFiles, scan.ignoredDirectories)} ignored.`,
		);
		console.log(`🧩 Profile: ${profile.effectiveProfile}`);
		console.log(`🗂️ Selection: ${scan.selectionMode}`);
		console.log(`🎯 Scope: ${formatScopeResult(scope)}`);
		console.log(`🗜️ Archive: ${options.archive.format}`);
		console.log(`🖼️ Media: ${formatDryRunMediaSummary(options, dryRun)}`);
		printWarnings(warnings, options.verbosity);
		return;
	}

	console.log("🧪 Dry run only. No archive was created.");
	console.log(`🧩 Profile: ${profile.effectiveProfile}`);
	console.log(`🗂️ Selection: ${scan.selectionMode}`);
	console.log(`🎯 Scope: ${formatScopeResult(scope)}`);
	console.log(`🗜️ Archive format: ${options.archive.format}`);
	console.log(`📄 Included files: ${entries.length}`);
	console.log(`🚫 Ignore-pattern files: ${scan.ignoredFiles}`);
	console.log(`🚫 Ignore-pattern directories: ${scan.ignoredDirectories}`);
	console.log(`🙈 Git-ignored files: ${scan.gitIgnoredFiles}`);
	console.log(`🎯 Files excluded by scope: ${scope.excludedFiles}`);
	console.log(`🖼️ Media mode: ${formatMediaMode(options)}`);
	console.log(`🖼️ Images to replace: ${dryRun.mediaReplacementPlan.images}`);
	console.log(`🎞️ Videos to replace: ${dryRun.mediaReplacementPlan.videos}`);
	console.log(`🔇 Audio files to replace: ${dryRun.mediaReplacementPlan.audio}`);

	if (dryRun.mediaReplacementPlan.keptVideos > 0 || options.verbosity >= 2) {
		console.log(`🎞️ Video files kept original: ${dryRun.mediaReplacementPlan.keptVideos}`);
	}
	if (dryRun.mediaReplacementPlan.keptAudio > 0 || options.verbosity >= 2) {
		console.log(`🔊 Audio files kept original: ${dryRun.mediaReplacementPlan.keptAudio}`);
	}

	printLargestFiles(dryRun.largestFiles);
	if (options.verbosity >= 2) {
		printPathDiagnostics(entries);
		printDirectoryContributors(entries);
		printScopedProjects(scope);
	}
	printIncludedFiles(entries, options.verbosity);
	printWarnings(warnings, options.verbosity);

	if (options.media.minify === false) {
		console.log("🧰 Media minimization: disabled");
	}
}

export function printZipReport(
	output: string,
	profile: ProfileResolution,
	stats: ZipStats,
	scan: ScanResult,
	scope: ScopeResult,
	entries: readonly FileEntry[],
	options: CliOptions,
): void {
	const warnings = [
		...buildSensitiveWarnings(scan.sensitiveFiles),
		...scan.warnings,
		...scope.warnings,
		...stats.warnings,
	];
	const archiveName = archiveDisplayName(options.archive.format);

	if (options.verbosity === 0) {
		console.log(`✅ ${archiveName} created: ${output}`);
		console.log(`🧩 Profile: ${profile.effectiveProfile}`);
		console.log(`🗂️ Selection: ${scan.selectionMode}`);
		console.log(
			`📄 Files: ${stats.includedFiles} included, ${formatIgnoredCount(stats.ignoredFiles, stats.ignoredDirectories)} ignored`,
		);
		console.log(
			`📉 Input: ${formatBytes(stats.originalTotalSize)} → ${formatBytes(stats.archiveInputSize)} → ${formatBytes(stats.archiveSize)}`,
		);
		console.log(`🖼️ Media: ${formatZipMediaSummary(stats)}`);
		printWarnings(warnings, options.verbosity);
		return;
	}

	console.log(`✅ ${archiveName} created: ${output}`);
	console.log(`🧩 Profile: ${profile.effectiveProfile}`);
	console.log(`🗂️ Selection: ${scan.selectionMode}`);
	console.log(`🎯 Scope: ${formatScopeResult(scope)}`);
	console.log(`🗜️ Archive format: ${options.archive.format}`);
	console.log(`📦 Original files: ${formatBytes(stats.originalTotalSize)}`);
	console.log(`📉 After media transformation: ${formatBytes(stats.archiveInputSize)}`);
	if (stats.compressedPayloadSize !== undefined) {
		console.log(`🧱 Compressed file payload: ${formatBytes(stats.compressedPayloadSize)}`);
	}
	if (stats.archiveMetadataSize !== undefined) {
		console.log(`🧾 ZIP metadata and framing: ${formatBytes(stats.archiveMetadataSize)}`);
	}
	console.log(`🗜️ Final archive: ${formatBytes(stats.archiveSize)}`);
	console.log(`📄 Included files: ${stats.includedFiles}`);
	console.log(`🚫 Ignore-pattern files: ${stats.ignoredFiles}`);
	console.log(`🚫 Ignore-pattern directories: ${stats.ignoredDirectories}`);
	console.log(`🙈 Git-ignored files: ${stats.gitIgnoredFiles}`);
	console.log(`🎯 Files excluded by scope: ${stats.scopeExcludedFiles}`);
	console.log(`🖼️ Replaced image files: ${stats.replacedImageFiles}`);

	if (stats.preservedShapeImageFiles > 0 || options.verbosity >= 2) {
		console.log(`📐 Shape-preserving image placeholders: ${stats.preservedShapeImageFiles}`);
	}
	if (stats.keptOriginalImageFiles > 0 || options.verbosity >= 2) {
		console.log(`🖼️ Image files kept original: ${stats.keptOriginalImageFiles}`);
	}
	console.log(`🎞️ Replaced video files: ${stats.replacedVideoFiles}`);
	console.log(`🔇 Replaced audio files: ${stats.replacedAudioFiles}`);
	if (stats.keptOriginalVideoFiles > 0 || options.verbosity >= 2) {
		console.log(`🎞️ Video files kept original: ${stats.keptOriginalVideoFiles}`);
	}
	if (stats.keptOriginalAudioFiles > 0 || options.verbosity >= 2) {
		console.log(`🔊 Audio files kept original: ${stats.keptOriginalAudioFiles}`);
	}

	printLargestFiles([...entries].sort((left, right) => right.size - left.size).slice(0, 10));
	if (options.verbosity >= 2) {
		printPathDiagnostics(entries);
		printDirectoryContributors(entries);
		printScopedProjects(scope);
	}
	printIncludedFiles(entries, options.verbosity);
	printWarnings(warnings, options.verbosity);
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) {
		return "0 B";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
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

function printDirectoryContributors(entries: readonly FileEntry[]): void {
	const contributors = new Map<string, { files: number; bytes: number }>();
	for (const entry of entries) {
		const directory = entry.relativePath.includes("/")
			? (entry.relativePath.split("/", 1)[0] ?? "(root)")
			: "(root)";
		const current = contributors.get(directory) ?? { files: 0, bytes: 0 };
		current.files++;
		current.bytes += entry.size;
		contributors.set(directory, current);
	}

	console.log("🧭 Largest top-level contributors (original bytes):");
	for (const [directory, contribution] of [...contributors.entries()]
		.sort((left, right) => right[1].bytes - left[1].bytes)
		.slice(0, 10)) {
		console.log(`  - ${formatBytes(contribution.bytes)} / ${contribution.files} files ${directory}`);
	}
}

function printPathDiagnostics(entries: readonly FileEntry[]): void {
	const totalPathBytes = entries.reduce((total, entry) => total + Buffer.byteLength(entry.relativePath, "utf8"), 0);
	const average = entries.length > 0 ? totalPathBytes / entries.length : 0;
	const longest = [...entries].sort(
		(left, right) => Buffer.byteLength(right.relativePath, "utf8") - Buffer.byteLength(left.relativePath, "utf8"),
	)[0];
	console.log(`🧾 Average archive path length: ${average.toFixed(1)} bytes`);
	if (longest) {
		console.log(
			`🧾 Longest archive path: ${Buffer.byteLength(longest.relativePath, "utf8")} bytes ${longest.relativePath}`,
		);
	}
}

function printScopedProjects(scope: ScopeResult): void {
	if (scope.mode !== "dotnet-project") {
		return;
	}
	console.log(`🧬 Scoped .NET projects: ${scope.projects.length}`);
	for (const project of scope.projects) {
		console.log(`  - ${project}`);
	}
}

function printIncludedFiles(entries: readonly FileEntry[], verbosity: VerbosityLevel): void {
	if (verbosity < 3) {
		return;
	}
	console.log("📄 Included file list:");
	if (entries.length === 0) {
		console.log("  - none");
		return;
	}
	for (const entry of entries) {
		console.log(`  - ${formatBytes(entry.size)} ${entry.kind.padEnd(6)} ${entry.relativePath}`);
	}
}

function printWarnings(warnings: readonly string[], verbosity: VerbosityLevel): void {
	const uniqueWarnings = [...new Set(warnings)];
	if (uniqueWarnings.length === 0) {
		if (verbosity >= 1) {
			console.log("⚠️ Warnings: 0");
		}
		return;
	}
	console.log(`⚠️ Warnings: ${uniqueWarnings.length}`);
	if (verbosity === 0) {
		console.log("  Use -v 1 to show warning details.");
		return;
	}
	for (const warning of uniqueWarnings) {
		console.log(`  - ${warning}`);
	}
}

function buildSensitiveWarnings(sensitiveFiles: readonly string[]): string[] {
	return sensitiveFiles.map((file) => `Sensitive file ignored: ${file}`);
}

function formatIgnoredCount(files: number, directories: number): string {
	return `${files} files / ${directories} dirs`;
}

function formatMediaMode(options: CliOptions): string {
	return options.media.minify ? options.media.mode : "disabled";
}

function formatScope(options: CliOptions): string {
	if (options.scope.mode === "full") {
		return "full repository";
	}
	return `${options.scope.project ?? "missing project"}${options.scope.includeRelatedTests ? " + related tests" : ""}`;
}

function formatScopeResult(scope: ScopeResult): string {
	if (scope.mode === "full") {
		return "full repository";
	}
	return `${scope.rootProject ?? "unknown project"}, ${scope.projects.length} projects`;
}

function formatDryRunMediaSummary(options: CliOptions, dryRun: DryRunReport): string {
	if (!options.media.minify) {
		return "disabled";
	}
	return `${formatMediaMode(options)}, replace ${dryRun.mediaReplacementPlan.images} images, ${dryRun.mediaReplacementPlan.videos} videos, ${dryRun.mediaReplacementPlan.audio} audio`;
}

function formatZipMediaSummary(stats: ZipStats): string {
	return `${stats.replacedImageFiles} images, ${stats.replacedVideoFiles} videos, ${stats.replacedAudioFiles} audio replaced`;
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, "\t");
}
