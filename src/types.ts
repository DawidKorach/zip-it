// src/types.ts

export const PROFILE_VALUES = ["auto", "node", "dotnet", "none"] as const;
export const MEDIA_MODE_VALUES = ["tiny", "preserve-shape"] as const;

export type RequestedProfile = (typeof PROFILE_VALUES)[number];
export type MediaMode = (typeof MEDIA_MODE_VALUES)[number];
export type EffectiveProfile = "node" | "dotnet" | "node+dotnet" | "none";

export type DetectedProjectKinds = Readonly<{
	node: boolean;
	dotnet: boolean;
}>;

export type ProfileResolution = Readonly<{
	requestedProfile: RequestedProfile;
	effectiveProfile: EffectiveProfile;
	detected: DetectedProjectKinds;
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
