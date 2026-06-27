// src/types.ts

import { PROJECT_KIND_VALUES, type ProjectKind } from "./project-architectures.js";

export { PROJECT_KIND_VALUES, type ProjectKind } from "./project-architectures.js";

export const PROFILE_VALUES = ["auto", ...PROJECT_KIND_VALUES, "none"] as const;
export const MEDIA_MODE_VALUES = ["tiny", "preserve-shape"] as const;
export const VERBOSITY_LEVEL_VALUES = [0, 1, 2, 3, 4] as const;

export type RequestedProfile = "auto" | ProjectKind | "none";
export type MediaMode = (typeof MEDIA_MODE_VALUES)[number];
export type VerbosityLevel = (typeof VERBOSITY_LEVEL_VALUES)[number];
export type EffectiveProfile = string;

export type DetectedProjectKinds = Readonly<Record<ProjectKind, boolean>>;

export type ProfileResolution = Readonly<{
	requestedProfile: RequestedProfile;
	effectiveProfile: EffectiveProfile;
	detected: DetectedProjectKinds;
	activeProjectKinds: readonly ProjectKind[];
	activeIgnoreGroups: readonly string[];
}>;

export type MediaOptions = Readonly<{
	minify: boolean;
	mode: MediaMode;
	keepVideoOriginals: boolean;
	keepAudioOriginals: boolean;
}>;

export type CliOptions = Readonly<{
	root: string;
	output: string;
	profile: RequestedProfile;
	media: MediaOptions;
	ignorePatterns: readonly string[];
	dryRun: boolean;
	verbosity: VerbosityLevel;
}>;

export type RawCliOptions = {
	root?: string;
	output?: string;
	profile?: RequestedProfile;
	ignorePatterns: string[];
	minifyMedia?: boolean;
	mediaMode?: MediaMode;
	keepVideoOriginals?: boolean;
	keepAudioOriginals?: boolean;
	dryRun?: boolean;
	verbosity?: VerbosityLevel;
};

export type ZipItConfig = Readonly<{
	profile?: RequestedProfile;
	output?: string;
	ignore?: readonly string[];
	media?: Readonly<{
		minify?: boolean;
		mode?: MediaMode;
		keepVideoOriginals?: boolean;
		keepAudioOriginals?: boolean;
	}>;
}>;

export type FileKind = "normal" | "image" | "video" | "audio";

export type FileEntry = Readonly<{
	relativePath: string;
	fullPath: string;
	size: number;
	kind: FileKind;
	isSensitive: boolean;
}>;

export type ScanResult = Readonly<{
	files: readonly string[];
	ignoredFiles: number;
	ignoredDirectories: number;
	sensitiveFiles: readonly string[];
}>;

export type ZipStats = {
	originalTotalSize: number;
	zippedInputSize: number;
	includedFiles: number;
	ignoredFiles: number;
	ignoredDirectories: number;
	replacedImageFiles: number;
	preservedShapeImageFiles: number;
	keptOriginalImageFiles: number;
	replacedVideoFiles: number;
	replacedAudioFiles: number;
	keptOriginalVideoFiles: number;
	keptOriginalAudioFiles: number;
	warnings: string[];
};

export type DryRunReport = Readonly<{
	largestFiles: readonly FileEntry[];
	mediaReplacementPlan: Readonly<{
		images: number;
		videos: number;
		audio: number;
		keptVideos: number;
		keptAudio: number;
	}>;
	warnings: readonly string[];
}>;
