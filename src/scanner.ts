// src/scanner.ts

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createGlobMatchers, matchesAny, toPosixPath } from "./glob.js";
import { SECURITY_IGNORE_PATTERNS } from "./ignore-patterns.js";
import { getFileKind } from "./media.js";
import type {
	EffectiveSelectionMode,
	FileEntry,
	ScanResult,
	SelectionMode,
} from "./types.js";

export async function scanProjectFiles(
	root: string,
	ignorePatterns: readonly string[],
	requestedSelectionMode: SelectionMode = "auto",
): Promise<ScanResult> {
	const selection = await resolveSelectionMode(root, requestedSelectionMode);

	if (selection.mode === "filesystem") {
		const result = await scanFileSystem(root, ignorePatterns);
		return { ...result, selectionMode: selection.mode, gitIgnoredFiles: 0, warnings: selection.warnings };
	}

	const result = await scanGitFiles(root, ignorePatterns, selection.mode);
	return { ...result, selectionMode: selection.mode, warnings: [...selection.warnings, ...result.warnings] };
}

export async function buildFileEntries(projectRoot: string, files: readonly string[]): Promise<FileEntry[]> {
	const securityMatchers = createGlobMatchers(SECURITY_IGNORE_PATTERNS);
	const entries = await Promise.all(
		files.map(async (file) => {
			const fullPath = path.join(projectRoot, file);
			const stat = await fs.promises.stat(fullPath);

			return {
				relativePath: file,
				fullPath,
				size: stat.size,
				kind: getFileKind(file),
				isSensitive: matchesAny(file, securityMatchers),
			};
		}),
	);

	return entries.sort((left, right) => comparePaths(left.relativePath, right.relativePath));
}

async function resolveSelectionMode(
	root: string,
	requestedMode: SelectionMode,
): Promise<{ mode: EffectiveSelectionMode; warnings: string[] }> {
	if (requestedMode === "filesystem") {
		return { mode: "filesystem", warnings: [] };
	}

	const gitStatus = await inspectGitRepository(root);

	if (requestedMode === "auto") {
		if (gitStatus.available && gitStatus.repository) {
			return { mode: "git-visible", warnings: [] };
		}

		const reason = !gitStatus.available ? "Git executable was not found" : "root is not a Git work tree";
		return {
			mode: "filesystem",
			warnings: [`Selection auto-fallback: ${reason}; filesystem selection was used.`],
		};
	}

	if (!gitStatus.available) {
		throw new Error(`Selection mode ${requestedMode} requires Git, but the git executable was not found.`);
	}
	if (!gitStatus.repository) {
		throw new Error(`Selection mode ${requestedMode} requires the root to be inside a Git work tree.`);
	}

	return { mode: requestedMode, warnings: [] };
}

async function inspectGitRepository(root: string): Promise<{ available: boolean; repository: boolean }> {
	try {
		const result = await runProcess("git", ["-C", root, "rev-parse", "--is-inside-work-tree"]);
		return { available: true, repository: result.exitCode === 0 && result.stdout.trim() === "true" };
	} catch (error) {
		if (isExecutableNotFound(error)) {
			return { available: false, repository: false };
		}
		return { available: true, repository: false };
	}
}

