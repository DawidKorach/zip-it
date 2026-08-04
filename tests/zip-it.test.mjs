import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { mergeOptions, parseRawCliOptions, readProjectConfig } from "../dist/config.js";
import { getIgnorePatternsForGroups } from "../dist/ignore-patterns.js";
import { createShapePreservingImagePlaceholder, getFileKind } from "../dist/media.js";
import { detectProjectKinds, resolveProfile } from "../dist/profile.js";
import { applyProjectScope } from "../dist/project-scope.js";
import { buildFileEntries, scanProjectFiles } from "../dist/scanner.js";
import { createArchive, createInitialStats } from "../dist/zip.js";

const execFileAsync = promisify(execFile);

async function createTempProject() {
	return fs.mkdtemp(path.join(os.tmpdir(), "zip-it-test-"));
}

async function writeFile(root, relativePath, content = "test") {
	const fullPath = path.join(root, relativePath);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, content);
}

async function scanWithProfile(root, requestedProfile = "auto") {
	const detected = await detectProjectKinds(root);
	const profile = resolveProfile(requestedProfile, detected);
	const ignorePatterns = getIgnorePatternsForGroups(profile.activeIgnoreGroups);
	const scan = await scanProjectFiles(root, ignorePatterns);

	return { detected, profile, scan };
}

test("parses --profile and rejects unsupported values", async () => {
	await assert.rejects(
		() => execFileAsync(process.execPath, ["dist/cli.js", "--profile", "php"], { cwd: process.cwd() }),
		/error: Command failed|Invalid profile: php/i,
	);

	const raw = parseRawCliOptions(["--profile", "android", "--dry-run", "--media-mode", "preserve-shape"]);
	assert.equal(raw.profile, "android");
	assert.equal(raw.dryRun, true);
	assert.equal(raw.mediaMode, "preserve-shape");

	const aliasRaw = parseRawCliOptions(["--preserve-media-shape"]);
	assert.equal(aliasRaw.mediaMode, "preserve-shape");

	const verboseRaw = parseRawCliOptions(["--verbose", "2"]);
	assert.equal(verboseRaw.verbosity, 2);

	const shortVerboseRaw = parseRawCliOptions(["-v", "3"]);
	assert.equal(shortVerboseRaw.verbosity, 3);

	const repeatedVerboseRaw = parseRawCliOptions(["-vv"]);
	assert.equal(repeatedVerboseRaw.verbosity, 2);

	const devVerboseRaw = parseRawCliOptions(["--verbose", "dev"]);
	assert.equal(devVerboseRaw.verbosity, 4);
});

test("auto-detects Node projects", async () => {
	const root = await createTempProject();
	await writeFile(root, "package.json", "{}\n");

	const { detected, profile } = await scanWithProfile(root);

	assert.deepEqual(detected, { node: true, dotnet: false, android: false });
	assert.equal(profile.effectiveProfile, "node");
});

test("auto-detects .NET projects and ignores bin/obj while keeping source files", async () => {
	const root = await createTempProject();
	await writeFile(root, "Demo.sln", "Microsoft Visual Studio Solution File\n");
	await writeFile(root, "src/Demo.App/Demo.App.csproj", "<Project />\n");
	await writeFile(root, "src/Demo.App/Program.cs", "Console.WriteLine();\n");
	await writeFile(root, "src/Demo.App/bin/Debug/net9.0/Demo.App.dll", "binary");
	await writeFile(root, "src/Demo.App/obj/project.assets.json", "{}\n");
	await writeFile(root, "build/Directory.Build.targets", "<Project />\n");

	const { detected, profile, scan } = await scanWithProfile(root, "dotnet");

	assert.deepEqual(detected, { node: false, dotnet: true, android: false });
	assert.equal(profile.effectiveProfile, "dotnet");
	assert.deepEqual(scan.files, [
		"build/Directory.Build.targets",
		"Demo.sln",
		"src/Demo.App/Demo.App.csproj",
		"src/Demo.App/Program.cs",
	]);
});

