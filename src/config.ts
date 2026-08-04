// src/config.ts

import fs from "node:fs";
import path from "node:path";
import { isRequestedProfile } from "./profile.js";
import {
	ARCHIVE_FORMAT_VALUES,
	MEDIA_MODE_VALUES,
	PROFILE_VALUES,
	SCOPE_MODE_VALUES,
	SELECTION_MODE_VALUES,
} from "./types.js";
import type {
	ArchiveFormat,
	CliOptions,
	MediaMode,
	RawCliOptions,
	RequestedProfile,
	ScopeMode,
	SelectionMode,
	VerbosityLevel,
	ZipItConfig,
	ZipItConfigLayer,
} from "./types.js";

export const CONFIG_FILE_NAME = ".zip-it.json";
export const DEFAULT_ARCHIVE_FORMAT: ArchiveFormat = "zip";
export const DEFAULT_COMPRESSION_LEVEL = 6;
export const DEFAULT_SMALL_FILE_BUFFER_THRESHOLD = 256 * 1024;

export async function readProjectConfig(root: string): Promise<ZipItConfig> {
	const configPath = path.join(root, CONFIG_FILE_NAME);

	if (!fs.existsSync(configPath)) {
		return {};
	}

	const raw = await fs.promises.readFile(configPath, "utf8");
	const parsed: unknown = JSON.parse(raw);

	return parseConfig(parsed, configPath);
}

export function mergeOptions(rawCliOptions: RawCliOptions, config: ZipItConfig): CliOptions {
	const root = path.resolve(rawCliOptions.root ?? process.cwd());
	const target = rawCliOptions.target ?? config.defaultTarget;
	const configLayer = resolveConfigLayer(config, target);
	const archiveFormat = rawCliOptions.archiveFormat ?? configLayer.archive?.format ?? DEFAULT_ARCHIVE_FORMAT;
	const outputValue = rawCliOptions.output ?? configLayer.output ?? defaultOutputPath(archiveFormat);
	const output = path.isAbsolute(outputValue) ? outputValue : path.join(root, outputValue);
	const profile = rawCliOptions.profile ?? configLayer.profile ?? "auto";
	const project = rawCliOptions.project ?? configLayer.scope?.project;
	const scopeMode = project ? "dotnet-project" : (configLayer.scope?.mode ?? "full");

	const minifyMedia = rawCliOptions.minifyMedia ?? configLayer.media?.minify ?? true;
	const mediaMode = rawCliOptions.mediaMode ?? configLayer.media?.mode ?? "tiny";
	const keepVideoOriginals =
		rawCliOptions.keepVideoOriginals ?? configLayer.media?.keepVideoOriginals ?? false;
	const keepAudioOriginals =
		rawCliOptions.keepAudioOriginals ?? configLayer.media?.keepAudioOriginals ?? false;
	const ignorePatterns = [...(configLayer.ignore ?? []), ...rawCliOptions.ignorePatterns];
	const verbosity = rawCliOptions.verbosity ?? 0;

	return {
		root,
		output,
		target,
		profile,
		selection: {
			mode: rawCliOptions.selectionMode ?? configLayer.selection?.mode ?? "auto",
		},
		archive: {
			format: archiveFormat,
			compressionLevel:
				rawCliOptions.compressionLevel ??
				configLayer.archive?.compressionLevel ??
				DEFAULT_COMPRESSION_LEVEL,
			smallFileBufferThreshold:
				rawCliOptions.smallFileBufferThreshold ??
				configLayer.archive?.smallFileBufferThreshold ??
				DEFAULT_SMALL_FILE_BUFFER_THRESHOLD,
		},
		scope: {
			mode: scopeMode,
			project,
			includeRelatedTests:
				rawCliOptions.includeRelatedTests ?? configLayer.scope?.includeRelatedTests ?? true,
			includeRootFiles: rawCliOptions.includeRootFiles ?? configLayer.scope?.includeRootFiles ?? true,
		},
		media: {
			minify: minifyMedia,
			mode: mediaMode,
			keepVideoOriginals,
			keepAudioOriginals,
		},
		ignorePatterns,
		dryRun: rawCliOptions.dryRun ?? false,
		verbosity,
	};
}