async function scanGitFiles(
	root: string,
	ignorePatterns: readonly string[],
	mode: "git-visible" | "git-tracked",
): Promise<Omit<ScanResult, "selectionMode">> {
	const args =
		mode === "git-visible"
			? ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"]
			: ["-C", root, "ls-files", "-z", "--cached"];
	const selected = await runGitPathList(args);
	const gitIgnoredFiles =
		mode === "git-visible"
			? (await runGitPathList(["-C", root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard"]))
					.length
			: 0;
	const ignoreMatchers = createGlobMatchers(ignorePatterns);
	const securityMatchers = createGlobMatchers(SECURITY_IGNORE_PATTERNS);
	const files: string[] = [];
	const sensitiveFiles: string[] = [];
	const warnings: string[] = [];
	let ignoredFiles = 0;

	for (const rawPath of selected) {
		const relativePath = normalizeGitPath(rawPath);
		if (!relativePath) {
			continue;
		}

		if (matchesAny(relativePath, securityMatchers)) {
			sensitiveFiles.push(relativePath);
		}
		if (matchesAny(relativePath, ignoreMatchers)) {
			ignoredFiles++;
			continue;
		}

		const fullPath = path.join(root, relativePath);
		const stat = await safeLstat(fullPath);
		if (!stat) {
			warnings.push(`Git selected ${relativePath}, but the file was not available in the work tree.`);
			continue;
		}
		if (stat.isSymbolicLink()) {
			warnings.push(`Symbolic link skipped: ${relativePath}.`);
			continue;
		}
		if (!stat.isFile()) {
			continue;
		}

		files.push(relativePath);
	}

	return {
		files: [...new Set(files)].sort(comparePaths),
		ignoredFiles,
		ignoredDirectories: 0,
		gitIgnoredFiles,
		sensitiveFiles: [...new Set(sensitiveFiles)].sort(comparePaths),
		warnings,
	};
}

async function scanFileSystem(
	root: string,
	ignorePatterns: readonly string[],
): Promise<Omit<ScanResult, "selectionMode" | "gitIgnoredFiles" | "warnings">> {
	const ignoreMatchers = createGlobMatchers(ignorePatterns);
	const securityMatchers = createGlobMatchers(SECURITY_IGNORE_PATTERNS);
	const files: string[] = [];
	const sensitiveFiles: string[] = [];
	let ignoredFiles = 0;
	let ignoredDirectories = 0;

	async function walk(directory: string, relativeDirectory: string): Promise<void> {
		const entries = await safeReadDirectory(directory);

		for (const entry of entries) {
			const relativePath = toPosixPath(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
			const fullPath = path.join(directory, entry.name);

			if (entry.isSymbolicLink()) {
				continue;
			}

			if (entry.isDirectory()) {
				if (matchesAny(`${relativePath}/`, ignoreMatchers)) {
					ignoredDirectories++;
					continue;
				}
				await walk(fullPath, relativePath);
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			if (matchesAny(relativePath, securityMatchers)) {
				sensitiveFiles.push(relativePath);
			}
			if (matchesAny(relativePath, ignoreMatchers)) {
				ignoredFiles++;
				continue;
			}
			files.push(relativePath);
		}
	}

	await walk(root, "");

	return {
		files: files.sort(comparePaths),
		ignoredFiles,
		ignoredDirectories,
		sensitiveFiles: sensitiveFiles.sort(comparePaths),
	};
}

async function runGitPathList(args: readonly string[]): Promise<string[]> {
	const result = await runProcess("git", args);
	if (result.exitCode !== 0) {
		throw new Error(`Git command failed: git ${args.join(" ")}\n${result.stderr.trim()}`);
	}
	return result.stdout.split("\0").filter(Boolean);
}

async function runProcess(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (exitCode) => {
			resolve({
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				exitCode: exitCode ?? 1,
			});
		});
	});
}

function isExecutableNotFound(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function normalizeGitPath(value: string): string {
	const normalized = toPosixPath(value).replace(/^\.\//, "");
	if (!normalized || normalized === "." || normalized.startsWith("../") || path.isAbsolute(normalized)) {
		return "";
	}
	return normalized;
}

async function safeLstat(filePath: string): Promise<fs.Stats | undefined> {
	try {
		return await fs.promises.lstat(filePath);
	} catch {
		return undefined;
	}
}

async function safeReadDirectory(directory: string): Promise<fs.Dirent[]> {
	try {
		return (await fs.promises.readdir(directory, { withFileTypes: true })).sort((left, right) =>
			comparePaths(left.name, right.name),
		);
	} catch {
		return [];
	}
}

function comparePaths(left: string, right: string): number {
	return left.localeCompare(right, "en", { sensitivity: "base" });
}
