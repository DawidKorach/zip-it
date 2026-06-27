# @da-core/zip-it

Create a lightweight ZIP archive of a project.

The tool keeps source files intact, but can replace image, video and audio assets inside the generated ZIP with tiny valid placeholder files. It is designed for sharing source code for review, audit, LLM analysis, migration or consultation. It is **not** a production build or release packaging tool.

## Usage

```bash
npx @da-core/zip-it
```

Default output:

```txt
.artifacts/project.zip
```

## Project profiles

`zip-it` adapts ignore rules to detected project architectures. New architectures are registered in `src/project-architectures.ts`; each registration owns its detection logic and its architecture-specific ignore groups.

```bash
npx @da-core/zip-it --profile auto
npx @da-core/zip-it --profile node
npx @da-core/zip-it --profile dotnet
npx @da-core/zip-it --profile android
npx @da-core/zip-it --profile none
```

| Profile   | Behavior                                                                                     |
| --------- | -------------------------------------------------------------------------------------------- |
| `auto`    | Detects known architectures and combines matching ignore rules. Default.                      |
| `node`    | Uses frontend/Node ignore rules.                                                             |
| `dotnet`  | Uses C#/.NET/Visual Studio/MonoGame friendly ignore rules.                                    |
| `android` | Uses Android Studio / Gradle / Kotlin friendly ignore rules.                                  |
| `none`    | Uses only common, security and IDE safety rules.                                              |

The `auto` profile recognizes:

- Node projects from `package.json` in the root or a direct child directory.
- .NET projects from `.sln`, `.slnx`, `.csproj`, `.fsproj`, `.vbproj`, `global.json`, `Directory.Build.props` or `Directory.Build.targets` in the root or a direct child directory.
- Android Gradle projects from Gradle settings/wrapper markers plus either an Android manifest or Android Gradle plugin usage such as `com.android.application` or `com.android.library`.

When multiple architectures are detected, `auto` combines them in registry order, for example `node+dotnet`, `dotnet+android` or `node+dotnet+android`.

## Options

```bash
zip-it [options]

Options:
  --root <path>              Project root. Defaults to current working directory.
  --output <path>            Output ZIP path. Defaults to .artifacts/project.zip.
  --profile <auto|node|dotnet|android|none>
                             Project profile. Defaults to auto.
  --ignore <glob>            Additional ignore pattern. Can be used multiple times.
  --dry-run                  Show the packaging plan without creating a ZIP.
  --no-media-minify          Keep images, videos and audio unchanged.
  --media-mode <tiny|preserve-shape>
                             Media minimization mode. Defaults to tiny.
  --preserve-media-shape     Alias for --media-mode preserve-shape.
  --keep-video-originals     Minify images/audio, but keep videos unchanged.
  --keep-audio-originals     Minify images/videos, but keep audio unchanged.
  -v, --verbose [0|1|2|3|dev]
                             Increase output detail. Without a value, uses level 1.
                             Repeated -v flags are supported: -v, -vv, -vvv, -vvvv.
  -h, --help                 Show help.
```

## Examples

```bash
npx @da-core/zip-it
npx @da-core/zip-it --profile dotnet
npx @da-core/zip-it --profile android
npx @da-core/zip-it --profile android --dry-run
npx @da-core/zip-it --profile android -v
npx @da-core/zip-it --profile android --verbose 2
npx @da-core/zip-it --profile android --verbose dev
npx @da-core/zip-it --profile dotnet --dry-run
npx @da-core/zip-it --profile dotnet --no-media-minify
npx @da-core/zip-it --profile dotnet --media-mode preserve-shape
npx @da-core/zip-it --profile dotnet --output .artifacts/calm-ball-source.zip
npx @da-core/zip-it --root ../my-project --output ../my-project.zip
npx @da-core/zip-it --ignore "coverage/**" --ignore "tmp/**"
```

## Console output verbosity

The default output is intentionally compact. Use `--verbose` / `-v` when you need more detail.

