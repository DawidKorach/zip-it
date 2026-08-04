// src/project-scope.ts

import fs from "node:fs";
import path from "node:path";
import { createGlobMatchers, matchesAny, toPosixPath } from "./glob.js";
import type { ScopeOptions, ScopeResult } from "./types.js";

type ProjectModel = Readonly<{
	path: string;
	directory: string;
	references: readonly string[];
	externalIncludes: readonly string[];
	imports: readonly string[];
	isTestProject: boolean;
	warnings: readonly string[];
}>;

const ROOT_FILE_MATCHERS = createGlobMatchers([
	".zip-it.json",
	".editorconfig",
	".gitattributes",
	".gitignore",
	"global.json",
	"NuGet.config",
	"nuget.config",
	"README*",
	"LICENSE*",
	"*.sln",
	"*.slnx",
	"Directory.Build.*",
	"Directory.Packages.*",
	"Directory.Solution.*",
]);

export async function applyProjectScope(
	root: string,
	files: readonly string[],
	options: ScopeOptions,
): Promise<ScopeResult> {
	if (options.mode === "full") {
		return {
			files,
			mode: "full",
			projects: [],
			excludedFiles: 0,
			warnings: [],
		};
	}

	if (!options.project) {
		throw new Error("scope.mode=dotnet-project requires scope.project or --project.");
	}

	const rootProject = resolveRequiredInsideRoot(root, options.project, root);
	if (!rootProject.toLowerCase().endsWith(".csproj")) {
		throw new Error(`Project scope expects a .csproj file: ${options.project}`);
	}
	if (!(await isFile(path.join(root, rootProject)))) {
		throw new Error(`Project file not found: ${rootProject}`);
	}

	const fileSet = new Set(files);
	if (!fileSet.has(rootProject)) {
		throw new Error(`Project file is excluded by the active selection or ignore rules: ${rootProject}`);
	}
	const availableProjects = [...fileSet].filter((file) => file.toLowerCase().endsWith(".csproj"));
	if (!availableProjects.includes(rootProject)) {
		availableProjects.push(rootProject);
	}

	const models = new Map<string, ProjectModel>();
	for (const project of availableProjects) {
		models.set(project, await parseProject(root, project));
	}

	const selectedProjects = collectProjectClosure(rootProject, models, true);

	if (options.includeRelatedTests) {
		for (const model of models.values()) {
			if (!model.isTestProject || selectedProjects.has(model.path)) {
				continue;
			}

			const testClosure = collectProjectClosure(model.path, models, false);
			if ([...testClosure].some((project) => selectedProjects.has(project))) {
				for (const project of testClosure) {
					selectedProjects.add(project);
				}
			}
		}
	}

	const selectedFiles = new Set<string>();
	const warnings: string[] = [];

	for (const project of selectedProjects) {
		const model = models.get(project) ?? (await parseProject(root, project));
		models.set(project, model);
		selectedFiles.add(project);
		for (const warning of model.warnings) {
			warnings.push(warning);
		}

		const directoryPrefix = model.directory ? `${model.directory}/` : "";
		for (const file of files) {
			if (!model.directory || file === model.path || file.startsWith(directoryPrefix)) {
				selectedFiles.add(file);
			}
		}

		includeExternalPatterns(files, model.externalIncludes, selectedFiles);
		for (const imported of model.imports) {
			if (fileSet.has(imported)) {
				selectedFiles.add(imported);
			}
		}
		includeAncestorBuildFiles(files, model.directory, selectedFiles);
	}

	if (options.includeRootFiles) {
		for (const file of files) {
			if (!file.includes("/") && matchesAny(file, ROOT_FILE_MATCHERS)) {
				selectedFiles.add(file);
			}
		}
	}

	const scopedFiles = files.filter((file) => selectedFiles.has(file));
	return {
		files: scopedFiles,
		mode: "dotnet-project",
		rootProject,
		projects: [...selectedProjects].sort(comparePaths),
		excludedFiles: files.length - scopedFiles.length,
		warnings: [...new Set(warnings)].sort(comparePaths),
	};
}

async function parseProject(root: string, projectPath: string): Promise<ProjectModel> {
	const fullPath = path.join(root, projectPath);
	const content = await fs.promises.readFile(fullPath, "utf8");
	const directory = toPosixPath(path.posix.dirname(projectPath));
	const normalizedDirectory = directory === "." ? "" : directory;
	const warnings: string[] = [];
	const references = extractAttributeValues(content, "ProjectReference", "Include")
		.map((value) => resolveMsBuildPath(root, normalizedDirectory, value, projectPath, warnings))
		.filter((value): value is string => value !== undefined)
		.filter((value) => value.toLowerCase().endsWith(".csproj"));
	const externalIncludes = extractItemIncludes(content)
		.map((value) => resolveMsBuildPattern(root, normalizedDirectory, value, projectPath, warnings))
		.filter((value): value is string => value !== undefined)
		.filter((value) => !isInsideDirectory(value, normalizedDirectory));
	const imports = extractAttributeValues(content, "Import", "Project")
		.map((value) => resolveMsBuildPath(root, normalizedDirectory, value, projectPath, warnings))
		.filter((value): value is string => value !== undefined);

	return {
		path: projectPath,
		directory: normalizedDirectory,
		references: [...new Set(references)].sort(comparePaths),
		externalIncludes: [...new Set(externalIncludes)].sort(comparePaths),
		imports: [...new Set(imports)].sort(comparePaths),
		isTestProject: detectTestProject(projectPath, content),
		warnings,
	};
}