export function parseRawCliOptions(argv: readonly string[]): RawCliOptions {
	const options: RawCliOptions = {
		ignorePatterns: [],
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];

		if (arg.startsWith("--verbose=")) {
			options.verbosity = parseVerbosityLevel(arg.slice("--verbose=".length));
			continue;
		}

		if (arg.startsWith("-v=") || /^-v[0-3]$/.test(arg)) {
			options.verbosity = parseVerbosityLevel(arg.replace(/^-v=?/, ""));
			continue;
		}

		if (/^-v{2,4}$/.test(arg)) {
			options.verbosity = Math.min(arg.length - 1, 4) as VerbosityLevel;
			continue;
		}

		switch (arg) {
			case "--root":
				options.root = path.resolve(requireValue(argv, ++index, "--root"));
				break;
			case "--output":
				options.output = requireValue(argv, ++index, "--output");
				break;
			case "--target":
				options.target = requireValue(argv, ++index, "--target");
				break;
			case "--profile":
				options.profile = parseRequestedProfile(requireValue(argv, ++index, "--profile"));
				break;
			case "--selection":
				options.selectionMode = parseSelectionMode(requireValue(argv, ++index, "--selection"));
				break;
			case "--format":
			case "--archive-format":
				options.archiveFormat = parseArchiveFormat(requireValue(argv, ++index, arg));
				break;
			case "--compression-level":
				options.compressionLevel = parseIntegerInRange(
					requireValue(argv, ++index, "--compression-level"),
					"compression level",
					0,
					9,
				);
				break;
			case "--small-file-buffer-threshold":
				options.smallFileBufferThreshold = parseNonNegativeInteger(
					requireValue(argv, ++index, "--small-file-buffer-threshold"),
					"small file buffer threshold",
				);
				break;
			case "--project":
				options.project = requireValue(argv, ++index, "--project");
				break;
			case "--no-related-tests":
				options.includeRelatedTests = false;
				break;
			case "--no-root-files":
				options.includeRootFiles = false;
				break;
			case "--ignore":
				options.ignorePatterns.push(requireValue(argv, ++index, "--ignore"));
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--no-media-minify":
				options.minifyMedia = false;
				break;
			case "--media-mode":
				options.mediaMode = parseMediaMode(requireValue(argv, ++index, "--media-mode"));
				break;
			case "--preserve-media-shape":
				options.mediaMode = "preserve-shape";
				break;
			case "--keep-video-originals":
				options.keepVideoOriginals = true;
				break;
			case "--keep-audio-originals":
				options.keepAudioOriginals = true;
				break;
			case "--verbose":
			case "-v":
				options.verbosity = readOptionalVerbosityValue(argv, index);
				if (hasOptionalValue(argv, index)) {
					index++;
				}
				break;
			case "-h":
			case "--help":
				printHelp();
				process.exit(0);
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function resolveConfigLayer(config: ZipItConfig, target: string | undefined): ZipItConfigLayer {
	const base: ZipItConfigLayer = {
		profile: config.profile,
		output: config.output,
		selection: config.selection,
		archive: config.archive,
		scope: config.scope,
		ignore: config.ignore,
		media: config.media,
	};

	if (!target) {
		return base;
	}

	const targetConfig = config.targets?.[target];

	if (!targetConfig) {
		const available = Object.keys(config.targets ?? {});
		const suffix = available.length > 0 ? ` Available targets: ${available.join(", ")}.` : "";
		throw new Error(`Unknown target: ${target}.${suffix}`);
	}

	return mergeConfigLayers(base, targetConfig);
}

function mergeConfigLayers(base: ZipItConfigLayer, override: ZipItConfigLayer): ZipItConfigLayer {
	return {
		profile: override.profile ?? base.profile,
		output: override.output ?? base.output,
		selection: { ...base.selection, ...override.selection },
		archive: { ...base.archive, ...override.archive },
		scope: { ...base.scope, ...override.scope },
		ignore: [...(base.ignore ?? []), ...(override.ignore ?? [])],
		media: { ...base.media, ...override.media },
	};
}

function parseConfig(value: unknown, configPath: string): ZipItConfig {
	if (!isRecord(value)) {
		throw new Error(`${configPath} must contain a JSON object.`);
	}

	const version = value.version === undefined ? undefined : readInteger(value.version, "version");
	if (version !== undefined && version !== 1 && version !== 2) {
		throw new Error(`Unsupported .zip-it.json version: ${version}. Expected 1 or 2.`);
	}

	const layer = parseConfigLayer(value, "");
	const defaultTarget = value.defaultTarget === undefined ? undefined : readString(value.defaultTarget, "defaultTarget");
	const targets = value.targets === undefined ? undefined : parseTargets(value.targets);

	if (defaultTarget && !targets?.[defaultTarget]) {
		throw new Error(`defaultTarget references unknown target: ${defaultTarget}.`);
	}

	return { version, ...layer, defaultTarget, targets };
}

function parseConfigLayer(value: Record<string, unknown>, prefix: string): ZipItConfigLayer {
	const field = (name: string): string => (prefix ? `${prefix}.${name}` : name);

	return {
		profile:
			value.profile === undefined
				? undefined
				: parseRequestedProfile(readString(value.profile, field("profile"))),
		output: value.output === undefined ? undefined : readString(value.output, field("output")),
		selection: value.selection === undefined ? undefined : parseSelectionConfig(value.selection, field("selection")),
		archive: value.archive === undefined ? undefined : parseArchiveConfig(value.archive, field("archive")),
		scope: value.scope === undefined ? undefined : parseScopeConfig(value.scope, field("scope")),
		ignore: value.ignore === undefined ? undefined : readStringArray(value.ignore, field("ignore")),
		media: value.media === undefined ? undefined : parseMediaConfig(value.media, field("media")),
	};
}

function parseTargets(value: unknown): Readonly<Record<string, ZipItConfigLayer>> {
	if (!isRecord(value)) {
		throw new Error("targets must be a JSON object.");
	}

	const result: Record<string, ZipItConfigLayer> = {};
	for (const [name, target] of Object.entries(value)) {
		if (!name.trim()) {
			throw new Error("target names must not be empty.");
		}
		if (!isRecord(target)) {
			throw new Error(`targets.${name} must be a JSON object.`);
		}
		result[name] = parseConfigLayer(target, `targets.${name}`);
	}
	return result;
}

function parseSelectionConfig(value: unknown, fieldName: string): ZipItConfigLayer["selection"] {
	if (!isRecord(value)) {
		throw new Error(`${fieldName} must be a JSON object.`);
	}
	return {
		mode: value.mode === undefined ? undefined : parseSelectionMode(readString(value.mode, `${fieldName}.mode`)),
	};
}

function parseArchiveConfig(value: unknown, fieldName: string): ZipItConfigLayer["archive"] {
	if (!isRecord(value)) {
		throw new Error(`${fieldName} must be a JSON object.`);
	}
	return {
		format:
			value.format === undefined
				? undefined
				: parseArchiveFormat(readString(value.format, `${fieldName}.format`)),
		compressionLevel:
			value.compressionLevel === undefined
				? undefined
				: readIntegerInRange(value.compressionLevel, `${fieldName}.compressionLevel`, 0, 9),
		smallFileBufferThreshold:
			value.smallFileBufferThreshold === undefined
				? undefined
				: readNonNegativeInteger(value.smallFileBufferThreshold, `${fieldName}.smallFileBufferThreshold`),
	};
}

function parseScopeConfig(value: unknown, fieldName: string): ZipItConfigLayer["scope"] {
	if (!isRecord(value)) {
		throw new Error(`${fieldName} must be a JSON object.`);
	}
	return {
		mode:
			value.mode === undefined ? undefined : parseScopeMode(readString(value.mode, `${fieldName}.mode`)),
		project: value.project === undefined ? undefined : readString(value.project, `${fieldName}.project`),
		includeRelatedTests:
			value.includeRelatedTests === undefined
				? undefined
				: readBoolean(value.includeRelatedTests, `${fieldName}.includeRelatedTests`),
		includeRootFiles:
			value.includeRootFiles === undefined
				? undefined
				: readBoolean(value.includeRootFiles, `${fieldName}.includeRootFiles`),
	};
}

function parseMediaConfig(value: unknown, fieldName: string): ZipItConfigLayer["media"] {
	if (!isRecord(value)) {
		throw new Error(`${fieldName} must be a JSON object.`);
	}

	return {
		minify: value.minify === undefined ? undefined : readBoolean(value.minify, `${fieldName}.minify`),
		mode:
			value.mode === undefined ? undefined : parseMediaMode(readString(value.mode, `${fieldName}.mode`)),
		keepVideoOriginals:
			value.keepVideoOriginals === undefined
				? undefined
				: readBoolean(value.keepVideoOriginals, `${fieldName}.keepVideoOriginals`),
		keepAudioOriginals:
			value.keepAudioOriginals === undefined
				? undefined
				: readBoolean(value.keepAudioOriginals, `${fieldName}.keepAudioOriginals`),
	};
}

function parseRequestedProfile(value: string): RequestedProfile {
	if (!isRequestedProfile(value)) {
		throw new Error(`Invalid profile: ${value}. Expected one of: ${PROFILE_VALUES.join(", ")}.`);
	}
	return value;
}

function parseMediaMode(value: string): MediaMode {
	if (!MEDIA_MODE_VALUES.includes(value as MediaMode)) {
		throw new Error(`Invalid media mode: ${value}. Expected one of: ${MEDIA_MODE_VALUES.join(", ")}.`);
	}
	return value as MediaMode;
}

function parseSelectionMode(value: string): SelectionMode {
	if (!SELECTION_MODE_VALUES.includes(value as SelectionMode)) {
		throw new Error(`Invalid selection mode: ${value}. Expected one of: ${SELECTION_MODE_VALUES.join(", ")}.`);
	}
	return value as SelectionMode;
}

function parseArchiveFormat(value: string): ArchiveFormat {
	if (!ARCHIVE_FORMAT_VALUES.includes(value as ArchiveFormat)) {
		throw new Error(`Invalid archive format: ${value}. Expected one of: ${ARCHIVE_FORMAT_VALUES.join(", ")}.`);
	}
	return value as ArchiveFormat;
}

function parseScopeMode(value: string): ScopeMode {
	if (!SCOPE_MODE_VALUES.includes(value as ScopeMode)) {
		throw new Error(`Invalid scope mode: ${value}. Expected one of: ${SCOPE_MODE_VALUES.join(", ")}.`);
	}
	return value as ScopeMode;
}

function parseVerbosityLevel(value: string): VerbosityLevel {
	if (value === "dev") {
		return 4;
	}
	return parseIntegerInRange(value, "verbose level", 0, 3) as VerbosityLevel;
}

function readOptionalVerbosityValue(argv: readonly string[], index: number): VerbosityLevel {
	if (!hasOptionalValue(argv, index)) {
		return 1;
	}
	return parseVerbosityLevel(argv[index + 1] ?? "");
}

function hasOptionalValue(argv: readonly string[], index: number): boolean {
	const next = argv[index + 1];
	return next !== undefined && !next.startsWith("-");
}

function requireValue(argv: readonly string[], index: number, optionName: string): string {
	const value = argv[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${optionName}`);
	}
	return value;
}

function defaultOutputPath(format: ArchiveFormat): string {
	return `.artifacts/project.${format}`;
}

function readString(value: unknown, fieldName: string): string {
	if (typeof value !== "string") {
		throw new Error(`${fieldName} must be a string.`);
	}
	return value;
}

function readStringArray(value: unknown, fieldName: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${fieldName} must be an array of strings.`);
	}
	return value;
}

function readBoolean(value: unknown, fieldName: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${fieldName} must be a boolean.`);
	}
	return value;
}

function readInteger(value: unknown, fieldName: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`${fieldName} must be an integer.`);
	}
	return value;
}

function readIntegerInRange(value: unknown, fieldName: string, min: number, max: number): number {
	const parsed = readInteger(value, fieldName);
	if (parsed < min || parsed > max) {
		throw new Error(`${fieldName} must be between ${min} and ${max}.`);
	}
	return parsed;
}

function readNonNegativeInteger(value: unknown, fieldName: string): number {
	const parsed = readInteger(value, fieldName);
	if (parsed < 0) {
		throw new Error(`${fieldName} must be greater than or equal to 0.`);
	}
	return parsed;
}

function parseIntegerInRange(value: string, fieldName: string, min: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`Invalid ${fieldName}. Expected an integer between ${min} and ${max}.`);
	}
	return parsed;
}

function parseNonNegativeInteger(value: string, fieldName: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`Invalid ${fieldName}. Expected a non-negative integer.`);
	}
	return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function printHelp(): void {
	console.log(`
@da-core/zip-it

Create a lightweight project archive. Source files are copied normally, while
image, video and audio assets can be replaced with tiny valid placeholders.

Usage:
zip-it [options]

Options:
--root <path>              Project root. Defaults to current working directory.
--output <path>            Output path. Defaults to .artifacts/project.<format>.
--target <name>            Apply a named target from .zip-it.json.
--profile <auto|node|python|dotnet|android|none>
                           Project profile. Defaults to auto.
--selection <auto|filesystem|git-visible|git-tracked>
                           File selection strategy. Auto prefers git-visible.
--format <zip|tar.gz|tar.xz|tar.zst>
                           Archive format. Defaults to zip.
--compression-level <0-9>  Compression level. Defaults to 6.
--small-file-buffer-threshold <bytes>
                           ZIP files at or below this size are buffered to reduce
                           per-entry metadata. Defaults to 262144.
--project <path.csproj>     Package a .NET project, transitive ProjectReference
                           dependencies and related test projects.
--no-related-tests         Do not include tests related to --project.
--no-root-files            Do not include repository-level support files in project scope.
--ignore <glob>            Additional ignore pattern. Can be used multiple times.
--dry-run                  Show the packaging plan without creating an archive.
--no-media-minify          Keep images, videos and audio unchanged.
--media-mode <tiny|preserve-shape>
                           Media minimization mode. Defaults to tiny.
--preserve-media-shape     Alias for --media-mode preserve-shape.
--keep-video-originals     Minify images/audio, but keep videos unchanged.
--keep-audio-originals     Minify images/videos, but keep audio unchanged.
-v, --verbose [0|1|2|3|dev]
                           Increase output detail. Repeated -v flags are supported.
-h, --help                 Show help.

Examples:
zip-it
zip-it --target review
zip-it --selection git-visible --media-mode preserve-shape
zip-it --format tar.zst --compression-level 9
zip-it --project src/MyApp/MyApp.csproj --format tar.gz
zip-it --ignore "src/**/Content/Generated/**"
`);
}
