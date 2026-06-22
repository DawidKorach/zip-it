#!/usr/bin/env node

"use strict";

// Windows-safe npm bin entrypoint.
// The actual CLI is ESM compiled from TypeScript to dist/dotnet-init-cli.js.
// npm generates zip-it-dotnet-init.cmd / zip-it-dotnet-init.ps1 shims for this file when installed or linked.
import("../dist/dotnet-init-cli.js")
	.then((module) => module.main())
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
