// src/archive-writer.ts

import fs from "node:fs";
import yazl from "yazl";
import { TarArchiveWriter } from "./tar-writer.js";
import type { ArchiveFormat, ArchiveOptions } from "./types.js";

export interface ArchiveWriter {
	addBuffer(buffer: Buffer, relativePath: string): Promise<void>;
	addFile(fullPath: string, relativePath: string, size: number): Promise<void>;
	finalize(): Promise<void>;
}

export async function createArchiveWriter(output: string, options: ArchiveOptions): Promise<ArchiveWriter> {
	if (options.format === "zip") {
		return new ZipArchiveWriter(output, options);
	}
	return await TarArchiveWriter.create(output, options.format, options.compressionLevel);
}

class ZipArchiveWriter implements ArchiveWriter {
	private static readonly deterministicDate = new Date("1980-01-01T00:00:00.000Z");
	private readonly zipfile = new yazl.ZipFile();
	private readonly output: fs.WriteStream;
	private readonly completion: Promise<void>;

	public constructor(
		outputPath: string,
		private readonly options: ArchiveOptions,
	) {
		this.output = fs.createWriteStream(outputPath);
		this.completion = new Promise<void>((resolve, reject) => {
			this.output.on("close", resolve);
			this.output.on("error", reject);
			this.zipfile.on("error", reject);
		});
		this.zipfile.outputStream.pipe(this.output);
	}

	public async addBuffer(buffer: Buffer, relativePath: string): Promise<void> {
		this.zipfile.addBuffer(buffer, relativePath, this.entryOptions());
	}

	public async addFile(fullPath: string, relativePath: string, size: number): Promise<void> {
		if (size <= this.options.smallFileBufferThreshold) {
			const buffer = await fs.promises.readFile(fullPath);
			await this.addBuffer(buffer, relativePath);
			return;
		}
		this.zipfile.addFile(fullPath, relativePath, this.entryOptions());
	}

	public async finalize(): Promise<void> {
		this.zipfile.end();
		await this.completion;
	}

	private entryOptions() {
		return {
			mtime: ZipArchiveWriter.deterministicDate,
			compress: this.options.compressionLevel > 0,
			compressionLevel: this.options.compressionLevel,
			forceDosTimestamp: true,
		};
	}
}

export function archiveDisplayName(format: ArchiveFormat): string {
	return format === "zip" ? "ZIP" : format.toUpperCase();
}
