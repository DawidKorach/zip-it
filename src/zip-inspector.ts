// src/zip-inspector.ts

import fs from "node:fs";
import type { ArchiveDiagnostics } from "./types.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH = 65_557;

export async function inspectZipArchive(filePath: string): Promise<ArchiveDiagnostics> {
	const stat = await fs.promises.stat(filePath);
	const archiveSize = stat.size;
	const tailLength = Math.min(archiveSize, MAX_EOCD_SEARCH);
	const handle = await fs.promises.open(filePath, "r");

	try {
		const tail = Buffer.alloc(tailLength);
		await handle.read(tail, 0, tailLength, archiveSize - tailLength);
		const eocdOffset = findSignatureFromEnd(tail, EOCD_SIGNATURE);
		if (eocdOffset < 0) {
			return { archiveSize };
		}

		const entries = tail.readUInt16LE(eocdOffset + 10);
		const centralDirectorySize = tail.readUInt32LE(eocdOffset + 12);
		const centralDirectoryOffset = tail.readUInt32LE(eocdOffset + 16);
		if (entries === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
			return { archiveSize };
		}

		const directory = Buffer.alloc(centralDirectorySize);
		await handle.read(directory, 0, centralDirectorySize, centralDirectoryOffset);
		let offset = 0;
		let compressedPayloadSize = 0;

		for (let index = 0; index < entries; index++) {
			if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
				return { archiveSize };
			}
			const compressedSize = directory.readUInt32LE(offset + 20);
			if (compressedSize === 0xffffffff) {
				return { archiveSize };
			}
			compressedPayloadSize += compressedSize;
			const nameLength = directory.readUInt16LE(offset + 28);
			const extraLength = directory.readUInt16LE(offset + 30);
			const commentLength = directory.readUInt16LE(offset + 32);
			offset += 46 + nameLength + extraLength + commentLength;
		}

		return {
			archiveSize,
			compressedPayloadSize,
			archiveMetadataSize: archiveSize - compressedPayloadSize,
		};
	} finally {
		await handle.close();
	}
}

function findSignatureFromEnd(buffer: Buffer, signature: number): number {
	for (let offset = buffer.length - 4; offset >= 0; offset--) {
		if (buffer.readUInt32LE(offset) === signature) {
			return offset;
		}
	}
	return -1;
}
