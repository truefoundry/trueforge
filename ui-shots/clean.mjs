import { readdir, unlink } from 'node:fs/promises';
import { URL } from 'node:url';

const directory = import.meta.dirname;
const entries = await readdir(directory, { withFileTypes: true });
const screenshots = entries.filter(entry => entry.isFile() && entry.name.endsWith('.png'));

await Promise.all(screenshots.map(entry => unlink(new URL(entry.name, import.meta.url))));
console.log(`Removed ${String(screenshots.length)} screenshot(s) from ui-shots/`);