test("auto-detects mixed Node + .NET projects and combines ignore rules", async () => {
	const root = await createTempProject();
	await writeFile(root, "package.json", "{}\n");
	await writeFile(root, "Game.sln", "Microsoft Visual Studio Solution File\n");
	await writeFile(root, "src/Game/Game.csproj", "<Project />\n");
	await writeFile(root, "node_modules/lib/index.js", "module.exports = {};\n");
	await writeFile(root, "src/Game/bin/Debug/Game.dll", "binary");
	await writeFile(root, "src/Game/obj/project.assets.json", "{}\n");

	const { detected, profile, scan } = await scanWithProfile(root);

	assert.deepEqual(detected, { node: true, dotnet: true, android: false });
	assert.equal(profile.effectiveProfile, "node+dotnet");
	assert.deepEqual(scan.files, ["Game.sln", "package.json", "src/Game/Game.csproj"]);
});

test("auto-detects Android Gradle projects and ignores generated Android Studio artifacts", async () => {
	const root = await createTempProject();
	await writeFile(root, "settings.gradle.kts", "pluginManagement {}\ndependencyResolutionManagement {}\nrootProject.name = \"AndroidAppDump\"\ninclude(\":app\")\n");
	await writeFile(root, "build.gradle.kts", "plugins { alias(libs.plugins.android.application) apply false }\n");
	await writeFile(root, "app/build.gradle.kts", "plugins { id(\"com.android.application\"); id(\"org.jetbrains.kotlin.android\") }\n");
	await writeFile(root, "app/src/main/AndroidManifest.xml", "<manifest />\n");
	await writeFile(root, "app/src/main/java/com/example/appdump/MainActivity.kt", "class MainActivity\n");
	await writeFile(root, "app/src/main/res/values/strings.xml", "<resources />\n");
	await writeFile(root, "gradle/wrapper/gradle-wrapper.properties", "distributionUrl=https://services.gradle.org/distributions/gradle.zip\n");
	await writeFile(root, "gradle/wrapper/gradle-wrapper.jar", "binary");
	await writeFile(root, "gradlew", "#!/bin/sh\n");
	await writeFile(root, ".idea/codeStyles/Project.xml", "<project />\n");
	await writeFile(root, ".idea/caches/build_file_checksums.ser", "cache");
	await writeFile(root, ".gradle/9.1.0/fileHashes/fileHashes.bin", "cache");
	await writeFile(root, ".kotlin/sessions/kotlin-compiler-123.salive", "cache");
	await writeFile(root, "app/build/intermediates/apk/debug/app-debug.apk", "apk");
	await writeFile(root, "build/reports/problems/problems-report.html", "generated");
	await writeFile(root, "local.properties", "sdk.dir=C:/Users/Dawid/AppData/Local/Android/Sdk\n");

	const { detected, profile, scan } = await scanWithProfile(root);

	assert.deepEqual(detected, { node: false, dotnet: false, android: true });
	assert.equal(profile.effectiveProfile, "android");
	assert(scan.files.includes("settings.gradle.kts"));
	assert(scan.files.includes("app/build.gradle.kts"));
	assert(scan.files.includes("app/src/main/AndroidManifest.xml"));
	assert(scan.files.includes("app/src/main/java/com/example/appdump/MainActivity.kt"));
	assert(scan.files.includes("gradle/wrapper/gradle-wrapper.jar"));
	assert(scan.files.includes(".idea/codeStyles/Project.xml"));
	assert(!scan.files.includes(".idea/caches/build_file_checksums.ser"));
	assert(!scan.files.includes(".gradle/9.1.0/fileHashes/fileHashes.bin"));
	assert(!scan.files.includes(".kotlin/sessions/kotlin-compiler-123.salive"));
	assert(!scan.files.includes("app/build/intermediates/apk/debug/app-debug.apk"));
	assert(!scan.files.includes("build/reports/problems/problems-report.html"));
	assert(!scan.files.includes("local.properties"));
});