| Level | Usage examples | Output style |
| ----- | -------------- | ------------ |
| `0` | default, `--verbose 0` | Compact final summary only. |
| `1` | `-v`, `--verbose`, `--verbose 1` | Human-friendly progress, resolved basics and largest included files. |
| `2` | `-vv`, `--verbose 2` | Diagnostic profile/media details, including detected architectures and ignore groups. |
| `3` | `-vvv`, `--verbose 3` | Level 2 plus full included-file listing. |
| `dev` | `-vvvv`, `--verbose dev` | Level 3 plus resolved CLI internals useful while developing `zip-it`. |

Recommended day-to-day usage is level `0` or `1`. Use `2+` only when validating ignore rules, profile detection or media behavior.

## Optional project config

A project can define `.zip-it.json`. The file is optional.

```json
{
	"profile": "dotnet",
	"output": ".artifacts/project.zip",
	"ignore": ["**/local-recordings/**", "**/*.bak"],
	"media": {
		"minify": true,
		"mode": "tiny",
		"keepVideoOriginals": false,
		"keepAudioOriginals": false
	}
}
```

Configuration priority:

1. CLI options
2. `.zip-it.json`
3. profile auto-detection
4. defaults

## Ignore rules

The rules are split into explicit groups:

- common rules,
- security rules,
- IDE rules,
- Node rules,
- .NET rules,
- Android rules,
- mixed project build safety rules.

### Always ignored

```txt
.artifacts/**
**/.artifacts/**
**/.git/**
**/*.zip
**/*.log
**/.DS_Store
**/Thumbs.db
```

### Security-sensitive files

Sensitive files are ignored by default and reported as warnings when encountered.

```txt
**/.env
**/.env.*
**/*.pfx
**/*.p12
**/*.pem
**/*.key
**/*.jks
**/*.keystore
**/keystore.properties
**/secrets.json
**/appsettings.Local.json
**/appsettings.*.Local.json
```

### .NET support

For `--profile dotnet`, generated build artifacts and machine-local Visual Studio files are ignored, for example:

```txt
**/bin/**
**/obj/**
**/.vs/**
**/TestResults/**
**/BenchmarkDotNet.Artifacts/**
**/packages/**
**/publish/**
**/*.user
**/*.rsuser
**/*.suo
**/*.nupkg
**/*.snupkg
```

MonoGame Content Pipeline generated artifacts are also ignored:

```txt
**/Content/bin/**
**/Content/obj/**
```

Source files such as `.sln`, `.slnx`, `.csproj`, `.props`, `.targets`, `.cs`, `.xaml`, `.resx`, `.json`, `.config`, `.md`, `.txt`, `.mgcb`, `.fx` and `.spritefont` are kept unless explicitly ignored.

Unlike the Node profile, the .NET profile does **not** globally ignore `build/`, because .NET repositories often keep hand-written `.props`, `.targets`, scripts or NuGet-related files there.

### Android Studio / Gradle support

For `--profile android`, generated Gradle, Kotlin and Android Studio build artifacts are ignored, for example:

```txt
**/.gradle/**
**/.kotlin/**
**/.cxx/**
**/.externalNativeBuild/**
**/captures/**
**/*/build/**
build/**                    # only when no .NET architecture is active
**/local.properties
**/*.apk
**/*.aab
**/*.ap_
**/*.dex
**/*.hprof
```

Source and project files such as `settings.gradle`, `settings.gradle.kts`, `build.gradle`, `build.gradle.kts`, `gradle.properties`, `gradlew`, `gradle/wrapper/gradle-wrapper.properties`, `gradle/wrapper/gradle-wrapper.jar`, `AndroidManifest.xml`, Kotlin/Java sources and Android resources are kept unless explicitly ignored.

The `.idea` handling is intentionally selective. Machine-local IntelliJ/Android Studio files such as `.idea/caches`, `workspace.xml`, shelves, HTTP requests and data-source local files are ignored, while shareable files such as `.idea/codeStyles` can be included.

When Android and .NET are both active, root-level `build/**` is not ignored by the Android profile. This keeps repository-level .NET files such as `build/Directory.Build.targets` safe, while module build folders such as `app/build/**` are still ignored.

## Dry run

