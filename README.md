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

`zip-it` can adapt ignore rules to the project type.

```bash
npx @da-core/zip-it --profile auto
npx @da-core/zip-it --profile node
npx @da-core/zip-it --profile dotnet
npx @da-core/zip-it --profile none
```

| Profile  | Behavior                                                                      |
| -------- | ----------------------------------------------------------------------------- |
| `auto`   | Detects Node and/or .NET markers and combines matching ignore rules. Default. |
| `node`   | Uses frontend/Node ignore rules.                                              |
| `dotnet` | Uses C#/.NET/Visual Studio/MonoGame friendly ignore rules.                    |
| `none`   | Uses only common, security and IDE safety rules.                              |

The `auto` profile recognizes .NET projects when the root or a direct child directory contains files such as `.sln`, `.slnx`, `.csproj`, `.fsproj`, `.vbproj`, `global.json`, `Directory.Build.props` or `Directory.Build.targets`.

If a project contains both `package.json` and `.sln`/`.csproj`, `auto` combines Node and .NET rules.

## Options

```bash
zip-it [options]

Options:
  --root <path>              Project root. Defaults to current working directory.
  --output <path>            Output ZIP path. Defaults to .artifacts/project.zip.
  --profile <auto|node|dotnet|none>
                             Project profile. Defaults to auto.
  --ignore <glob>            Additional ignore pattern. Can be used multiple times.
  --dry-run                  Show the packaging plan without creating a ZIP.
  --no-media-minify          Keep images, videos and audio unchanged.
  --keep-video-originals     Minify images/audio, but keep videos unchanged.
  --keep-audio-originals     Minify images/videos, but keep audio unchanged.
  -h, --help                 Show help.
```

## Examples

```bash
npx @da-core/zip-it
npx @da-core/zip-it --profile dotnet
npx @da-core/zip-it --profile dotnet --dry-run
npx @da-core/zip-it --profile dotnet --no-media-minify
npx @da-core/zip-it --profile dotnet --output .artifacts/calm-ball-source.zip
npx @da-core/zip-it --root ../my-project --output ../my-project.zip
npx @da-core/zip-it --ignore "coverage/**" --ignore "tmp/**"
```

## Optional project config

A project can define `.zip-it.json`. The file is optional.

```json
{
	"profile": "dotnet",
	"output": ".artifacts/project.zip",
	"ignore": ["**/local-recordings/**", "**/*.bak"],
	"media": {
		"minify": true,
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
**/*.keystore
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

## Dry run

```bash
npx @da-core/zip-it --profile dotnet --dry-run
```

Dry run does not create a ZIP. It prints:

- resolved profile,
- included and ignored file counts,
- largest included files,
- media replacement plan,
- sensitive-file warnings.

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
