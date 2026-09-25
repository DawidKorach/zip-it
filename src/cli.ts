// src/cli.ts

import { pathToFileURL } from "node:url";
import { ActivityReporter } from "./activity.js";
import { mergeOptions, parseRawCliOptions, readProjectConfig } from "./config.js";
import { getGitSelectionIgnorePatternsForGroups, getIgnorePatternsForGroups } from "./ignore-patterns.js";
import { detectProjectKinds, resolveProfile } from "./profile.js";
import { applyProjectScope } from "./project-scope.js";
import { buildDryRunReport, printDryRunReport, printStartReport, printZipReport } from "./report.js";
import { buildFileEntries, scanProjectFiles } from "./scanner.js";
import { createArchive, createInitialStats, ensureOutputDir } from "./zip.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const rawCliOptions = parseRawCliOptions(argv);
	const root = rawCliOptions.root ?? process.cwd();
	const config = await readProjectConfig(root);
	const options = mergeOptions(rawCliOptions, config);
	const detected = await detectProjectKinds(options.root);
	const profile = resolveProfile(options.profile, detected);
	const filesystemIgnorePatterns = [
		...getIgnorePatternsForGroups(profile.activeIgnoreGroups),
		...options.ignorePatterns,
	];
	const gitIgnorePatterns = [
		...getGitSelectionIgnorePatternsForGroups(profile.activeIgnoreGroups),
		...options.ignorePatterns,
	];
	const activity = new ActivityReporter(options.verbosity);

	printStartReport(options, profile);

	try {
		activity.update("🔍 Collecting files...");

		const scanResult = await scanProjectFiles(
			options.root,
			filesystemIgnorePatterns,
			options.selection.mode,
			gitIgnorePatterns,
		);
		const scopeResult = await applyProjectScope(options.root, scanResult.files, options.scope);
		const entries = await buildFileEntries(options.root, scopeResult.files);

		if (options.dryRun) {
			activity.stop();
			const dryRun = await buildDryRunReport(entries, options);
			printDryRunReport(options, profile, entries, scanResult, scopeResult, dryRun);
			return;
		}

		await ensureOutputDir(options.output);
		activity.update(`📦 Creating ${options.archive.format} archive...`);

		const stats = createInitialStats(
			entries.length,
			scanResult.ignoredFiles,
			scanResult.ignoredDirectories,
			scanResult.gitIgnoredFiles,
			scopeResult.excludedFiles,
		);
		let lastLoggedEntryBucket = -1;
		await createArchive(entries, options, stats, (event) => {
			switch (event.phase) {
				case "entries": {
					const bucket =
						event.total === 0 ? 20 : Math.min(20, Math.floor((event.completed * 20) / event.total));
					const shouldLog = bucket !== lastLoggedEntryBucket;
					if (shouldLog) {
						lastLoggedEntryBucket = bucket;
					}
					activity.update(`📦 Packing files: ${event.completed}/${event.total}`, shouldLog);
					break;
				}
				case "finalizing":
					activity.update("🗜️ Finalizing archive...");
					break;
				case "metadata":
					activity.update("🔎 Reading archive metadata...");
					break;
				case "hashing":
					activity.update("🔐 Calculating SHA-256...");
					break;
			}
		});

		activity.stop();
		printZipReport(options.output, profile, stats, scanResult, scopeResult, entries, options);
	} finally {
		activity.stop();
	}
}

function isDirectExecution(): boolean {
	const entryPoint = process.argv[1];
	return entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;
}

if (isDirectExecution()) {
	main().catch((error: unknown) => {
		console.error("❌ Failed to create archive:", error);
		process.exit(1);
	});
}
