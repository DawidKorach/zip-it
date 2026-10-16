// Environment values must never flow through the generic original-file writer.
import fs from "node:fs/promises";
import { TextDecoder } from "node:util";

export type EnvAssignment = Readonly<{ key: string; rawValue: string }>;
const MAX_ENV_SIZE = 1024 * 1024;

/** Parse only known dotenv assignments. Unknown syntax fails closed. No comments survive. */
export function parseEnvFile(buffer: Buffer): EnvAssignment[] {
	if (buffer.length > MAX_ENV_SIZE) {
		throw new Error("Environment file exceeds the 1 MiB safety limit.");
	}
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		throw new Error("Environment file is not valid UTF-8.");
	}
	if (text.includes("\0")) throw new Error("Environment file contains NUL bytes.");
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	const result: EnvAssignment[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (/^\s*(?:#.*)?$/.test(line)) continue;
		const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
		if (!match) throw new Error(`Unsupported environment syntax at line ${i + 1}.`);
		const key = match[1]!;
		let rawValue = match[2]!;
		const trimmed = rawValue.trimStart();
		if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
			const quote = trimmed[0]!;
			let searchFrom = rawValue.indexOf(quote) + 1;
			let closeAt = -1;
			while (true) {
				for (let j = searchFrom; j < rawValue.length; j++) {
					if (rawValue[j] !== quote) continue;
					if (quote === '"' && j > 0 && rawValue[j - 1] === "\\") continue;
					closeAt = j;
					break;
				}
				if (closeAt >= 0) break;
				if (++i >= lines.length) throw new Error(`Unterminated quoted value for ${key}.`);
				rawValue += "\n" + lines[i];
				searchFrom = rawValue.lastIndexOf("\n") + 1;
			}
			if (!/^\s*(?:#.*)?$/.test(rawValue.slice(closeAt + 1))) {
				throw new Error(`Unsupported trailing characters for ${key}.`);
			}
			// Discard any trailing comment, including comments after quoted values.
			rawValue = rawValue.slice(0, closeAt + 1);
		} else if (rawValue.endsWith("\\")) {
			throw new Error(`Unsupported line continuation for ${key}.`);
		}
		result.push({ key, rawValue });
	}
	return result;
}

export async function readEnvAssignments(fullPath: string): Promise<EnvAssignment[]> {
	const file = await fs.readFile(fullPath);
	return parseEnvFile(file);
}

export function redactEnvAssignments(assignments: readonly EnvAssignment[]): Buffer {
	return Buffer.from(assignments.map(({ key }) => `${key}=.`).join("\n") + (assignments.length ? "\n" : ""), "utf8");
}

export function renderReviewedEnvAssignments(assignments: readonly EnvAssignment[], keep: readonly boolean[]): Buffer {
	if (assignments.length !== keep.length) throw new Error("Missing per-key review decisions.");
	return Buffer.from(assignments.map((item, index) => `${item.key}=${keep[index] ? item.rawValue : "."}`).join("\n") + (assignments.length ? "\n" : ""), "utf8");
}
