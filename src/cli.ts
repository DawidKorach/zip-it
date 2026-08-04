// src/cli.ts

import { pathToFileURL } from "node:url";
import { mergeOptions, parseRawCliOptions, readProjectConfig } from "./config.js";
import { getIgnorePatternsForGroups } from "./ignore-patterns.js";
import { detectProjectKinds, resolveProfile } from "./profile.js";
import { applyProjectScope } from "./project-scope.js";
import { buildDryRunReport, printDryRunReport, printProgress, printStartReport, printZipReport } from "./report.js";
import { buildFileEntries, scanProjectFiles } from "./scanner.js";
import { createArchive, createInitialStats, ensureOutputDir } from "./zip.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const rawCliOptions = parseRawCliOptions(argv);
	const root = rawCliOptions.root ?? process.cwd();
	const config = await readProjectConfig(root);
	const options = mergeOptions(rawCliOptions, config);
	const detected = await detectProjectKinds(options.root);
	const profile = resolveProfile(options.profile, detected);
	const ignorePatterns = [...getIgnorePatternsForGroups(profile.activeIgnoreGroups), ...options.ignorePatterns];

	printStartReport(options, profile);
	printProgress("🔍 Collecting files...", options.verbosity);

	const scanResult = await scanProjectFiles(options.root, ignorePatterns, options.selection.mode);
	const scopeResult = await applyProjectScope(options.root, scanResult.files, options.scope);
	const entries = await buildFileEntries(options.root, scopeResult.files);

	if (options.dryRun) {
		const dryRun = await buildDryRunReport(entries, options);
		printDryRunReport(options, profile, entries, scanResult, scopeResult, dryRun);
		return;
	}

	await ensureOutputDir(options.output);
	printProgress(`📦 Creating ${options.archive.format} archive...`, options.verbosity);

	const stats = createInitialStats(
		entries.length,
		scanResult.ignoredFiles,
		scanResult.ignoredDirectories,
		scanResult.gitIgnoredFiles,
		scopeResult.excludedFiles,
	);
	await createArchive(entries, options, stats);
	printZipReport(options.output, profile, stats, scanResult, scopeResult, entries, options);
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
