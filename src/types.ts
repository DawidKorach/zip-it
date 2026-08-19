// src/types.ts

import { PROJECT_KIND_VALUES, type ProjectKind } from "./project-architectures.js";

export { PROJECT_KIND_VALUES, type ProjectKind } from "./project-architectures.js";

export const PROFILE_VALUES = ["auto", ...PROJECT_KIND_VALUES, "none"] as const;
export const MEDIA_MODE_VALUES = ["tiny", "preserve-shape"] as const;
export const VERBOSITY_LEVEL_VALUES = [0, 1, 2, 3, 4] as const;
export const SELECTION_MODE_VALUES = ["auto", "filesystem", "git-visible", "git-tracked"] as const;
export const ARCHIVE_FORMAT_VALUES = ["zip", "tar.gz", "tar.xz", "tar.zst"] as const;
export const SCOPE_MODE_VALUES = ["full", "dotnet-project"] as const;

export type RequestedProfile = "auto" | ProjectKind | "none";
export type MediaMode = (typeof MEDIA_MODE_VALUES)[number];
export type VerbosityLevel = (typeof VERBOSITY_LEVEL_VALUES)[number];
export type SelectionMode = (typeof SELECTION_MODE_VALUES)[number];
export type EffectiveSelectionMode = Exclude<SelectionMode, "auto">;
export type ArchiveFormat = (typeof ARCHIVE_FORMAT_VALUES)[number];
export type ScopeMode = (typeof SCOPE_MODE_VALUES)[number];
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

export type OverrideOptions = Readonly<{
	emptyPatterns: readonly string[];
}>;

export type SelectionOptions = Readonly<{
	mode: SelectionMode;
}>;

export type ArchiveOptions = Readonly<{
	format: ArchiveFormat;
	compressionLevel: number;
	smallFileBufferThreshold: number;
}>;

export type ScopeOptions = Readonly<{
	mode: ScopeMode;
	project?: string;
	includeRelatedTests: boolean;
	includeRootFiles: boolean;
}>;

export type CliOptions = Readonly<{
	root: string;
	output: string;
	target?: string;
	profile: RequestedProfile;
	selection: SelectionOptions;
	archive: ArchiveOptions;
	scope: ScopeOptions;
	media: MediaOptions;
	overrides: OverrideOptions;
	ignorePatterns: readonly string[];
	dryRun: boolean;
	verbosity: VerbosityLevel;
}>;

export type RawCliOptions = {
	root?: string;
	output?: string;
	target?: string;
	profile?: RequestedProfile;
	selectionMode?: SelectionMode;
	archiveFormat?: ArchiveFormat;
	compressionLevel?: number;
	smallFileBufferThreshold?: number;
	project?: string;
	includeRelatedTests?: boolean;
	includeRootFiles?: boolean;
	ignorePatterns: string[];
	minifyMedia?: boolean;
	mediaMode?: MediaMode;
	keepVideoOriginals?: boolean;
	keepAudioOriginals?: boolean;
	emptyPatterns?: string[];
	dryRun?: boolean;
	verbosity?: VerbosityLevel;
};

export type ZipItConfigLayer = Readonly<{
	profile?: RequestedProfile;
	output?: string;
	selection?: Readonly<{
		mode?: SelectionMode;
	}>;
	archive?: Readonly<{
		format?: ArchiveFormat;
		compressionLevel?: number;
		smallFileBufferThreshold?: number;
	}>;
	scope?: Readonly<{
		mode?: ScopeMode;
		project?: string;
		includeRelatedTests?: boolean;
		includeRootFiles?: boolean;
	}>;
	ignore?: readonly string[];
	media?: Readonly<{
		minify?: boolean;
		mode?: MediaMode;
		keepVideoOriginals?: boolean;
		keepAudioOriginals?: boolean;
	}>;
	overrides?: Readonly<{
		empty?: readonly string[];
	}>;
}>;

export type ZipItConfig = ZipItConfigLayer &
	Readonly<{
		version?: number;
		defaultTarget?: string;
		targets?: Readonly<Record<string, ZipItConfigLayer>>;
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
	gitIgnoredFiles: number;
	selectionMode: EffectiveSelectionMode;
	sensitiveFiles: readonly string[];
	warnings: readonly string[];
}>;

export type ScopeResult = Readonly<{
	files: readonly string[];
	mode: ScopeMode;
	rootProject?: string;
	projects: readonly string[];
	excludedFiles: number;
	warnings: readonly string[];
}>;

export type ArchiveDiagnostics = Readonly<{
	archiveSize: number;
	compressedPayloadSize?: number;
	archiveMetadataSize?: number;
}>;

export type ZipStats = {
	originalTotalSize: number;
	archiveInputSize: number;
	archiveSize: number;
	archiveSha256: string;
	compressedPayloadSize?: number;
	archiveMetadataSize?: number;
	includedFiles: number;
	ignoredFiles: number;
	ignoredDirectories: number;
	gitIgnoredFiles: number;
	scopeExcludedFiles: number;
	replacedImageFiles: number;
	preservedShapeImageFiles: number;
	keptOriginalImageFiles: number;
	replacedVideoFiles: number;
	replacedAudioFiles: number;
	keptOriginalVideoFiles: number;
	keptOriginalAudioFiles: number;
	emptiedFiles: number;
	warnings: string[];
};

export type DryRunReport = Readonly<{
	largestFiles: readonly FileEntry[];
	emptyFilePlan: Readonly<{
		files: number;
	}>;
	mediaReplacementPlan: Readonly<{
		images: number;
		videos: number;
		audio: number;
		keptVideos: number;
		keptAudio: number;
	}>;
	warnings: readonly string[];
}>;
