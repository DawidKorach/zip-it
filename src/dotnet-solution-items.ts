// src/dotnet-solution-items.ts

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SOLUTION_ITEM_ZIP_PATH = ".artifacts/project.zip";

const SOLUTION_ITEMS_FOLDER_NAME = "Solution Items";
const SLN_SOLUTION_FOLDER_TYPE_GUID = "{66A26720-8FB5-11D2-AA7E-00C04F688DDE}";
const SOLUTION_EXTENSIONS = new Set([".sln", ".slnx"]);

type SolutionFileKind = "sln" | "slnx";

export type DotnetInitOptions = Readonly<{
	root: string;
	solution?: string;
	zipPath: string;
	dryRun: boolean;
}>;

export type DotnetInitResult = Readonly<{
	root: string;
	solutionPath: string;
	solutionKind: SolutionFileKind;
	zipPath: string;
	changed: boolean;
	dryRun: boolean;
	message: string;
}>;

export async function runDotnetInit(options: DotnetInitOptions): Promise<DotnetInitResult> {
	const root = path.resolve(options.root);
	const solutionPath = await resolveSolutionPath(root, options.solution);
	const solutionKind = getSolutionKind(solutionPath);
	const originalContent = await fs.promises.readFile(solutionPath, "utf8");
	const zipPath = normalizeZipPathForSolution(root, solutionPath, options.zipPath, solutionKind);
	const updatedContent =
		solutionKind === "sln"
			? updateLegacySolutionItems(originalContent, zipPath)
			: updateXmlSolutionItems(originalContent, zipPath);
	const changed = updatedContent !== originalContent;

	if (changed && !options.dryRun) {
		await fs.promises.writeFile(solutionPath, updatedContent, "utf8");
	}

	return {
		root,
		solutionPath,
		solutionKind,
		zipPath,
		changed,
		dryRun: options.dryRun,
		message: buildResultMessage(changed, options.dryRun),
	};
}

export async function findSolutionFiles(root: string): Promise<string[]> {
	const entries = await safeReadDirectory(root);
	const rootSolutions = entries
		.filter((entry) => entry.isFile() && SOLUTION_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
		.map((entry) => path.join(root, entry.name));

	if (rootSolutions.length > 0) {
		return rootSolutions.sort(comparePaths);
	}

	const directChildSolutions: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) {
			continue;
		}

		const childDirectory = path.join(root, entry.name);
		const childEntries = await safeReadDirectory(childDirectory);

		for (const childEntry of childEntries) {
			if (childEntry.isFile() && SOLUTION_EXTENSIONS.has(path.extname(childEntry.name).toLowerCase())) {
				directChildSolutions.push(path.join(childDirectory, childEntry.name));
			}
		}
	}

	return directChildSolutions.sort(comparePaths);
}

export function updateLegacySolutionItems(content: string, zipPath: string): string {
	const newline = detectNewline(content);
	const solutionItemPath = toSlnPath(zipPath);

	if (hasLegacySolutionItem(content, solutionItemPath)) {
		return content;
	}

	const folderProject = findLegacySolutionItemsProject(content);

	if (!folderProject) {
		return insertLegacySolutionItemsProject(content, solutionItemPath, newline);
	}

	const projectBlock = content.slice(folderProject.start, folderProject.end);
	const updatedProjectBlock = insertIntoLegacySolutionItemsProject(projectBlock, solutionItemPath, newline);

	return `${content.slice(0, folderProject.start)}${updatedProjectBlock}${content.slice(folderProject.end)}`;
}

export function updateXmlSolutionItems(content: string, zipPath: string): string {
	const newline = detectNewline(content);
	const solutionItemPath = toSlnxPath(zipPath);

	if (hasXmlSolutionItem(content, solutionItemPath)) {
		return content;
	}

	const folder = findXmlSolutionItemsFolder(content);

	if (!folder) {
		return insertXmlSolutionItemsFolder(content, solutionItemPath, newline);
	}

	const folderBlock = content.slice(folder.start, folder.end);

	if (/^\s*<Folder\b[^>]*\/\s*>\s*$/s.test(folderBlock)) {
		const indent = getLineIndentAt(content, folder.start);
		const childIndent = `${indent}  `;
		const replacement = `${indent}<Folder Name="/Solution Items/">${newline}${childIndent}<File Path="${escapeXmlAttribute(
			solutionItemPath,
		)}" />${newline}${indent}</Folder>`;

		return `${content.slice(0, folder.start)}${replacement}${content.slice(folder.end)}`;
	}

	const closingTagIndex = folderBlock.lastIndexOf("</Folder>");

	if (closingTagIndex === -1) {
		throw new Error("Unsupported .slnx Solution Items folder format.");
	}

	const indent = inferXmlChildIndent(folderBlock, newline);
	const fileLine = `${indent}<File Path="${escapeXmlAttribute(solutionItemPath)}" />${newline}`;
	const absoluteInsertIndex = folder.start + closingTagIndex;

	return `${content.slice(0, absoluteInsertIndex)}${fileLine}${content.slice(absoluteInsertIndex)}`;
}

