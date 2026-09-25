// src/activity.ts

import type { VerbosityLevel } from "./types.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;

type ActivityStream = Readonly<{
	isTTY?: boolean;
	write: (chunk: string) => unknown;
}>;

export class ActivityReporter {
	private timer: NodeJS.Timeout | undefined;
	private frameIndex = 0;
	private message = "";
	private rendered = false;

	public constructor(
		private readonly verbosity: VerbosityLevel,
		private readonly stream: ActivityStream = process.stderr,
	) {}

	public update(message: string, logWhenVerbose = true): void {
		if (this.verbosity >= 1) {
			if (logWhenVerbose) {
				console.log(message);
			}
			return;
		}

		if (!this.stream.isTTY) {
			return;
		}

		this.message = message;
		if (!this.timer) {
			this.render();
			this.timer = setInterval(() => this.render(), SPINNER_INTERVAL_MS);
			this.timer.unref();
		}
	}

	public stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}

		if (this.rendered) {
			this.stream.write("\r\x1b[2K");
			this.rendered = false;
		}
	}

	private render(): void {
		const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
		this.frameIndex++;
		this.stream.write(`\r\x1b[2K${frame} ${this.message}`);
		this.rendered = true;
	}
}
