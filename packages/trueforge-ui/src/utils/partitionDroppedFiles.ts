type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

/**
 * Split a drop into attachable files vs directories.
 * Prefer `webkitGetAsEntry` so folders never become composer attachments.
 */
export function partitionDroppedFiles(dataTransfer: DataTransfer): {
  files: File[];
  rejectedDirectoryCount: number;
} {
  const items = dataTransfer.items;
  if (items.length > 0) {
    const files: File[] = [];
    let rejectedDirectoryCount = 0;
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;
      const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null;
      if (entry?.isDirectory === true) {
        rejectedDirectoryCount += 1;
        continue;
      }
      const file = item.getAsFile();
      if (file != null) files.push(file);
    }
    return { files, rejectedDirectoryCount };
  }

  return { files: Array.from(dataTransfer.files), rejectedDirectoryCount: 0 };
}