async function resolveSolutionPath(root: string, solution?: string): Promise<string> {
	if (solution) {
		const solutionPath = path.isAbsolute(solution) ? solution : path.join(root, solution);
		const extension = path.extname(solutionPath).toLowerCase();

		if (!SOLUTION_EXTENSIONS.has(extension)) {
			throw new Error(`Expected a .sln or .slnx file, got: ${solution}`);
		}

		await assertFileExists(solutionPath);
		return path.resolve(solutionPath);
	}

	const candidates = await findSolutionFiles(root);

	if (candidates.length === 0) {
		throw new Error("No .sln or .slnx file found in the project root or its direct child directories.");
	}

	if (candidates.length > 1) {
		throw new Error(
			`Multiple solution files found. Use --solution to choose one:\n${candidates
				.map((candidate) => `  - ${path.relative(root, candidate)}`)
				.join("\n")}`,
		);
	}

	return candidates[0];
}

function getSolutionKind(solutionPath: string): SolutionFileKind {
	const extension = path.extname(solutionPath).toLowerCase();

	if (extension === ".sln") {
		return "sln";
	}

	if (extension === ".slnx") {
		return "slnx";
	}

	throw new Error(`Unsupported solution file extension: ${solutionPath}`);
}

function normalizeZipPathForSolution(
	root: string,
	solutionPath: string,
	zipPath: string,
	solutionKind: SolutionFileKind,
): string {
	const absoluteZipPath = path.isAbsolute(zipPath) ? zipPath : path.join(root, zipPath);
	const relativeToRoot = path.relative(root, absoluteZipPath);

	if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
		throw new Error("The ZIP path must be inside the project root.");
	}

	const relativeToSolution = path.relative(path.dirname(solutionPath), absoluteZipPath);
	return solutionKind === "sln" ? toSlnPath(relativeToSolution) : toSlnxPath(relativeToSolution);
}

function findLegacySolutionItemsProject(content: string): { start: number; end: number } | undefined {
	const projectRegex = new RegExp(
		`^Project\\("${escapeRegExp(SLN_SOLUTION_FOLDER_TYPE_GUID)}"\\)\\s*=\\s*"${escapeRegExp(
			SOLUTION_ITEMS_FOLDER_NAME,
		)}"[\\s\\S]*?^EndProject\\s*$`,
		"m",
	);
	const match = projectRegex.exec(content);

	if (!match || match.index === undefined) {
		return undefined;
	}

	return { start: match.index, end: match.index + match[0].length };
}

function hasLegacySolutionItem(content: string, itemPath: string): boolean {
	const normalizedItemPath = normalizeSlnComparablePath(itemPath);
	const itemLineRegex = /^\s*(?<left>.+?)\s*=\s*(?<right>.+?)\s*$/gm;
	let match: RegExpExecArray | null;

	while ((match = itemLineRegex.exec(content)) !== null) {
		const left = match.groups?.left;
		const right = match.groups?.right;

		if (!left || !right) {
			continue;
		}

		if (
			normalizeSlnComparablePath(left) === normalizedItemPath ||
			normalizeSlnComparablePath(right) === normalizedItemPath
		) {
			return true;
		}
	}

	return false;
}

function insertLegacySolutionItemsProject(content: string, itemPath: string, newline: string): string {
	const projectGuid = createStableSolutionFolderGuid(itemPath);
	const projectBlock = [
		`Project("${SLN_SOLUTION_FOLDER_TYPE_GUID}") = "${SOLUTION_ITEMS_FOLDER_NAME}", "${SOLUTION_ITEMS_FOLDER_NAME}", "${projectGuid}"`,
		"\tProjectSection(SolutionItems) = preProject",
		`\t\t${itemPath} = ${itemPath}`,
		"\tEndProjectSection",
		"EndProject",
	].join(newline);
	const globalIndex = content.search(/^Global\s*$/m);

	if (globalIndex === -1) {
		return ensureTrailingNewline(content, newline) + projectBlock + newline;
	}

	return `${content.slice(0, globalIndex)}${projectBlock}${newline}${content.slice(globalIndex)}`;
}

function insertIntoLegacySolutionItemsProject(projectBlock: string, itemPath: string, newline: string): string {
	const sectionMatch = /^\s*ProjectSection\(SolutionItems\)\s*=\s*preProject\s*$/m.exec(projectBlock);

	if (!sectionMatch || sectionMatch.index === undefined) {
		const endProjectIndex = projectBlock.search(/^EndProject\s*$/m);

		if (endProjectIndex === -1) {
			throw new Error("Unsupported .sln Solution Items project format.");
		}

		const sectionBlock = [
			"\tProjectSection(SolutionItems) = preProject",
			`\t\t${itemPath} = ${itemPath}`,
			"\tEndProjectSection",
		].join(newline);

		return `${projectBlock.slice(0, endProjectIndex)}${sectionBlock}${newline}${projectBlock.slice(endProjectIndex)}`;
	}

	const sectionEndMatch = /^\s*EndProjectSection\s*$/m.exec(projectBlock.slice(sectionMatch.index));

	if (!sectionEndMatch || sectionEndMatch.index === undefined) {
		throw new Error("Unsupported .sln SolutionItems section format.");
	}

	const insertIndex = sectionMatch.index + sectionEndMatch.index;
	const itemLine = `\t\t${itemPath} = ${itemPath}${newline}`;

	return `${projectBlock.slice(0, insertIndex)}${itemLine}${projectBlock.slice(insertIndex)}`;
}

