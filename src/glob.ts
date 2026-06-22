// src/glob.ts

export function toPosixPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export type GlobMatcher = Readonly<{
	pattern: string;
	matches: (relativePath: string) => boolean;
}>;

export function createGlobMatchers(patterns: readonly string[]): GlobMatcher[] {
	return patterns.map((pattern) => {
		const regex = globToRegExp(toPosixPath(pattern));

		return {
			pattern,
			matches: (relativePath: string) => regex.test(toPosixPath(relativePath)),
		};
	});
}

export function matchesAny(relativePath: string, matchers: readonly GlobMatcher[]): boolean {
	return matchers.some((matcher) => matcher.matches(relativePath));
}

function globToRegExp(pattern: string): RegExp {
	const segments = pattern.split("/").filter((segment) => segment.length > 0);
	let source = "^";

	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		const isLast = index === segments.length - 1;

		if (segment === "**") {
			if (isLast) {
				source += ".*";
			} else {
				source += "(?:[^/]+/)*";
			}
			continue;
		}

		source += globSegmentToRegExp(segment);

		if (!isLast) {
			source += "/";
		}
	}

	source += "$";
	return new RegExp(source);
}

function globSegmentToRegExp(segment: string): string {
	let source = "";

	for (const char of segment) {
		switch (char) {
			case "*":
				source += "[^/]*";
				break;
			case "?":
				source += "[^/]";
				break;
			default:
				source += escapeRegExp(char);
		}
	}

	return source;
}

function escapeRegExp(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
