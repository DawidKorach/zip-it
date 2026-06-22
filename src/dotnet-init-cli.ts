// src/dotnet-init-cli.ts

import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SOLUTION_ITEM_ZIP_PATH, runDotnetInit } from "./dotnet-solution-items.js";

type RawDotnetInitOptions = {
	root?: string;
	solution?: string;
	zipPath?: string;
	dryRun: boolean;
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const rawOptions = parseRawDotnetInitOptions(argv);
	const root = path.resolve(rawOptions.root ?? process.cwd());
	const result = await runDotnetInit({
		root,
		solution: rawOptions.solution,
		zipPath: rawOptions.zipPath ?? DEFAULT_SOLUTION_ITEM_ZIP_PATH,
		dryRun: rawOptions.dryRun,
	});

	printResult(result);
}

export function parseRawDotnetInitOptions(argv: readonly string[]): RawDotnetInitOptions {
	const options: RawDotnetInitOptions = {
		dryRun: false,
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];

		switch (arg) {
			case "--root":
				options.root = path.resolve(requireValue(argv, ++index, "--root"));
				break;
			case "--solution":
				options.solution = requireValue(argv, ++index, "--solution");
				break;
			case "--zip":
				options.zipPath = requireValue(argv, ++index, "--zip");
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "-h":
			case "--help":
				printHelp();
				process.exit(0);
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function printResult(result: Awaited<ReturnType<typeof runDotnetInit>>): void {
	const relativeSolutionPath = path.relative(result.root, result.solutionPath) || result.solutionPath;
	const statusIcon = result.changed ? (result.dryRun ? "🧪" : "✅") : "ℹ️";

	console.log(`${statusIcon} ${result.message}`);
	console.log(`🧩 Solution: ${relativeSolutionPath}`);
	console.log(`📄 Format: ${result.solutionKind}`);
	console.log(`📦 ZIP item: ${result.zipPath}`);

	if (result.dryRun) {
		console.log("🧰 Dry run: no files were changed.");
	}
}

function requireValue(argv: readonly string[], index: number, optionName: string): string {
	const value = argv[index];

	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${optionName}`);
	}

	return value;
}

function printHelp(): void {
	console.log(`
@da-core/zip-it dotnet init

Add the generated ZIP artifact path to a Visual Studio solution as a Solution Item.
This command is intentionally separate from zip-it, because it modifies .sln/.slnx files.

Usage:
zip-it-dotnet-init [options]

Options:
--root <path>          Project root. Defaults to current working directory.
--solution <path>      Specific .sln or .slnx file. Required when multiple solutions are found.
--zip <path>           ZIP path to add as a Solution Item. Defaults to ${DEFAULT_SOLUTION_ITEM_ZIP_PATH}.
--dry-run              Show what would change without writing the solution file.
-h, --help             Show help.

Examples:
zip-it-dotnet-init
zip-it-dotnet-init --dry-run
zip-it-dotnet-init --solution Game.sln
zip-it-dotnet-init --zip .artifacts/calm-ball-source.zip
`);
}

function isDirectExecution(): boolean {
	const entryPoint = process.argv[1];
	return entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;
}

if (isDirectExecution()) {
	main().catch((error: unknown) => {
		console.error("❌ Failed to initialize .NET solution:", error);
		process.exit(1);
	});
}