test("keeps root build files for mixed Android + .NET projects", async () => {
	const root = await createTempProject();
	await writeFile(root, "settings.gradle.kts", "include(\":app\")\n");
	await writeFile(root, "app/build.gradle.kts", "plugins { id(\"com.android.application\") }\n");
	await writeFile(root, "app/src/main/AndroidManifest.xml", "<manifest />\n");
	await writeFile(root, "Tooling.sln", "Microsoft Visual Studio Solution File\n");
	await writeFile(root, "build/Directory.Build.targets", "<Project />\n");
	await writeFile(root, "app/build/generated/source.txt", "generated");

	const { detected, profile, scan } = await scanWithProfile(root);

	assert.deepEqual(detected, { node: false, dotnet: true, android: true });
	assert.equal(profile.effectiveProfile, "dotnet+android");
	assert(scan.files.includes("build/Directory.Build.targets"));
	assert(!scan.files.includes("app/build/generated/source.txt"));
});

test("preserves MonoGame source assets and recognizes images for minimization", async () => {
	const root = await createTempProject();
	await writeFile(root, "CalmBall.sln", "Microsoft Visual Studio Solution File\n");
	await writeFile(root, "src/CalmBall.WindowsDX/CalmBall.WindowsDX.csproj", "<Project />\n");
	await writeFile(root, "src/CalmBall.WindowsDX/Game1.cs", "class Game1 {}\n");
	await writeFile(root, "src/CalmBall.WindowsDX/Content/Content.mgcb", "# mgcb\n");
	await writeFile(root, "src/CalmBall.WindowsDX/Content/Effects/basic.fx", "effect\n");
	await writeFile(root, "src/CalmBall.WindowsDX/Content/Fonts/ui.spritefont", "font\n");
	await writeFile(root, "src/CalmBall.WindowsDX/Content/Images/background.png", "not-a-real-png-but-kind-is-enough");
	await writeFile(root, "src/CalmBall.WindowsDX/Content/bin/DesktopGL/generated.xnb", "xnb");
	await writeFile(root, "src/CalmBall.WindowsDX/Content/obj/generated", "cache");

	const { scan } = await scanWithProfile(root, "dotnet");

	assert(scan.files.includes("src/CalmBall.WindowsDX/Content/Content.mgcb"));
	assert(scan.files.includes("src/CalmBall.WindowsDX/Content/Effects/basic.fx"));
	assert(scan.files.includes("src/CalmBall.WindowsDX/Content/Fonts/ui.spritefont"));
	assert(scan.files.includes("src/CalmBall.WindowsDX/Content/Images/background.png"));
	assert(!scan.files.includes("src/CalmBall.WindowsDX/Content/bin/DesktopGL/generated.xnb"));
	assert.equal(getFileKind("src/CalmBall.WindowsDX/Content/Images/background.png"), "image");
});

test("keeps existing Node ignore behavior for typical frontend projects", async () => {
	const root = await createTempProject();
	await writeFile(root, "package.json", "{}\n");
	await writeFile(root, "src/index.ts", "export {};\n");
	await writeFile(root, "node_modules/lib/index.js", "module.exports = {};\n");
	await writeFile(root, ".next/server/app.js", "compiled");
	await writeFile(root, "dist/index.js", "compiled");
	await writeFile(root, "build/index.js", "compiled");
	await writeFile(root, "coverage/lcov.info", "coverage");

	const { scan } = await scanWithProfile(root, "node");

	assert.deepEqual(scan.files, ["package.json", "src/index.ts"]);
});

test("does not globally ignore build/ for mixed projects", async () => {
	const root = await createTempProject();
	await writeFile(root, "package.json", "{}\n");
	await writeFile(root, "Game.sln", "Microsoft Visual Studio Solution File\n");
	await writeFile(root, "build/package.props", "<Project />\n");
	await writeFile(root, "frontend/build/static/app.js", "compiled frontend");

	const { scan } = await scanWithProfile(root);

	assert(scan.files.includes("build/package.props"));
	assert(!scan.files.includes("frontend/build/static/app.js"));
});

test("loads optional .zip-it.json and lets CLI override scalar values", async () => {
	const root = await createTempProject();
	await writeFile(
		root,
		".zip-it.json",
		JSON.stringify({
			profile: "dotnet",
			output: ".artifacts/from-config.zip",
			ignore: ["**/*.bak"],
			media: { minify: false, mode: "preserve-shape", keepAudioOriginals: true },
		}),
	);

	const config = await readProjectConfig(root);
	const options = mergeOptions(
		parseRawCliOptions(["--root", root, "--profile", "node", "--keep-video-originals"]),
		config,
	);

	assert.equal(options.profile, "node");
	assert.equal(options.output, path.join(root, ".artifacts/from-config.zip"));
	assert.deepEqual(options.ignorePatterns, ["**/*.bak"]);
	assert.deepEqual(options.media, {
		minify: false,
		mode: "preserve-shape",
		keepVideoOriginals: true,
		keepAudioOriginals: true,
	});
});


