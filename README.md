# @da-core/zip-it

Create lightweight, deterministic project archives for code review, audit, LLM analysis, migration and consultation.

`zip-it` keeps source files intact and can replace image, video and audio assets with valid lightweight placeholders. It is not a production build or release packager.

## Usage

```bash
npx @da-core/zip-it
```

In a Git repository, the default behavior is equivalent to:

```bash
npx @da-core/zip-it --selection git-visible --format zip
```

Default output:

```txt
.artifacts/project.zip
```

## Core pipeline

The implementation separates five decisions:

1. **Profile** — which architecture-specific ignore rules are active.
2. **Selection** — which files are visible to the packager.
3. **Scope** — full repository or a selected .NET project graph.
4. **Media transformation** — original files or lightweight placeholders.
5. **Archive writer** — ZIP, gzip-compressed TAR, XZ-compressed TAR or Zstandard-compressed TAR.

This separation keeps Git behavior, project graph logic and archive-format concerns independent.

## Options

```txt
zip-it [options]

--root <path>              Project root. Defaults to current working directory.
--output <path>            Output path. Defaults to .artifacts/project.<format>.
--target <name>            Apply a named target from .zip-it.json.
--profile <auto|node|python|dotnet|android|none>
                           Project profile. Defaults to auto.
--selection <auto|filesystem|git-visible|git-tracked>
                           File selection strategy. Auto prefers git-visible.
--format <zip|tar.gz|tar.xz|tar.zst>
                           Archive format. Defaults to zip.
--compression-level <0-9>  Compression level. Defaults to 6.
--small-file-buffer-threshold <bytes>
                           ZIP files at or below this size are buffered to reduce
                           per-entry metadata. Defaults to 262144.
--project <path.csproj>     Package a .NET project, transitive ProjectReference
                           dependencies and related test projects.
--no-related-tests         Do not include tests related to --project.
--no-root-files            Do not include repository-level support files in project scope.
--ignore <glob>            Additional ignore pattern. Can be used multiple times.
--dry-run                  Show the packaging plan without creating an archive.
--no-media-minify          Keep images, videos and audio unchanged.
--media-mode <tiny|preserve-shape>
                           Media minimization mode. Defaults to tiny.
--preserve-media-shape     Alias for --media-mode preserve-shape.
--keep-video-originals     Minify images/audio, but keep videos unchanged.
--keep-audio-originals     Minify images/videos, but keep audio unchanged.
-v, --verbose [0|1|2|3|dev]
                           Increase output detail. Repeated -v flags are supported.
-h, --help                 Show help.
```

## File selection

| Mode          | Behavior                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `auto`        | Uses `git-visible` inside a Git work tree; otherwise falls back to `filesystem` with a warning. |
| `filesystem`  | Recursively scans the filesystem and applies `zip-it` ignore rules.                             |
| `git-visible` | Uses tracked files plus visible untracked files, respecting Git ignore rules.                   |
| `git-tracked` | Uses only files known to the Git index.                                                         |

`git-visible` is based on the equivalent of:

```bash
git ls-files -z --cached --others --exclude-standard
```

This means generated paths already covered by `.gitignore` do not need to be duplicated in `.zip-it.json`. Explicit `zip-it` ignore and security rules are still applied after Git selection.

Examples:

```bash
zip-it --selection auto
zip-it --selection git-visible
zip-it --selection git-tracked
zip-it --selection filesystem
```

Explicit Git modes fail when Git is unavailable or the root is not a Git work tree. They never silently change to filesystem selection.

## Archive formats

| Format    | Implementation  | Notes                                                                           |
| --------- | --------------- | ------------------------------------------------------------------------------- |
| `zip`     | `yazl`          | Maximum compatibility; each file is compressed independently.                   |
| `tar.gz`  | Node.js `zlib`  | Portable solid compression without an external executable.                      |
| `tar.xz`  | external `xz`   | Strong compression; `xz` must be available on `PATH`.                           |
| `tar.zst` | external `zstd` | Strong compression with fast decompression; `zstd` must be available on `PATH`. |

Examples:

```bash
zip-it --format zip
zip-it --format tar.gz --compression-level 9
zip-it --format tar.xz --compression-level 9
zip-it --format tar.zst --compression-level 9
```

TAR archives use deterministic file timestamps. ZIP entries use a deterministic DOS timestamp and disable the additional universal timestamp field. Original files no larger than `smallFileBufferThreshold` are added to ZIP from a buffer, avoiding data descriptors for the common source-file case.

ZIP reports additionally show:

