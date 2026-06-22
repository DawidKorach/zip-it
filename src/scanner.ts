// src/scanner.ts

import fs from "node:fs";
import path from "node:path";
import { createGlobMatchers, matchesAny, toPosixPath } from "./glob.js";
import { SECURITY_IGNORE_PATTERNS } from "./ignore-patterns.js";
import { getFileKind } from "./media.js";
import type { FileEntry, ScanResult } from "./types.js";

export async function scanProjectFiles(root: string, ignorePatterns: readonly string[]): Promise<ScanResult> {
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

export async function buildFileEntries(projectRoot: string, files: readonly string[]): Promise<FileEntry[]> {
	const entries = await Promise.all(
		files.map(async (file) => {
			const fullPath = path.join(projectRoot, file);
			const stat = await fs.promises.stat(fullPath);

			return {
				relativePath: file,
				fullPath,
				size: stat.size,
				kind: getFileKind(file),
				isSensitive: matchesAny(file, createGlobMatchers(SECURITY_IGNORE_PATTERNS)),
			};
		}),
	);

	return entries.sort((left, right) => comparePaths(left.relativePath, right.relativePath));
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