function collectProjectClosure(
	rootProject: string,
	models: ReadonlyMap<string, ProjectModel>,
	strict: boolean,
): Set<string> {
	const selected = new Set<string>();
	const queue = [rootProject];

	while (queue.length > 0) {
		const project = queue.shift();
		if (!project || selected.has(project)) {
			continue;
		}
		selected.add(project);
		const model = models.get(project);
		if (!model) {
			if (strict) {
				throw new Error(`Referenced project is excluded by the active selection or ignore rules: ${project}`);
			}
			continue;
		}
		for (const reference of model.references) {
			if (!selected.has(reference)) {
				queue.push(reference);
			}
		}
	}

	return selected;
}

function extractAttributeValues(content: string, elementName: string, attributeName: string): string[] {
	const result: string[] = [];
	const elementPattern = new RegExp(`<${elementName}\\b[^>]*>`, "gi");
	const attributePattern = new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, "i");

	for (const element of content.matchAll(elementPattern)) {
		const attribute = element[0].match(attributePattern);
		if (attribute?.[2]) {
			result.push(attribute[2]);
		}
	}
	return result;
}

function extractItemIncludes(content: string): string[] {
	const result: string[] = [];
	const itemPattern = /<(Compile|Content|None|EmbeddedResource|AdditionalFiles)\b[^>]*>/gi;
	for (const item of content.matchAll(itemPattern)) {
		const attribute = item[0].match(/\bInclude\s*=\s*(["'])(.*?)\1/i);
		if (attribute?.[2]) {
			result.push(attribute[2]);
		}
	}
	return result;
}

function resolveMsBuildPath(
	root: string,
	projectDirectory: string,
	value: string,
	projectPath: string,
	warnings: string[],
): string | undefined {
	if (containsMsBuildExpression(value) || containsWildcard(value)) {
		warnings.push(`MSBuild expression was not statically resolved in ${projectPath}: ${value}`);
		return undefined;
	}
	return tryResolveInsideRoot(root, value, path.join(root, projectDirectory), projectPath, warnings);
}

function resolveMsBuildPattern(
	root: string,
	projectDirectory: string,
	value: string,
	projectPath: string,
	warnings: string[],
): string | undefined {
	if (containsMsBuildExpression(value)) {
		warnings.push(`MSBuild expression was not statically resolved in ${projectPath}: ${value}`);
		return undefined;
	}
	return tryResolveInsideRoot(root, value, path.join(root, projectDirectory), projectPath, warnings);
}

function resolveRequiredInsideRoot(root: string, value: string, baseDirectory: string): string {
	const resolved = tryResolveInsideRoot(root, value, baseDirectory);
	if (!resolved) {
		throw new Error(`Path is outside project root: ${value}`);
	}
	return resolved;
}

function tryResolveInsideRoot(
	root: string,
	value: string,
	baseDirectory: string,
	projectPath?: string,
	warnings?: string[],
): string | undefined {
	const normalizedValue = value.replace(/\\/g, path.sep);
	const fullPath = path.resolve(baseDirectory, normalizedValue);
	const relative = path.relative(root, fullPath);

	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		const context = projectPath ? ` referenced by ${projectPath}` : "";
		warnings?.push(`Path outside project root was skipped${context}: ${value}`);
		return undefined;
	}

	return toPosixPath(relative);
}

function includeExternalPatterns(files: readonly string[], patterns: readonly string[], selected: Set<string>): void {
	for (const pattern of patterns) {
		if (!pattern) {
			continue;
		}
		if (!containsWildcard(pattern)) {
			if (files.includes(pattern)) {
				selected.add(pattern);
			}
			continue;
		}
		const matcher = createGlobMatchers([pattern]);
		for (const file of files) {
			if (matchesAny(file, matcher)) {
				selected.add(file);
			}
		}
	}
}

function includeAncestorBuildFiles(files: readonly string[], projectDirectory: string, selected: Set<string>): void {
	let current = projectDirectory;
	while (true) {
		const prefix = current ? `${current}/` : "";
		for (const name of [
			"Directory.Build.props",
			"Directory.Build.targets",
			"Directory.Packages.props",
			"Directory.Packages.targets",
		]) {
			const candidate = `${prefix}${name}`;
			if (files.includes(candidate)) {
				selected.add(candidate);
			}
		}
		if (!current) {
			break;
		}
		const parent = path.posix.dirname(current);
		current = parent === "." ? "" : parent;
	}
}

function detectTestProject(projectPath: string, content: string): boolean {
	return (
		/<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(content) ||
		/<PackageReference\b[^>]*\bInclude\s*=\s*["']Microsoft\.NET\.Test\.Sdk["']/i.test(content) ||
		/(^|\/)(tests?|[^/]+\.tests?)(\/|$)/i.test(projectPath)
	);
}

function containsMsBuildExpression(value: string): boolean {
	return value.includes("$(") || value.includes("@(") || value.includes("%(");
}

function containsWildcard(value: string): boolean {
	return /[*?\[]/.test(value);
}

function isInsideDirectory(file: string, directory: string): boolean {
	return !directory || file === directory || file.startsWith(`${directory}/`);
}

async function isFile(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isFile();
	} catch {
		return false;
	}
}

function comparePaths(left: string, right: string): number {
	return left.localeCompare(right, "en", { sensitivity: "base" });
}
