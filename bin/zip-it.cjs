#!/usr/bin/env node

"use strict";

// Windows-safe npm bin entrypoint.
// The actual CLI is ESM compiled from TypeScript to dist/cli.js.
// npm generates zip-it.cmd / zip-it.ps1 shims for this file when installed or linked.
import("../dist/cli.js")
	.then((module) => module.main())
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