test("creates shape-preserving image placeholders for PNG files", async () => {
	const root = await createTempProject();
	const png = Buffer.alloc(24);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
	png.writeUInt32BE(320, 16);
	png.writeUInt32BE(180, 20);
	await writeFile(root, "Content/Images/background.png", png);

	const result = await createShapePreservingImagePlaceholder(
		"Content/Images/background.png",
		path.join(root, "Content/Images/background.png"),
	);

	assert(result);
	assert.equal(result.dimensions.width, 320);
	assert.equal(result.dimensions.height, 180);
	assert.equal(result.buffer.readUInt32BE(16), 320);
	assert.equal(result.buffer.readUInt32BE(20), 180);
	assert(result.buffer.length < 200);
});

test("detects audio files", () => {
	assert.equal(getFileKind("Content/Sfx/click.wav"), "audio");
	assert.equal(getFileKind("Content/Music/theme.ogg"), "audio");
});

test("dotnet init adds the generated ZIP to legacy .sln Solution Items", async () => {
	const root = await createTempProject();
	const solution = [
		"Microsoft Visual Studio Solution File, Format Version 12.00",
		"# Visual Studio Version 17",
		"Global",
		"EndGlobal",
		"",
	].join("\r\n");
	await writeFile(root, "Demo.sln", solution);

	const { runDotnetInit } = await import("../dist/dotnet-solution-items.js");
	const result = await runDotnetInit({ root, zipPath: ".artifacts/project.zip", dryRun: false });
	const updated = await fs.readFile(path.join(root, "Demo.sln"), "utf8");

	assert.equal(result.changed, true);
	assert.match(updated, /Project\("\{66A26720-8FB5-11D2-AA7E-00C04F688DDE\}"\) = "Solution Items"/);
	assert.match(updated, /\.artifacts\\project\.zip = \.artifacts\\project\.zip/);

	const secondResult = await runDotnetInit({ root, zipPath: ".artifacts/project.zip", dryRun: false });
	const secondUpdated = await fs.readFile(path.join(root, "Demo.sln"), "utf8");

	assert.equal(secondResult.changed, false);
	assert.equal(secondUpdated, updated);
});

test("dotnet init adds the generated ZIP to .slnx Solution Items", async () => {
	const root = await createTempProject();
	const solution = ["<Solution>", '  <Project Path="src/Demo/Demo.csproj" />', "</Solution>", ""].join("\n");
	await writeFile(root, "Demo.slnx", solution);

	const { runDotnetInit } = await import("../dist/dotnet-solution-items.js");
	const result = await runDotnetInit({ root, zipPath: ".artifacts/project.zip", dryRun: false });
	const updated = await fs.readFile(path.join(root, "Demo.slnx"), "utf8");

	assert.equal(result.changed, true);
	assert.match(updated, /<Folder Name="\/Solution Items\/">/);
	assert.match(updated, /<File Path="\.artifacts\/project\.zip" \/>/);

	const secondResult = await runDotnetInit({ root, zipPath: ".artifacts/project.zip", dryRun: false });
	const secondUpdated = await fs.readFile(path.join(root, "Demo.slnx"), "utf8");

	assert.equal(secondResult.changed, false);
	assert.equal(secondUpdated, updated);
});

test("dotnet init dry-run reports planned change without writing the solution", async () => {
	const root = await createTempProject();
	const solution = ["<Solution>", '  <Project Path="src/Demo/Demo.csproj" />', "</Solution>", ""].join("\n");
	await writeFile(root, "Demo.slnx", solution);

	const { runDotnetInit } = await import("../dist/dotnet-solution-items.js");
	const result = await runDotnetInit({ root, zipPath: ".artifacts/project.zip", dryRun: true });
	const afterDryRun = await fs.readFile(path.join(root, "Demo.slnx"), "utf8");

	assert.equal(result.changed, true);
	assert.equal(result.dryRun, true);
	assert.equal(afterDryRun, solution);
});

