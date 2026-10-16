import readline from "node:readline/promises";
import { isRealEnvPath } from "./ignore-patterns.js";
import { readEnvAssignments, renderReviewedEnvAssignments, type EnvAssignment } from "./env.js";
import type { FileEntry } from "./types.js";

export type EnvReviewPrompt = (question: string) => Promise<string>;

export async function prepareEnvReview(
	entries: readonly FileEntry[],
	prompt: EnvReviewPrompt,
): Promise<ReadonlyMap<string, Buffer>> {
	const assignments = new Map<string, EnvAssignment[]>();
	// Validate ALL files before asking any questions; any parse error aborts the review.
	for (const entry of entries) {
		if (isRealEnvPath(entry.relativePath)) {
			try {
				assignments.set(entry.relativePath, await readEnvAssignments(entry.fullPath));
			} catch (error) {
				const reason = error instanceof Error ? error.message : "Unknown parsing error";
				throw new Error(`Cannot safely review ${entry.relativePath}: ${reason}`);
			}
		}
	}

	const result = new Map<string, Buffer>();
	let revealed = 0;
	for (const [relativePath, items] of assignments) {
		const choices: boolean[] = [];
		for (let i = 0; i < items.length; i++) {
			const answer = await prompt(`${relativePath}: ${items[i]!.key} (${i + 1}/${items.length}) — include original value? Type yes to include [default: redact]: `);
			const preserve = answer.trim() === "yes";
			choices.push(preserve);
			if (preserve) revealed++;
		}
		result.set(relativePath, renderReviewedEnvAssignments(items, choices));
	}

	if (revealed > 0) {
		const answer = await prompt(`WARNING: ${revealed} original environment value(s) will be stored UNENCRYPTED in the archive. Type INCLUDE to confirm: `);
		if (answer.trim() !== "INCLUDE") {
			throw new Error("Environment review cancelled; no archive created.");
		}
	}
	return result;
}

export async function interactiveEnvReview(entries: readonly FileEntry[]): Promise<ReadonlyMap<string, Buffer>> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("--env-mode review requires an interactive TTY. Use --env-mode redacted for automation.");
	}
	const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await prepareEnvReview(entries, (question) => terminal.question(question));
	} finally {
		terminal.close();
	}
}
