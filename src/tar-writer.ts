// src/tar-writer.ts

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PassThrough, type Writable } from "node:stream";
import { createGzip } from "node:zlib";
import type { ArchiveWriter } from "./archive-writer.js";
import type { ArchiveFormat } from "./types.js";

const TAR_BLOCK_SIZE = 512;
const TAR_END_SIZE = TAR_BLOCK_SIZE * 2;
const DETERMINISTIC_MTIME_SECONDS = Math.floor(new Date("1980-01-01T00:00:00.000Z").getTime() / 1000);

export class TarArchiveWriter implements ArchiveWriter {
	private paxIndex = 0;

	private constructor(
		private readonly input: Writable,
		private readonly completion: Promise<void>,
	) {}

	public static async create(
		outputPath: string,
		format: Exclude<ArchiveFormat, "zip">,
		compressionLevel: number,
	): Promise<TarArchiveWriter> {
		if (format === "tar.gz") {
			const output = fs.createWriteStream(outputPath);
			const input = new PassThrough();
			const gzip = createGzip({ level: compressionLevel });
			const completion = streamCompletion(output, [input, gzip]);
			input.pipe(gzip).pipe(output);
			return new TarArchiveWriter(input, completion);
		}

		const command = format === "tar.xz" ? "xz" : "zstd";
		const args = format === "tar.xz" ? ["-c", `-${compressionLevel}`] : ["-q", "-c", `-${compressionLevel}`];
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		await waitForSpawn(command, child);
		const output = fs.createWriteStream(outputPath);
		const completion = processCompletion(command, child, output);
		child.stdout.pipe(output);
		return new TarArchiveWriter(child.stdin, completion);
	}

	public async addBuffer(buffer: Buffer, relativePath: string): Promise<void> {
		await this.writeEntryHeader(relativePath, buffer.length);
		await writeBuffer(this.input, buffer);
		await this.writePadding(buffer.length);
	}

	public async addFile(fullPath: string, relativePath: string, size: number): Promise<void> {
		await this.writeEntryHeader(relativePath, size);
		const source = fs.createReadStream(fullPath);
		for await (const chunk of source) {
			await writeBuffer(this.input, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		await this.writePadding(size);
	}

	public async finalize(): Promise<void> {
		await writeBuffer(this.input, Buffer.alloc(TAR_END_SIZE));
		this.input.end();
		await this.completion;
	}

	private async writeEntryHeader(relativePath: string, size: number): Promise<void> {
		const normalizedPath = relativePath.replace(/\\/g, "/");
		const split = splitUstarPath(normalizedPath);

		if (!split || !isAscii(normalizedPath)) {
			const pax = createPaxPathRecord(normalizedPath);
			const paxName = `.zip-it/pax/${String(this.paxIndex++).padStart(8, "0")}`;
			await writeBuffer(this.input, createTarHeader(paxName, pax.length, "x"));
			await writeBuffer(this.input, pax);
			await this.writePadding(pax.length);
		}

		const fallback = split ?? createFallbackPath(normalizedPath);
		await writeBuffer(this.input, createTarHeader(fallback.name, size, "0", fallback.prefix));
	}

	private async writePadding(size: number): Promise<void> {
		const padding = (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
		if (padding > 0) {
			await writeBuffer(this.input, Buffer.alloc(padding));
		}
	}
}

function createTarHeader(name: string, size: number, type: "0" | "x", prefix = ""): Buffer {
	const header = Buffer.alloc(TAR_BLOCK_SIZE);
	writeString(header, 0, 100, name);
	writeOctal(header, 100, 8, 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, size);
	writeOctal(header, 136, 12, DETERMINISTIC_MTIME_SECONDS);
	header.fill(0x20, 148, 156);
	header.write(type, 156, 1, "ascii");
	writeString(header, 257, 6, "ustar\0");
	writeString(header, 263, 2, "00");
	writeString(header, 265, 32, "zip-it");
	writeString(header, 297, 32, "zip-it");
	writeString(header, 345, 155, prefix);

	let checksum = 0;
	for (const byte of header) {
		checksum += byte;
	}
	const checksumText = checksum.toString(8).padStart(6, "0");
	header.write(checksumText, 148, 6, "ascii");
	header[154] = 0;
	header[155] = 0x20;
	return header;
}

function splitUstarPath(value: string): { name: string; prefix: string } | undefined {
	if (Buffer.byteLength(value, "utf8") <= 100) {
		return { name: value, prefix: "" };
	}

	for (let index = value.lastIndexOf("/"); index > 0; index = value.lastIndexOf("/", index - 1)) {
		const prefix = value.slice(0, index);
		const name = value.slice(index + 1);
		if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) {
			return { name, prefix };
		}
	}
	return undefined;
}

function createFallbackPath(value: string): { name: string; prefix: string } {
	const basename = path.posix.basename(value) || "file";
	return { name: truncateUtf8(basename, 100), prefix: "" };
}

function createPaxPathRecord(value: string): Buffer {
	const payload = `path=${value}\n`;
	let length = Buffer.byteLength(payload, "utf8") + 3;
	while (true) {
		const record = `${length} ${payload}`;
		const actualLength = Buffer.byteLength(record, "utf8");
		if (actualLength === length) {
			return Buffer.from(record, "utf8");
		}
		length = actualLength;
	}
}

function truncateUtf8(value: string, maxBytes: number): string {
	let result = "";
	for (const character of value) {
		if (Buffer.byteLength(result + character, "utf8") > maxBytes) {
			break;
		}
		result += character;
	}
	return result || "file";
}

function writeString(buffer: Buffer, offset: number, length: number, value: string): void {
	buffer.write(value, offset, Math.min(length, Buffer.byteLength(value, "utf8")), "utf8");
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`TAR field value is outside the supported range: ${value}`);
	}
	const text = value.toString(8);
	if (text.length > length - 1) {
		throw new Error(`TAR field value is too large: ${value}`);
	}
	buffer.write(text.padStart(length - 1, "0"), offset, length - 1, "ascii");
	buffer[offset + length - 1] = 0;
}

