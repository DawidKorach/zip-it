// src/ignore-patterns.ts

import { PROJECT_KIND_VALUES, type EffectiveProfile } from "./types.js";

export const COMMON_IGNORE_PATTERNS = [
	".artifacts/**",
	"**/.artifacts/**",
	"**/.git/**",
	"**/*.zip",
	"**/*.log",
	"**/.DS_Store",
	"**/Thumbs.db",
] as const;

export const SECURITY_IGNORE_PATTERNS = [
	"**/.env",
	"**/.env.*",
	"**/*.pfx",
	"**/*.p12",
	"**/*.pem",
	"**/*.key",
	"**/*.jks",
	"**/*.keystore",
	"**/keystore.properties",
	"**/secrets.json",
	"**/appsettings.Local.json",
	"**/appsettings.*.Local.json",
] as const;

export const IDE_IGNORE_PATTERNS = [
	"**/.idea/caches/**",
	"**/.idea/httpRequests/**",
	"**/.idea/shelf/**",
	"**/.idea/workspace.xml",
	"**/.idea/tasks.xml",
	"**/.idea/usage.statistics.xml",
	"**/.idea/dictionaries/*_local.xml",
	"**/.idea/dataSources/**",
	"**/.idea/dataSources.local.xml",
	"**/.idea/**/workspace.xml",
	"**/.vscode/**",
	"**/.vs/**",
] as const;

export const NODE_IGNORE_PATTERNS = [
	"**/node_modules/**",
	"**/.next/**",
	"**/.nuxt/**",
	"**/.svelte-kit/**",
	"**/.astro/**",
	"**/dist/**",
	"**/coverage/**",
	"**/.turbo/**",
	"**/.nx/**",
	"**/.vite/**",
	"**/.parcel-cache/**",
	"**/.cache/**",
	"**/.vercel/**",
	"**/storybook-static/**",
	"**/.vitepress/dist/**",
	"**/.vuepress/dist/**",
	"**/playwright-report/**",
	"**/test-results/**",
	"**/*.tsbuildinfo",
] as const;

export const NODE_GLOBAL_BUILD_IGNORE_PATTERNS = ["**/build/**"] as const;

export const NODE_MIXED_BUILD_IGNORE_PATTERNS = [
	"frontend/build/**",
	"client/build/**",
	"web/build/**",
	"ui/build/**",
	"apps/*/build/**",
	"packages/*/build/**",
	"**/frontend/build/**",
	"**/client/build/**",
	"**/web/build/**",
	"**/ui/build/**",
] as const;

export const DOTNET_IGNORE_PATTERNS = [
	"**/bin/**",
	"**/obj/**",
	"**/TestResults/**",
	"**/BenchmarkDotNet.Artifacts/**",
	"**/coverage/**",
	"**/packages/**",
	"**/publish/**",
	"**/*.user",
	"**/*.rsuser",
	"**/*.suo",
	"**/*.userosscache",
	"**/*.sln.docstates",
	"**/*.nupkg",
	"**/*.snupkg",
	"**/Content/bin/**",
	"**/Content/obj/**",
] as const;

export const ANDROID_IGNORE_PATTERNS = [
	"**/.gradle/**",
	"**/.kotlin/**",
	"**/.cxx/**",
	"**/.externalNativeBuild/**",
	"**/captures/**",
	"**/*/build/**",
	"**/local.properties",
	"**/*.apk",
	"**/*.aab",
	"**/*.ap_",
	"**/*.dex",
	"**/*.hprof",
] as const;

export const ANDROID_ROOT_BUILD_IGNORE_PATTERNS = ["build/**"] as const;

const IGNORE_PATTERN_GROUPS = {
	common: COMMON_IGNORE_PATTERNS,
	security: SECURITY_IGNORE_PATTERNS,
	ide: IDE_IGNORE_PATTERNS,
	node: NODE_IGNORE_PATTERNS,
	"node-global-build": NODE_GLOBAL_BUILD_IGNORE_PATTERNS,
	"node-mixed-build-safety": NODE_MIXED_BUILD_IGNORE_PATTERNS,
	dotnet: DOTNET_IGNORE_PATTERNS,
	android: ANDROID_IGNORE_PATTERNS,
	"android-root-build": ANDROID_ROOT_BUILD_IGNORE_PATTERNS,
} as const;

export type IgnorePatternGroupName = keyof typeof IGNORE_PATTERN_GROUPS;

export function getIgnorePatternsForGroups(groupNames: readonly string[]): string[] {
	const patterns: string[] = [];

	for (const groupName of groupNames) {
		const group = IGNORE_PATTERN_GROUPS[groupName as IgnorePatternGroupName];

		if (group) {
			patterns.push(...group);
		}
	}

	return [...new Set(patterns)];
}

export function getDefaultIgnorePatterns(effectiveProfile: EffectiveProfile): string[] {
	const activeProjectKinds = effectiveProfile === "none" ? [] : effectiveProfile.split("+");
	const groups = ["common", "security", "ide"];

	for (const kind of PROJECT_KIND_VALUES) {
		if (activeProjectKinds.includes(kind)) {
			groups.push(kind);
		}
	}

	if (activeProjectKinds.includes("node")) {
		groups.push(activeProjectKinds.length === 1 ? "node-global-build" : "node-mixed-build-safety");
	}

	if (activeProjectKinds.includes("android") && !activeProjectKinds.includes("dotnet")) {
		groups.push("android-root-build");
	}

	return getIgnorePatternsForGroups(groups);
}
