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
	if (options.target) {
		console.log(`🎛️ Target: ${options.target}`);
	}

	if (options.verbosity >= 2) {
		console.log(`🗜️ Requested archive: ${options.archive.format}, level ${options.archive.compressionLevel}`);
		console.log(`🧩 Resolved profile: ${profile.effectiveProfile} (requested: ${profile.requestedProfile})`);
		console.log(`🗂️ Requested selection: ${options.selection.mode}`);
		console.log(`🎯 Requested scope: ${formatScope(options)}`);
		console.log(`🖼️ Media mode: ${formatMediaMode(options)}`);
		const detectedText = Object.entries(profile.detected)
			.map(([kind, detected]) => `${kind}=${detected ? "yes" : "no"}`)
			.join(", ");
		console.log(`🔎 Detected: ${detectedText}`);
		console.log(`🧱 Ignore groups: ${profile.activeIgnoreGroups.join(", ")}`);
		console.log(`🧠 ZIP small-file buffer: ${formatBytes(options.archive.smallFileBufferThreshold)}`);
	}

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

	console.log(
		options.verbosity === 0
			? `🧪 Dry run: ${entries.length} files would be included; no archive created.`
			: "🧪 Dry run complete. No archive was created.",
	);
	console.log(`🧩 Profile: ${profile.effectiveProfile}`);
	console.log(`🗂️ Selection: ${scan.selectionMode}`);
	if (scope.mode !== "full" || options.verbosity >= 1) {
		console.log(`🎯 Scope: ${formatScopeResult(scope)}`);
	}
	console.log(`🗜️ Archive: ${options.archive.format}, level ${options.archive.compressionLevel}`);
	console.log(
		`📄 Files: ${entries.length} included, ${formatIgnoredCount(scan.ignoredFiles, scan.ignoredDirectories)} ignored`,
	);
	console.log(`🖼️ Media: ${formatDryRunMediaSummary(options, dryRun)}`);

	if (options.verbosity >= 2) {
		console.log(`🚫 Ignore-pattern files: ${scan.ignoredFiles}`);
		console.log(`🚫 Ignore-pattern directories: ${scan.ignoredDirectories}`);
		console.log(`🙈 Git-ignored files: ${scan.gitIgnoredFiles}`);
		console.log(`🎯 Files excluded by scope: ${scope.excludedFiles}`);
		console.log(`🖼️ Images to replace: ${dryRun.mediaReplacementPlan.images}`);
		console.log(`🎞️ Videos to replace: ${dryRun.mediaReplacementPlan.videos}`);
		console.log(`🔇 Audio files to replace: ${dryRun.mediaReplacementPlan.audio}`);
		console.log(`🎞️ Video files kept original: ${dryRun.mediaReplacementPlan.keptVideos}`);
		console.log(`🔊 Audio files kept original: ${dryRun.mediaReplacementPlan.keptAudio}`);
		printLargestFiles(dryRun.largestFiles);
		printPathDiagnostics(entries);
		printDirectoryContributors(entries);
		printScopedProjects(scope);
	}

	printIncludedFiles(entries, options.verbosity);
	printWarnings(warnings, options.verbosity);
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

	console.log(`✅ ${archiveName} created: ${output}`);
	console.log(`🔐 SHA-256: ${stats.archiveSha256}`);

	if (options.verbosity === 0) {
		console.log(`🧩 Profile: ${profile.effectiveProfile} · Selection: ${scan.selectionMode}`);
		if (scope.mode !== "full") {
			console.log(`🎯 Scope: ${formatScopeResult(scope)}`);
		}
		console.log(`📄 Files: ${formatArchiveFileSummary(stats)}`);
		console.log(`📉 Size: ${formatArchiveSizeSummary(stats)}`);
		console.log(`🖼️ Media: ${formatZipMediaSummary(options, stats)}`);
		printWarnings(warnings, options.verbosity);
		return;
	}

	console.log(`🧩 Profile: ${profile.effectiveProfile}`);
	console.log(`🗂️ Selection: ${scan.selectionMode}`);
	console.log(`🎯 Scope: ${formatScopeResult(scope)}`);
	console.log(`🗜️ Archive: ${options.archive.format}, level ${options.archive.compressionLevel}`);
	console.log(`📄 Files: ${formatArchiveFileSummary(stats)}`);
	console.log(`📉 Size: ${formatArchiveSizeSummary(stats)}`);
	console.log(`🖼️ Media: ${formatZipMediaSummary(options, stats)}`);

	if (options.verbosity >= 2) {
		if (stats.compressedPayloadSize !== undefined) {
			console.log(`🧱 Compressed file payload: ${formatBytes(stats.compressedPayloadSize)}`);
		}
		if (stats.archiveMetadataSize !== undefined) {
			console.log(`🧾 ZIP metadata and framing: ${formatBytes(stats.archiveMetadataSize)}`);
		}
		console.log(`🚫 Ignore-pattern files: ${stats.ignoredFiles}`);
		console.log(`🚫 Ignore-pattern directories: ${stats.ignoredDirectories}`);
		console.log(`🙈 Git-ignored files: ${stats.gitIgnoredFiles}`);
		console.log(`🎯 Files excluded by scope: ${stats.scopeExcludedFiles}`);
		console.log(`🖼️ Replaced image files: ${stats.replacedImageFiles}`);
		console.log(`📐 Shape-preserving image placeholders: ${stats.preservedShapeImageFiles}`);
		console.log(`🖼️ Image files kept original: ${stats.keptOriginalImageFiles}`);
		console.log(`🎞️ Replaced video files: ${stats.replacedVideoFiles}`);
		console.log(`🔇 Replaced audio files: ${stats.replacedAudioFiles}`);
		console.log(`🎞️ Video files kept original: ${stats.keptOriginalVideoFiles}`);
		console.log(`🔊 Audio files kept original: ${stats.keptOriginalAudioFiles}`);
		printLargestFiles([...entries].sort((left, right) => right.size - left.size).slice(0, 10));
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
		return;
	}
	console.log(`⚠️ Warnings: ${uniqueWarnings.length}`);
	if (verbosity === 0) {
		console.log("  Use -v to show warning details.");
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
	const plan = dryRun.mediaReplacementPlan;
	if (plan.images === 0 && plan.videos === 0 && plan.audio === 0) {
		return `${formatMediaMode(options)}; no media would be replaced`;
	}
	return `${formatMediaMode(options)}; replace ${plan.images} images, ${plan.videos} videos, ${plan.audio} audio`;
}

function formatArchiveFileSummary(stats: ZipStats): string {
	return `${stats.includedFiles} included, ${formatIgnoredCount(stats.ignoredFiles, stats.ignoredDirectories)} ignored`;
}

function formatArchiveSizeSummary(stats: ZipStats): string {
	return (
		`${formatBytes(stats.originalTotalSize)} source → ` +
		`${formatBytes(stats.archiveInputSize)} transformed → ${formatBytes(stats.archiveSize)} archive`
	);
}

function formatZipMediaSummary(options: CliOptions, stats: ZipStats): string {
	if (!options.media.minify) {
		return "disabled";
	}
	if (stats.replacedImageFiles === 0 && stats.replacedVideoFiles === 0 && stats.replacedAudioFiles === 0) {
		return `${formatMediaMode(options)}; no media replaced`;
	}
	return (
		`${formatMediaMode(options)}; ${stats.replacedImageFiles} images, ` +
		`${stats.replacedVideoFiles} videos, ${stats.replacedAudioFiles} audio replaced`
	);
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, "\t");
}