test("dotnet init supports solution files in direct child directories", async () => {
	const root = await createTempProject();
	await writeFile(root, "solution/Demo.slnx", ["<Solution>", "</Solution>", ""].join("\n"));

	const { runDotnetInit } = await import("../dist/dotnet-solution-items.js");
	const result = await runDotnetInit({ root, zipPath: ".artifacts/project.zip", dryRun: false });
	const updated = await fs.readFile(path.join(root, "solution/Demo.slnx"), "utf8");

	assert.equal(result.changed, true);
	assert.equal(result.zipPath, "../.artifacts/project.zip");
	assert.match(updated, /<File Path="\.\.\/\.artifacts\/project\.zip" \/>/);
});


test("parses advanced selection, archive, target and project-scope options", () => {
	const raw = parseRawCliOptions([
		"--target",
		"review",
		"--selection",
		"git-tracked",
		"--format",
		"tar.zst",
		"--compression-level",
		"9",
		"--small-file-buffer-threshold",
		"4096",
		"--project",
		"src/App/App.csproj",
		"--no-related-tests",
		"--no-root-files",
	]);

	assert.equal(raw.target, "review");
	assert.equal(raw.selectionMode, "git-tracked");
	assert.equal(raw.archiveFormat, "tar.zst");
	assert.equal(raw.compressionLevel, 9);
	assert.equal(raw.smallFileBufferThreshold, 4096);
	assert.equal(raw.project, "src/App/App.csproj");
	assert.equal(raw.includeRelatedTests, false);
	assert.equal(raw.includeRootFiles, false);
});

test("merges named targets and derives the output extension from the archive format", async () => {
	const root = await createTempProject();
	await writeFile(
		root,
		".zip-it.json",
		JSON.stringify({
			version: 2,
			profile: "dotnet",
			ignore: ["base/**"],
			defaultTarget: "review",
			targets: {
				review: {
					selection: { mode: "git-visible" },
					archive: { format: "tar.gz", compressionLevel: 9 },
					ignore: ["generated/**"],
					media: { mode: "preserve-shape" },
				},
			},
		}),
	);

	const config = await readProjectConfig(root);
	const options = mergeOptions(parseRawCliOptions(["--root", root]), config);

	assert.equal(options.target, "review");
	assert.equal(options.output, path.join(root, ".artifacts/project.tar.gz"));
	assert.equal(options.archive.format, "tar.gz");
	assert.equal(options.archive.compressionLevel, 9);
	assert.equal(options.selection.mode, "git-visible");
	assert.equal(options.media.mode, "preserve-shape");
	assert.deepEqual(options.ignorePatterns, ["base/**", "generated/**"]);
});

test("git-visible includes untracked visible files and excludes Git-ignored files", async () => {
	const root = await createTempProject();
	await execFileAsync("git", ["init", "-q"], { cwd: root });
	await execFileAsync("git", ["config", "user.email", "zip-it-tests@example.invalid"], { cwd: root });
	await execFileAsync("git", ["config", "user.name", "zip-it tests"], { cwd: root });
	await writeFile(root, ".gitignore", "ignored.txt\n");
	await writeFile(root, "tracked.txt", "tracked\n");
	await execFileAsync("git", ["add", ".gitignore", "tracked.txt"], { cwd: root });
	await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
	await writeFile(root, "visible-untracked.txt", "visible\n");
	await writeFile(root, "ignored.txt", "ignored\n");

	const visible = await scanProjectFiles(root, [], "git-visible");
	const tracked = await scanProjectFiles(root, [], "git-tracked");

	assert.equal(visible.selectionMode, "git-visible");
	assert(visible.files.includes("tracked.txt"));
	assert(visible.files.includes("visible-untracked.txt"));
	assert(!visible.files.includes("ignored.txt"));
	assert.equal(visible.gitIgnoredFiles, 1);
	assert(tracked.files.includes("tracked.txt"));
	assert(!tracked.files.includes("visible-untracked.txt"));
});

