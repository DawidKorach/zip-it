// src/project-architectures.ts

import fs from "node:fs";
import path from "node:path";

export type ProjectFileCandidate = Readonly<{
	directory: string;
	fileName: string;
	relativePath: string;
	fullPath: string;
}>;

export type ProjectDetectionContext = Readonly<{
	root: string;
	candidates: readonly ProjectFileCandidate[];
	fileExists: (relativePath: string) => Promise<boolean>;
	readTextFile: (relativePath: string, maxBytes?: number) => Promise<string | undefined>;
}>;

type ProjectArchitectureDefinition<TKind extends string> = Readonly<{
	kind: TKind;
	displayName: string;
	ignoreGroups: readonly string[];
	detect: (context: ProjectDetectionContext) => boolean | Promise<boolean>;
}>;

export const PROJECT_ARCHITECTURES = [
	{
		kind: "node",
		displayName: "Node",
		ignoreGroups: ["node"],
		detect: (context) => hasCandidateFileName(context, "package.json"),
	},
	{
		kind: "dotnet",
		displayName: ".NET",
		ignoreGroups: ["dotnet"],
		detect: (context) =>
			hasCandidateFileName(context, "global.json") ||
			hasCandidateFileName(context, "Directory.Build.props") ||
			hasCandidateFileName(context, "Directory.Build.targets") ||
			hasCandidateExtension(context, ".sln", ".slnx", ".csproj", ".fsproj", ".vbproj"),
	},
	{
		kind: "android",
		displayName: "Android Gradle",
		ignoreGroups: ["android"],
		detect: detectAndroidGradleProject,
	},
] as const satisfies readonly ProjectArchitectureDefinition<string>[];

export type ProjectKind = (typeof PROJECT_ARCHITECTURES)[number]["kind"];

export const PROJECT_KIND_VALUES = PROJECT_ARCHITECTURES.map((architecture) => architecture.kind) as ProjectKind[];

export function getProjectArchitecture(kind: ProjectKind): (typeof PROJECT_ARCHITECTURES)[number] {
	const architecture = PROJECT_ARCHITECTURES.find((candidate) => candidate.kind === kind);

	if (!architecture) {
		throw new Error(`Unknown project architecture: ${kind}`);
	}

	return architecture;
}

export async function createProjectDetectionContext(root: string): Promise<ProjectDetectionContext> {
	const resolvedRoot = path.resolve(root);
	const candidates = await getRootAndDirectChildFileCandidates(resolvedRoot);

	return {
		root: resolvedRoot,
		candidates,
		fileExists: async (relativePath) => safeFileExists(path.join(resolvedRoot, relativePath)),
		readTextFile: async (relativePath, maxBytes = 128 * 1024) => readTextFile(path.join(resolvedRoot, relativePath), maxBytes),
	};
}

function hasCandidateFileName(context: ProjectDetectionContext, ...fileNames: readonly string[]): boolean {
	const accepted = new Set(fileNames);

	return context.candidates.some((candidate) => accepted.has(candidate.fileName));
}

function hasCandidateExtension(context: ProjectDetectionContext, ...extensions: readonly string[]): boolean {
	const accepted = new Set(extensions);

	return context.candidates.some((candidate) => accepted.has(path.extname(candidate.fileName)));
}

async function detectAndroidGradleProject(context: ProjectDetectionContext): Promise<boolean> {
	const hasGradleSettings =
		hasRootCandidateFileName(context, "settings.gradle") || hasRootCandidateFileName(context, "settings.gradle.kts");

	if (!hasGradleSettings && !(await context.fileExists("gradle/wrapper/gradle-wrapper.properties"))) {
		return false;
	}

	if (await context.fileExists("app/src/main/AndroidManifest.xml")) {
		return true;
	}

	const androidBuildFiles = context.candidates.filter(
		(candidate) => candidate.fileName === "build.gradle" || candidate.fileName === "build.gradle.kts",
	);

	for (const buildFile of androidBuildFiles) {
		const content = await readTextFile(buildFile.fullPath);

		if (content && containsAndroidGradlePlugin(content)) {
			return true;
		}
	}

	return false;
}

function hasRootCandidateFileName(context: ProjectDetectionContext, ...fileNames: readonly string[]): boolean {
	const accepted = new Set(fileNames);

	return context.candidates.some((candidate) => candidate.directory === context.root && accepted.has(candidate.fileName));
}

function containsAndroidGradlePlugin(content: string): boolean {
	return (
		content.includes("com.android.application") ||
		content.includes("com.android.library") ||
		content.includes("com.android.test") ||
		content.includes("com.android.dynamic-feature")
	);
}

async function getRootAndDirectChildFileCandidates(root: string): Promise<ProjectFileCandidate[]> {
	const result: ProjectFileCandidate[] = [];
	const rootEntries = await safeReadDirectory(root);

	for (const entry of rootEntries) {
		if (entry.isFile()) {
			result.push(toCandidate(root, root, entry.name));
			continue;
		}

		if (!entry.isDirectory() || shouldSkipChildDirectory(entry.name)) {
			continue;
		}

		const childDirectory = path.join(root, entry.name);
		const childEntries = await safeReadDirectory(childDirectory);

		for (const childEntry of childEntries) {
			if (childEntry.isFile()) {
				result.push(toCandidate(root, childDirectory, childEntry.name));
			}
		}
	}

	return result;
}

function toCandidate(root: string, directory: string, fileName: string): ProjectFileCandidate {
	const fullPath = path.join(directory, fileName);

	return {
		directory,
		fileName,
		fullPath,
		relativePath: path.relative(root, fullPath).split(path.sep).join("/"),
	};
}

function shouldSkipChildDirectory(directoryName: string): boolean {
	return directoryName === ".git" || directoryName === "node_modules" || directoryName === ".gradle";
}

async function safeReadDirectory(directory: string): Promise<fs.Dirent[]> {
	try {
		return await fs.promises.readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
}

async function safeFileExists(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.promises.stat(filePath);

		return stat.isFile();
	} catch {
		return false;
	}
}

async function readTextFile(filePath: string, maxBytes = 128 * 1024): Promise<string | undefined> {
	try {
		const handle = await fs.promises.open(filePath, "r");

		try {
			const buffer = Buffer.alloc(maxBytes);
			const result = await handle.read(buffer, 0, maxBytes, 0);

			return buffer.subarray(0, result.bytesRead).toString("utf8");
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
}