- transformed input bytes,
- compressed file payload,
- ZIP metadata and framing,
- final archive size.

For repositories with thousands of small files and long paths, `tar.gz`, `tar.xz` and `tar.zst` can be materially smaller because the compressor sees the whole TAR stream instead of compressing every file independently.

## .NET project scope

Package one project and the statically discoverable files needed to understand it:

```bash
zip-it --project src/CalmBall2D.WindowsDX/CalmBall2D.WindowsDX.csproj
```

The scope resolver includes:

- the selected `.csproj`,
- transitive `ProjectReference` projects,
- files under selected project directories,
- related test projects that reference the selected graph,
- static external `Compile`, `Content`, `None`, `EmbeddedResource` and `AdditionalFiles` includes,
- static `Import` files,
- ancestor `Directory.Build.*` and `Directory.Packages.*` files,
- common repository-level support files such as `global.json`, solution files, `.editorconfig`, README and license files.

Disable optional additions with:

```bash
zip-it --project src/App/App.csproj --no-related-tests
zip-it --project src/App/App.csproj --no-root-files
```

This is intentionally a static project-graph resolver, not a replacement for MSBuild evaluation. Paths containing MSBuild expressions such as `$(Property)` or `@(Item)` are reported as warnings instead of being guessed. A referenced project excluded by the active selection or ignore rules is treated as an error because silently producing an incomplete graph would be unsafe.

## Project profiles

`zip-it` adapts ignore rules to detected project architectures. Architectures are registered in `src/project-architectures.ts`.

```bash
zip-it --profile auto
zip-it --profile node
zip-it --profile python
zip-it --profile dotnet
zip-it --profile android
zip-it --profile none
```

| Profile   | Behavior                                                 |
| --------- | -------------------------------------------------------- |
| `auto`    | Detects known architectures and combines matching rules. |
| `node`    | Uses frontend and Node ignore rules.                     |
| `dotnet`  | Uses C#/.NET/Visual Studio/MonoGame-friendly rules.      |
| `android` | Uses Android Studio, Gradle and Kotlin-friendly rules.   |
| `none`    | Uses only common, security and IDE safety rules.         |

Multiple detected architectures are combined, for example `node+dotnet` or `dotnet+android`.

## `.zip-it.json` version 2

The configuration file remains optional. Existing version-1-style configuration continues to work.

```json
{
	"version": 2,
	"profile": "dotnet",
	"selection": {
		"mode": "git-visible"
	},
	"archive": {
		"format": "zip",
		"compressionLevel": 6,
		"smallFileBufferThreshold": 262144
	},
	"scope": {
		"mode": "full",
		"includeRelatedTests": true,
		"includeRootFiles": true
	},
	"ignore": ["src/**/Content/Generated/**"],
	"media": {
		"minify": true,
		"mode": "preserve-shape",
		"keepVideoOriginals": false,
		"keepAudioOriginals": false
	}
}
```

Configuration priority:

1. CLI options,
2. selected target,
3. root `.zip-it.json` values,
4. defaults.

Ignore arrays are additive: root ignores, target ignores and repeated CLI `--ignore` values are combined.

## Named targets

Targets provide repeatable archive variants without duplicating configuration files or scripts.

```json
{
	"version": 2,
	"profile": "dotnet",
	"selection": {
		"mode": "git-visible"
	},
	"media": {
		"minify": true,
		"mode": "preserve-shape"
	},
	"ignore": ["src/**/Content/Generated/**"],
	"defaultTarget": "full",
	"targets": {
		"full": {
			"archive": {
				"format": "zip"
			}
		},
		"compact": {
			"archive": {
				"format": "tar.zst",
				"compressionLevel": 9
			}
		},
		"code-review": {
			"archive": {
				"format": "tar.gz",
				"compressionLevel": 9
			},
			"ignore": ["benchmarks/**", "templates/**"]
		},
		"calm-ball-2d": {
			"archive": {
				"format": "tar.gz"
			},
			"scope": {
				"mode": "dotnet-project",
				"project": "src/CalmBall2D.WindowsDX/CalmBall2D.WindowsDX.csproj"
			}
		}
	}
}
```

Usage:

```bash
zip-it --target full
zip-it --target compact
zip-it --target code-review
zip-it --target calm-ball-2d
```

A CLI scalar overrides its target value. For example:

```bash
zip-it --target compact --format zip
```

## BiofeedbackGames recommendation

For a repository where `Assets/Source` and generator recipes are the source of truth, while `src/**/Content/Generated/**` is derived output, a practical configuration is:

