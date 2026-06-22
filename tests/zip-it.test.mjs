import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { mergeOptions, parseRawCliOptions, readProjectConfig } from "../dist/config.js";
import { getDefaultIgnorePatterns } from "../dist/ignore-patterns.js";
import { getFileKind } from "../dist/media.js";
import { detectProjectKinds, resolveProfile } from "../dist/profile.js";
import { scanProjectFiles } from "../dist/scanner.js";

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
	const ignorePatterns = getDefaultIgnorePatterns(profile.effectiveProfile);
	const scan = await scanProjectFiles(root, ignorePatterns);

	return { detected, profile, scan };
}

test("parses --profile and rejects unsupported values", async () => {
	await assert.rejects(
		() => execFileAsync(process.execPath, ["dist/cli.js", "--profile", "php"], { cwd: process.cwd() }),
		/error: Command failed|Invalid profile: php/i,
	);

	const raw = parseRawCliOptions(["--profile", "dotnet", "--dry-run"]);
	assert.equal(raw.profile, "dotnet");
	assert.equal(raw.dryRun, true);
});

test("auto-detects Node projects", async () => {
	const root = await createTempProject();
	await writeFile(root, "package.json", "{}\n");

	const { detected, profile } = await scanWithProfile(root);

	assert.deepEqual(detected, { node: true, dotnet: false });
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

	assert.deepEqual(detected, { node: false, dotnet: true });
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

	assert.deepEqual(detected, { node: true, dotnet: true });
	assert.equal(profile.effectiveProfile, "node+dotnet");
	assert.deepEqual(scan.files, ["Game.sln", "package.json", "src/Game/Game.csproj"]);
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
			media: { minify: false, keepAudioOriginals: true },
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
	assert.deepEqual(options.media, { minify: false, keepVideoOriginals: true, keepAudioOriginals: true });
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