```bash
npx @da-core/zip-it --profile dotnet --dry-run
```

Dry run does not create a ZIP. At verbosity level `0`, it prints a compact plan summary. At level `1+`, it also prints the largest included files. At level `2+`, it includes diagnostic profile/media details. At level `3`, it prints the full included-file list.

## Media minimization

Images are replaced with tiny valid placeholders for:

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.svg`
- `.bmp`

Videos are minimized for:

- `.mp4`
- `.webm`
- `.mov`
- `.m4v`
- `.mkv`
- `.avi`

Audio is minimized for:

- `.wav`
- `.mp3`
- `.ogg`
- `.flac`
- `.m4a`
- `.wma`

Video and audio minimization use `ffmpeg` when needed. If `ffmpeg` is not available, those files are kept unchanged and the tool prints a warning.

### Preserving image dimensions

The default media mode is `tiny`, which keeps the generated ZIP as small as possible by replacing images with 1x1 placeholders. For MonoGame projects this can be too aggressive, because `Content.mgcb` and the Content Pipeline may expect source textures to keep their original dimensions.

Use `preserve-shape` when image dimensions matter:

```bash
npx @da-core/zip-it --profile dotnet --media-mode preserve-shape
# or
npx @da-core/zip-it --profile dotnet --preserve-media-shape
```

Or configure it in `.zip-it.json`:

```json
{
	"media": {
		"minify": true,
		"mode": "preserve-shape"
	}
}
```

In `preserve-shape` mode, images are still replaced with lightweight valid files, but generated placeholders keep the original width and height when possible. The mode currently supports shape-preserving placeholders for `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg` and `.bmp`. If a shape-preserving placeholder cannot be generated safely, the original image is kept and a warning is printed. `.webp` files are therefore kept original in this mode instead of being degraded to 1x1.

Metadata such as EXIF is intentionally not preserved by default. It can be large and may contain local or sensitive information. For video and audio, the existing minimization behavior is unchanged; use `--keep-video-originals`, `--keep-audio-originals` or `--no-media-minify` when those files must remain untouched.

## .NET solution initialization

`zip-it` itself only reads project files and creates the ZIP. It does not modify `.sln` or `.slnx` files.

When you explicitly want the generated ZIP path to appear in Visual Studio as a Solution Item, run the separate .NET init command:

```bash
npx -p @da-core/zip-it zip-it-dotnet-init
```

This command adds `.artifacts/project.zip` to the `Solution Items` folder of a `.sln` or `.slnx` file. It is intentionally a separate executable because it modifies solution files. The package also exposes `@da-core/zip-it/dotnet-init` as a programmatic subpath export, while CLI usage should go through the `zip-it-dotnet-init` binary shown above.

```bash
zip-it-dotnet-init [options]

Options:
  --root <path>          Project root. Defaults to current working directory.
  --solution <path>      Specific .sln or .slnx file. Required when multiple solutions are found.
  --zip <path>           ZIP path to add as a Solution Item. Defaults to .artifacts/project.zip.
  --dry-run              Show what would change without writing the solution file.
  -h, --help             Show help.
```

Examples:

```bash
npx -p @da-core/zip-it zip-it-dotnet-init --dry-run
npx -p @da-core/zip-it zip-it-dotnet-init --solution Game.sln
npx -p @da-core/zip-it zip-it-dotnet-init --zip .artifacts/calm-ball-source.zip
```

For `.slnx`, the command adds a structure like:

```xml
<Folder Name="/Solution Items/">
  <File Path=".artifacts/project.zip" />
</Folder>
```

For legacy `.sln`, the command adds or updates a standard `Solution Items` solution folder and a `ProjectSection(SolutionItems)` entry.

## Publish

```bash
npm login
npm publish --access public
```

The package already contains:

```json
{
	"publishConfig": {
		"access": "public"
	}
}
```

so a plain `npm publish` should also publish it publicly for the configured scope.

## Local development

```bash
npm install
npm run build
npm test
node dist/cli.js --help
node dist/dotnet-init-cli.js --help
```

Or link globally:

```bash
npm link
zip-it --help
zip-it-dotnet-init --help
```