```json
{
	"version": 2,
	"profile": "dotnet",
	"selection": {
		"mode": "git-visible"
	},
	"ignore": ["src/**/Content/Generated/**"],
	"media": {
		"minify": true,
		"mode": "preserve-shape"
	},
	"defaultTarget": "full",
	"targets": {
		"full": {
			"archive": {
				"format": "zip",
				"compressionLevel": 9
			}
		},
		"compact": {
			"archive": {
				"format": "tar.zst",
				"compressionLevel": 9
			}
		},
		"review": {
			"archive": {
				"format": "tar.gz",
				"compressionLevel": 9
			},
			"ignore": ["benchmarks/**", "templates/**"]
		}
	}
}
```

With `git-visible`, the explicit `Content/Generated` ignore is technically redundant when Git already ignores that path. Keeping it is still useful as an executable project invariant if someone later changes `.gitignore` or explicitly switches to filesystem selection.

## Ignore rules

Rules are grouped into common, security, IDE, Node, .NET, Android and mixed-project safety groups.

Always ignored examples:

```txt
.artifacts/**
**/.artifacts/**
**/.git/**
**/*.zip
**/*.log
**/.DS_Store
**/Thumbs.db
```

Security-sensitive examples:

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

Sensitive files discovered by the active selection mode are ignored and reported as warnings.

### Python

The Python profile is detected from standard project markers in the archive root or one direct child directory, including `pyproject.toml`, `requirements*.txt`, `setup.py`, `setup.cfg`, `Pipfile`, Poetry/PDM/uv lock files, and Conda environment files.

It ignores virtual environments, bytecode and tool caches, coverage output, package metadata, and conventional Python build artifacts such as `build/` and `dist/`. Detection does not change the archive root: repository-level documentation, GitHub workflows, tests, and other sibling directories remain included. Use `--root` explicitly when only a nested application directory should be archived.

### .NET support

The .NET profile ignores generated build and machine-local artifacts such as:

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
**/Content/bin/**
**/Content/obj/**
```

It does not globally ignore `build/`, because .NET repositories frequently store hand-written `.props`, `.targets`, scripts and NuGet support files there.

### Android support

The Android profile ignores generated Gradle, Kotlin and Android Studio artifacts such as:

```txt
**/.gradle/**
**/.kotlin/**
**/.cxx/**
**/.externalNativeBuild/**
**/captures/**
**/*/build/**
**/local.properties
**/*.apk
**/*.aab
**/*.dex
**/*.hprof
```

When Android and .NET are both active, root-level `build/**` is retained so repository-level .NET support files remain available.

## Media minimization

Supported image extensions include:

```txt
.jpg .jpeg .png .webp .gif .svg .bmp
```

Supported video extensions include:

```txt
.mp4 .webm .mov .m4v .mkv .avi
```

Supported audio extensions include:

```txt
.wav .mp3 .ogg .m4a .aac .flac
```

`tiny` uses the smallest practical valid placeholder. `preserve-shape` keeps supported image dimensions while replacing pixel content. This is useful for MonoGame and other pipelines where dimensions are part of the asset contract.

Video and audio placeholder generation uses `ffmpeg`. If `ffmpeg` is unavailable, those files are kept original and a warning is reported.

## Console verbosity

| Level | Output                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------- |
| `0`   | Compact final summary.                                                                                |
| `1`   | Progress, resolved basics and largest included files.                                                 |
| `2`   | Selection/scope diagnostics, path-length diagnostics, top-level contributors and scoped project list. |
| `3`   | Level 2 plus the complete included-file list.                                                         |
| `dev` | Level 3 plus resolved internal options.                                                               |

Examples:

```bash
zip-it
zip-it -v
zip-it -vv
zip-it -vvv
zip-it --verbose dev
```

## Dry run

```bash
zip-it --target compact --dry-run -vv
```

Dry run performs profile resolution, selection, scope resolution and media planning, but does not create an archive.

## .NET solution initialization

The companion command adds a generated ZIP path to Solution Items in `.sln` and `.slnx` files:

```bash
npx @da-core/zip-it-dotnet-init
```

Default path:

```txt
.artifacts/project.zip
```

Options:

```txt
--root <path>
--zip-path <path>
--dry-run
```

The command remains ZIP-specific for compatibility with the existing solution workflow. Alternative TAR outputs are intended for external sharing and do not need to be added to the solution.

## Local development

```bash
npm install
npm run typecheck
npm test
npm run local -- --dry-run -vv
```

## Publish

```bash
npm login
npm publish --access public
```

The package is configured for public npm publishing and requires Node.js 20 or newer.