function findXmlSolutionItemsFolder(content: string): { start: number; end: number } | undefined {
	const escapedName = escapeRegExp("/Solution Items/");
	const openFolderRegex = new RegExp(`<Folder\\b(?=[^>]*\\bName=["']${escapedName}["'])[^>]*(?:/>|>)`, "i");
	const match = openFolderRegex.exec(content);

	if (!match || match.index === undefined) {
		return undefined;
	}

	if (match[0].endsWith("/>") || match[0].endsWith("/ >")) {
		return { start: match.index, end: match.index + match[0].length };
	}

	const closeIndex = content.indexOf("</Folder>", match.index + match[0].length);

	if (closeIndex === -1) {
		throw new Error("Unsupported .slnx file: Solution Items folder is not closed.");
	}

	return { start: match.index, end: closeIndex + "</Folder>".length };
}

function hasXmlSolutionItem(content: string, itemPath: string): boolean {
	const normalizedItemPath = normalizeSlnxComparablePath(itemPath);
	const fileRegex = /<File\b[^>]*\bPath=["'](?<path>[^"']+)["'][^>]*\/?>/gi;
	let match: RegExpExecArray | null;

	while ((match = fileRegex.exec(content)) !== null) {
		const filePath = match.groups?.path;

		if (filePath && normalizeSlnxComparablePath(unescapeXmlAttribute(filePath)) === normalizedItemPath) {
			return true;
		}
	}

	return false;
}

function insertXmlSolutionItemsFolder(content: string, itemPath: string, newline: string): string {
	const solutionCloseIndex = content.lastIndexOf("</Solution>");

	if (solutionCloseIndex === -1) {
		throw new Error("Unsupported .slnx file: missing </Solution> root element.");
	}

	const indent = inferSolutionChildIndent(content, newline);
	const folderBlock = [
		`${indent}<Folder Name="/Solution Items/">`,
		`${indent}  <File Path="${escapeXmlAttribute(itemPath)}" />`,
		`${indent}</Folder>`,
	].join(newline);

	return `${content.slice(0, solutionCloseIndex)}${folderBlock}${newline}${content.slice(solutionCloseIndex)}`;
}

function createStableSolutionFolderGuid(itemPath: string): string {
	const hash = crypto
		.createHash("sha1")
		.update(`zip-it:${SOLUTION_ITEMS_FOLDER_NAME}:${itemPath}`)
		.digest("hex")
		.slice(0, 32);
	return `{${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}}`.toUpperCase();
}

function detectNewline(content: string): string {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

function ensureTrailingNewline(content: string, newline: string): string {
	return content.endsWith("\n") ? content : content + newline;
}

function toSlnPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\//g, "\\");
}

function toSlnxPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeSlnComparablePath(value: string): string {
	return value.trim().replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function normalizeSlnxComparablePath(value: string): string {
	return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function getLineIndentAt(content: string, index: number): string {
	const lineStart = content.lastIndexOf("\n", index) + 1;
	const line = content.slice(lineStart, index);
	return /^\s*/.exec(line)?.[0] ?? "";
}

function inferXmlChildIndent(folderBlock: string, newline: string): string {
	const childLine = folderBlock.split(/\r?\n/).find((line) => /^\s*<File\b/.test(line));

	if (childLine) {
		return /^\s*/.exec(childLine)?.[0] ?? "  ";
	}

	const folderIndent = /^\s*/.exec(folderBlock)?.[0] ?? "";
	return `${folderIndent}  `;
}

function inferSolutionChildIndent(content: string, newline: string): string {
	const firstChildLine = content.split(/\r?\n/).find((line) => /^\s+<(Project|Folder)\b/.test(line));

	if (firstChildLine) {
		return /^\s*/.exec(firstChildLine)?.[0] ?? "  ";
	}

	return "  ";
}

function escapeXmlAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertFileExists(filePath: string): Promise<void> {
	try {
		const stat = await fs.promises.stat(filePath);

		if (!stat.isFile()) {
			throw new Error(`${filePath} is not a file.`);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`Solution file not found: ${filePath}`);
		}

		throw error;
	}
}

async function safeReadDirectory(directory: string): Promise<fs.Dirent[]> {
	try {
		return await fs.promises.readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
}

function shouldSkipDirectory(directoryName: string): boolean {
	return directoryName === ".git" || directoryName === "node_modules" || directoryName === ".artifacts";
}

function comparePaths(left: string, right: string): number {
	return left.localeCompare(right);
}

function buildResultMessage(changed: boolean, dryRun: boolean): string {
	if (changed && dryRun) {
		return "Solution would be updated.";
	}

	if (changed) {
		return "Solution updated.";
	}

	return "Solution already contains the ZIP artifact entry.";
}
