// src/profile.ts

import {
	createProjectDetectionContext,
	getProjectArchitecture,
	PROJECT_ARCHITECTURES,
	PROJECT_KIND_VALUES,
	type ProjectKind,
} from "./project-architectures.js";
import type { DetectedProjectKinds, EffectiveProfile, ProfileResolution, RequestedProfile } from "./types.js";

export function isRequestedProfile(value: string): value is RequestedProfile {
	return value === "auto" || value === "none" || PROJECT_KIND_VALUES.includes(value as ProjectKind);
}

export async function detectProjectKinds(root: string): Promise<DetectedProjectKinds> {
	const context = await createProjectDetectionContext(root);
	const detectedEntries = await Promise.all(
		PROJECT_ARCHITECTURES.map(
			async (architecture) => [architecture.kind, await architecture.detect(context)] as const,
		),
	);

	return Object.fromEntries(detectedEntries) as DetectedProjectKinds;
}

export function resolveProfile(requestedProfile: RequestedProfile, detected: DetectedProjectKinds): ProfileResolution {
	const activeProjectKinds = getActiveProjectKinds(requestedProfile, detected);
	const effectiveProfile = getEffectiveProfile(activeProjectKinds);
	const activeIgnoreGroups = getActiveIgnoreGroups(activeProjectKinds);

	return {
		requestedProfile,
		effectiveProfile,
		detected,
		activeProjectKinds,
		activeIgnoreGroups,
	};
}

function getActiveProjectKinds(requestedProfile: RequestedProfile, detected: DetectedProjectKinds): ProjectKind[] {
	if (requestedProfile === "none") {
		return [];
	}

	if (requestedProfile !== "auto") {
		return [requestedProfile];
	}

	return PROJECT_KIND_VALUES.filter((kind) => detected[kind]);
}

function getEffectiveProfile(activeProjectKinds: readonly ProjectKind[]): EffectiveProfile {
	return activeProjectKinds.length === 0 ? "none" : activeProjectKinds.join("+");
}

function getActiveIgnoreGroups(activeProjectKinds: readonly ProjectKind[]): string[] {
	const groups = ["common", "security", "ide"];

	for (const kind of activeProjectKinds) {
		groups.push(...getProjectArchitecture(kind).ignoreGroups);
	}

	if (activeProjectKinds.includes("node")) {
		groups.push(activeProjectKinds.length === 1 ? "node-global-build" : "node-mixed-build-safety");
	}

	if (activeProjectKinds.includes("android") && !activeProjectKinds.includes("dotnet")) {
		groups.push("android-root-build");
	}

	return groups;
}
