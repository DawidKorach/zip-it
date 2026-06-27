// src/config.ts

import fs from "node:fs";
import path from "node:path";
import { isRequestedProfile } from "./profile.js";
import { MEDIA_MODE_VALUES, PROFILE_VALUES } from "./types.js";
import type { CliOptions, MediaMode, RawCliOptions, RequestedProfile, VerbosityLevel, ZipItConfig } from "./types.js";

export const DEFAULT_OUTPUT_PATH = ".artifacts/project.zip";
export const CONFIG_FILE_NAME = ".zip-it.json";

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
	const outputValue = rawCliOptions.output ?? config.output ?? DEFAULT_OUTPUT_PATH;
	const output = path.isAbsolute(outputValue) ? outputValue : path.join(root, outputValue);
	const profile = rawCliOptions.profile ?? config.profile ?? "auto";

	const minifyMedia = rawCliOptions.minifyMedia ?? config.media?.minify ?? true;
	const mediaMode = rawCliOptions.mediaMode ?? config.media?.mode ?? "tiny";
	const keepVideoOriginals = rawCliOptions.keepVideoOriginals ?? config.media?.keepVideoOriginals ?? false;
	const keepAudioOriginals = rawCliOptions.keepAudioOriginals ?? config.media?.keepAudioOriginals ?? false;
	const ignorePatterns = [...(config.ignore ?? []), ...rawCliOptions.ignorePatterns];
	const verbosity = rawCliOptions.verbosity ?? 0;

	return {
		root,
		output,
		profile,
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
			case "--profile":
				options.profile = parseRequestedProfile(requireValue(argv, ++index, "--profile"));
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

function parseConfig(value: unknown, configPath: string): ZipItConfig {
	if (!isRecord(value)) {
		throw new Error(`${configPath} must contain a JSON object.`);
	}

	const profile =
		value.profile === undefined ? undefined : parseRequestedProfile(readString(value.profile, "profile"));
	const output = value.output === undefined ? undefined : readString(value.output, "output");
	const ignore = value.ignore === undefined ? undefined : readStringArray(value.ignore, "ignore");
	const media = value.media === undefined ? undefined : parseMediaConfig(value.media);

	return { profile, output, ignore, media };
}

function parseMediaConfig(value: unknown): ZipItConfig["media"] {
	if (!isRecord(value)) {
		throw new Error("media must be a JSON object.");
	}

	return {
		minify: value.minify === undefined ? undefined : readBoolean(value.minify, "media.minify"),
		mode: value.mode === undefined ? undefined : parseMediaMode(readString(value.mode, "media.mode")),
		keepVideoOriginals:
			value.keepVideoOriginals === undefined
				? undefined
				: readBoolean(value.keepVideoOriginals, "media.keepVideoOriginals"),
		keepAudioOriginals:
			value.keepAudioOriginals === undefined
				? undefined
				: readBoolean(value.keepAudioOriginals, "media.keepAudioOriginals"),
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
		throw new Error(`Invalid media mode: ${value}. Expected one of: tiny, preserve-shape.`);
	}

	return value as MediaMode;
}

function parseVerbosityLevel(value: string): VerbosityLevel {
	if (value === "dev") {
		return 4;
	}

	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
		throw new Error("Invalid verbose level. Expected one of: 0, 1, 2, 3, dev.");
	}

	return parsed as VerbosityLevel;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function printHelp(): void {
	console.log(`
@da-core/zip-it

Create a lightweight project ZIP archive. Source files are copied normally, while
image, video and audio assets can be replaced inside the ZIP with tiny valid placeholders.

Usage:
zip-it [options]

Options:
--root <path>              Project root. Defaults to current working directory.
--output <path>            Output ZIP path. Defaults to .artifacts/project.zip.
--profile <auto|node|dotnet|android|none>
                           Project profile. Defaults to auto.
--ignore <glob>            Additional ignore pattern. Can be used multiple times.
--dry-run                  Show the packaging plan without creating a ZIP.
--no-media-minify          Keep images, videos and audio unchanged.
--media-mode <tiny|preserve-shape>
                           Media minimization mode. Defaults to tiny.
--preserve-media-shape     Alias for --media-mode preserve-shape.
--keep-video-originals     Minify images/audio, but keep videos unchanged.
--keep-audio-originals     Minify images/videos, but keep audio unchanged.
-v, --verbose [0|1|2|3|dev]
                           Increase output detail. Without a value, uses level 1.
                           Repeated -v flags are supported: -v, -vv, -vvv, -vvvv.
-h, --help                 Show help.

Verbosity:
0                          Compact summary only. Default.
1                          Human-friendly details, progress and largest files.
2                          Diagnostic profile/media details.
3                          Full included-file listing.
dev                        Level 3 plus resolved CLI internals.

Examples:
zip-it
zip-it --profile dotnet
zip-it --profile android
zip-it --profile android --dry-run
zip-it --profile android -v
zip-it --profile android --verbose 2
zip-it --profile android --verbose dev
zip-it --profile dotnet --media-mode preserve-shape
zip-it --output .artifacts/code-only.zip
zip-it --root ../my-project --output ../my-project.zip
zip-it --ignore "coverage/**" --ignore "tmp/**"
`);
}
