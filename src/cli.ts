// src/cli.ts

import { pathToFileURL } from "node:url";
import { getDefaultIgnorePatterns } from "./ignore-patterns.js";
import { detectProjectKinds, resolveProfile } from "./profile.js";
import { buildDryRunReport, printDryRunReport, printStartReport, printZipReport } from "./report.js";
import { buildFileEntries, scanProjectFiles } from "./scanner.js";
import { mergeOptions, parseRawCliOptions, readProjectConfig } from "./config.js";
import { createInitialStats, createZip, ensureOutputDir } from "./zip.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const rawCliOptions = parseRawCliOptions(argv);
	const root = rawCliOptions.root ?? process.cwd();
	const config = await readProjectConfig(root);
	const options = mergeOptions(rawCliOptions, config);
	const detected = await detectProjectKinds(options.root);
	const profile = resolveProfile(options.profile, detected);
	const ignorePatterns = [...getDefaultIgnorePatterns(profile.effectiveProfile), ...options.ignorePatterns];

	printStartReport(options, profile);
	console.log("🔍 Collecting files...");

	const scanResult = await scanProjectFiles(options.root, ignorePatterns);
	const entries = await buildFileEntries(options.root, scanResult.files);

	if (options.dryRun) {
		const dryRun = await buildDryRunReport(entries, options);
		printDryRunReport(
			options,
			profile,
			entries,
			scanResult.ignoredFiles,
			scanResult.ignoredDirectories,
			scanResult.sensitiveFiles,
			dryRun,
		);
		return;
	}

	await ensureOutputDir(options.output);
	console.log("📦 Creating ZIP...");

	const stats = createInitialStats(entries.length, scanResult.ignoredFiles, scanResult.ignoredDirectories);
	await createZip(entries, options, stats);
	printZipReport(options.output, profile, stats, scanResult.sensitiveFiles);
}

function isDirectExecution(): boolean {
	const entryPoint = process.argv[1];
	return entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;
}

if (isDirectExecution()) {
	main().catch((error: unknown) => {
		console.error("❌ Failed to create ZIP:", error);
		process.exit(1);
	});
}
