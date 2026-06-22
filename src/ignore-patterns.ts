// src/ignore-patterns.ts

import type { EffectiveProfile } from "./types.js";

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
	"**/*.keystore",
	"**/secrets.json",
	"**/appsettings.Local.json",
	"**/appsettings.*.Local.json",
] as const;

export const IDE_IGNORE_PATTERNS = ["**/.idea/**", "**/.vscode/**", "**/.vs/**"] as const;

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

export function getDefaultIgnorePatterns(effectiveProfile: EffectiveProfile): string[] {
	const patterns: string[] = [...COMMON_IGNORE_PATTERNS, ...SECURITY_IGNORE_PATTERNS, ...IDE_IGNORE_PATTERNS];

	if (effectiveProfile === "node" || effectiveProfile === "node+dotnet") {
		patterns.push(...NODE_IGNORE_PATTERNS);
		patterns.push(
			...(effectiveProfile === "node+dotnet"
				? NODE_MIXED_BUILD_IGNORE_PATTERNS
				: NODE_GLOBAL_BUILD_IGNORE_PATTERNS),
		);
	}

	if (effectiveProfile === "dotnet" || effectiveProfile === "node+dotnet") {
		patterns.push(...DOTNET_IGNORE_PATTERNS);
	}

	return patterns;
}