test("dotnet project scope includes transitive references and related tests", async () => {
	const root = await createTempProject();
	await writeFile(
		root,
		"src/App/App.csproj",
		'<Project><ItemGroup><ProjectReference Include="../Core/Core.csproj" /></ItemGroup></Project>',
	);
	await writeFile(root, "src/App/App.cs", "class App {}\n");
	await writeFile(root, "src/Core/Core.csproj", "<Project />\n");
	await writeFile(root, "src/Core/Core.cs", "class Core {}\n");
	await writeFile(
		root,
		"tests/App.Tests/App.Tests.csproj",
		'<Project><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup><ItemGroup><ProjectReference Include="../../src/App/App.csproj" /></ItemGroup></Project>',
	);
	await writeFile(root, "tests/App.Tests/AppTests.cs", "class AppTests {}\n");
	await writeFile(root, "src/Other/Other.csproj", "<Project />\n");
	await writeFile(root, "src/Other/Other.cs", "class Other {}\n");
	await writeFile(root, "Directory.Build.props", "<Project />\n");
	await writeFile(root, "global.json", "{}\n");

	const scan = await scanProjectFiles(root, [], "filesystem");
	const scope = await applyProjectScope(root, scan.files, {
		mode: "dotnet-project",
		project: "src/App/App.csproj",
		includeRelatedTests: true,
		includeRootFiles: true,
	});

	assert.deepEqual(scope.projects, [
		"src/App/App.csproj",
		"src/Core/Core.csproj",
		"tests/App.Tests/App.Tests.csproj",
	]);
	assert(scope.files.includes("src/App/App.cs"));
	assert(scope.files.includes("src/Core/Core.cs"));
	assert(scope.files.includes("tests/App.Tests/AppTests.cs"));
	assert(scope.files.includes("Directory.Build.props"));
	assert(scope.files.includes("global.json"));
	assert(!scope.files.includes("src/Other/Other.cs"));
});

test("creates a portable tar.gz archive with deterministic TAR timestamps", async () => {
	const root = await createTempProject();
	await writeFile(root, "package.json", "{}\n");
	await writeFile(root, "src/index.ts", "export const value = 1;\n");
	const output = path.join(root, ".artifacts/project.tar.gz");
	const options = mergeOptions(
		parseRawCliOptions([
			"--root",
			root,
			"--output",
			output,
			"--selection",
			"filesystem",
			"--format",
			"tar.gz",
			"--no-media-minify",
		]),
		{},
	);
	const scan = await scanProjectFiles(root, [], "filesystem");
	const entries = await buildFileEntries(root, scan.files);
	const stats = createInitialStats(entries.length, 0, 0);
	await fs.mkdir(path.dirname(output), { recursive: true });
	await createArchive(entries, options, stats);

	const tarBuffer = gunzipSync(await fs.readFile(output));
	const tarEntries = readTarEntries(tarBuffer);
	assert.deepEqual(
		tarEntries.map((entry) => entry.path),
		["package.json", "src/index.ts"],
	);
	assert(tarEntries.every((entry) => entry.mtime === 315532800));
	assert.equal(stats.archiveSize, (await fs.stat(output)).size);
});

function readTarEntries(buffer) {
	const entries = [];
	for (let offset = 0; offset + 512 <= buffer.length; ) {
		const header = buffer.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) {
			break;
		}
		const name = readTarString(header, 0, 100);
		const prefix = readTarString(header, 345, 155);
		const size = readTarOctal(header, 124, 12);
		const mtime = readTarOctal(header, 136, 12);
		const type = readTarString(header, 156, 1) || "0";
		const entryPath = prefix ? `${prefix}/${name}` : name;
		if (type === "0") {
			entries.push({ path: entryPath, size, mtime });
		}
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function readTarString(buffer, offset, length) {
	const end = buffer.indexOf(0, offset);
	const boundedEnd = end >= offset && end < offset + length ? end : offset + length;
	return buffer.toString("utf8", offset, boundedEnd);
}

function readTarOctal(buffer, offset, length) {
	const value = readTarString(buffer, offset, length).trim();
	return value ? Number.parseInt(value, 8) : 0;
}