function isAscii(value: string): boolean {
	return /^[\x00-\x7f]*$/.test(value);
}

async function writeBuffer(stream: Writable, buffer: Buffer): Promise<void> {
	if (stream.destroyed) {
		throw new Error("Archive output stream was closed unexpectedly.");
	}
	if (stream.write(buffer)) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const onDrain = (): void => {
			cleanup();
			resolve();
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const cleanup = (): void => {
			stream.off("drain", onDrain);
			stream.off("error", onError);
		};
		stream.once("drain", onDrain);
		stream.once("error", onError);
	});
}

async function waitForSpawn(command: string, child: ChildProcessWithoutNullStreams): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const onSpawn = (): void => {
			cleanup();
			resolve();
		};
		const onError = (error: NodeJS.ErrnoException): void => {
			cleanup();
			if (error.code === "ENOENT") {
				reject(new Error(`${command} executable was not found. Install it or choose zip/tar.gz.`));
				return;
			}
			reject(error);
		};
		const cleanup = (): void => {
			child.off("spawn", onSpawn);
			child.off("error", onError);
		};
		child.once("spawn", onSpawn);
		child.once("error", onError);
	});
}

function streamCompletion(output: fs.WriteStream, streams: readonly NodeJS.EventEmitter[]): Promise<void> {
	return new Promise((resolve, reject) => {
		output.once("close", resolve);
		output.once("error", reject);
		for (const stream of streams) {
			stream.once("error", reject);
		}
	});
}

function processCompletion(
	command: string,
	child: ChildProcessWithoutNullStreams,
	output: fs.WriteStream,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const stderr: Buffer[] = [];
		let processClosed = false;
		let outputClosed = false;
		let exitCode: number | null = null;

		const tryResolve = (): void => {
			if (!processClosed || !outputClosed) {
				return;
			}
			if (exitCode === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} failed with exit code ${exitCode}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
		};

		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				reject(new Error(`${command} executable was not found. Install it or choose zip/tar.gz.`));
				return;
			}
			reject(error);
		});
		child.once("close", (code) => {
			exitCode = code;
			processClosed = true;
			tryResolve();
		});
		output.once("close", () => {
			outputClosed = true;
			tryResolve();
		});
		output.once("error", reject);
		child.stdin.once("error", reject);
		child.stdout.once("error", reject);
	});
}
