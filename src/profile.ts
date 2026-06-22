// src/profile.ts

import fs from "node:fs";
import path from "node:path";
import type { DetectedProjectKinds, EffectiveProfile, ProfileResolution, RequestedProfile } from "./types.js";

const DOTNET_MARKER_FILE_NAMES = new Set(["global.json", "Directory.Build.props", "Directory.Build.targets"]);
const DOTNET_PROJECT_EXTENSIONS = new Set([".sln", ".slnx", ".csproj", ".fsproj", ".vbproj"]);

export function isRequestedProfile(value: string): value is RequestedProfile {
	return value === "auto" || value === "node" || value === "dotnet" || value === "none";
}

export async function detectProjectKinds(root: string): Promise<DetectedProjectKinds> {
	const candidates = await getRootAndDirectChildFileNames(root);

	return {
		node: candidates.some((candidate) => candidate.fileName === "package.json"),
		dotnet: candidates.some((candidate) => isDotnetMarker(candidate.fileName)),
	};
}

export function resolveProfile(requestedProfile: RequestedProfile, detected: DetectedProjectKinds): ProfileResolution {
	const effectiveProfile = getEffectiveProfile(requestedProfile, detected);
	const activeIgnoreGroups = getActiveIgnoreGroups(effectiveProfile);

	return {
		requestedProfile,
		effectiveProfile,
		detected,
		activeIgnoreGroups,
	};
}

function getEffectiveProfile(requestedProfile: RequestedProfile, detected: DetectedProjectKinds): EffectiveProfile {
	switch (requestedProfile) {
		case "node":
			return "node";
		case "dotnet":
			return "dotnet";
		case "none":
			return "none";
		case "auto":
			if (detected.node && detected.dotnet) {
				return "node+dotnet";
			}

			if (detected.dotnet) {
				return "dotnet";
			}

			if (detected.node) {
				return "node";
			}

			return "none";
	}
}

function getActiveIgnoreGroups(effectiveProfile: EffectiveProfile): string[] {
	const groups = ["common", "security", "ide"];

	if (effectiveProfile === "node" || effectiveProfile === "node+dotnet") {
		groups.push("node");
	}

	if (effectiveProfile === "dotnet" || effectiveProfile === "node+dotnet") {
		groups.push("dotnet");
	}

	if (effectiveProfile === "node+dotnet") {
		groups.push("mixed-build-safety");
	}

	return groups;
}

async function getRootAndDirectChildFileNames(root: string): Promise<Array<{ directory: string; fileName: string }>> {
	const result: Array<{ directory: string; fileName: string }> = [];
	const rootEntries = await safeReadDirectory(root);

	for (const entry of rootEntries) {
		if (entry.isFile()) {
			result.push({ directory: root, fileName: entry.name });
			continue;
		}

		if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") {
			continue;
		}

		const childDirectory = path.join(root, entry.name);
		const childEntries = await safeReadDirectory(childDirectory);

		for (const childEntry of childEntries) {
			if (childEntry.isFile()) {
				result.push({ directory: childDirectory, fileName: childEntry.name });
			}
		}
	}

	return result;
}

async function safeReadDirectory(directory: string): Promise<fs.Dirent[]> {
	try {
		return await fs.promises.readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
}

function isDotnetMarker(fileName: string): boolean {
	return DOTNET_MARKER_FILE_NAMES.has(fileName) || DOTNET_PROJECT_EXTENSIONS.has(path.extname(fileName));
}
