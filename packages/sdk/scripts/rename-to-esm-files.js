#!/usr/bin/env node

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const extensionMap = {
    ".js": ".mjs",
    ".d.ts": ".d.mts",
};
const oldExtensions = Object.keys(extensionMap);

async function findFiles(rootPath) {
    const files = [];

    async function scan(directory) {
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
                    await scan(fullPath);
                }
            } else if (entry.isFile()) {
                if (oldExtensions.some((ext) => entry.name.endsWith(ext))) {
                    files.push(fullPath);
                }
            }
        }
    }

    await scan(rootPath);
    return files;
}

async function updateFiles(files) {
    const updatedFiles = [];
    for (const file of files) {
        const updated = await updateFileContents(file);
        updatedFiles.push(updated);
    }

    console.log(`Updated imports in ${updatedFiles.length} files.`);
}

const KNOWN_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".json", ".ts", ".mts", ".cts", ".tsx", ".node"]);

function hasFileExtension(importPath) {
    const basename = path.basename(importPath);
    const dotIndex = basename.lastIndexOf(".");
    if (dotIndex <= 0) {
        return false;
    }
    return KNOWN_EXTENSIONS.has(basename.slice(dotIndex).toLowerCase());
}

function resolveExtensionlessImport(dir, importPath) {
    const resolvedPath = path.resolve(dir, importPath);
    if (fsSync.existsSync(`${resolvedPath}.js`)) {
        return `${importPath}.mjs`;
    }
    const indexPath = path.join(resolvedPath, "index.js");
    if (fsSync.existsSync(indexPath)) {
        return `${importPath}/index.mjs`;
    }
    return null;
}

async function updateFileContents(file) {
    const content = await fs.readFile(file, "utf8");
    const dir = path.dirname(file);

    let newContent = content;
    // Update each extension type defined in the map
    for (const [oldExt, newExt] of Object.entries(extensionMap)) {
        // Handle static imports/exports
        const staticRegex = new RegExp(`(import|export)(.+from\\s+['"])(\\.\\.?\\/[^'"]+)(\\${oldExt})(['"])`, "g");
        newContent = newContent.replace(staticRegex, `$1$2$3${newExt}$5`);

        // Handle dynamic imports (yield import, await import, regular import())
        const dynamicRegex = new RegExp(
            `(yield\\s+import|await\\s+import|import)\\s*\\(\\s*['"](\\.\\.\?\\/[^'"]+)(\\${oldExt})['"]\\s*\\)`,
            "g",
        );
        newContent = newContent.replace(dynamicRegex, `$1("$2${newExt}")`);
    }

    // Handle extensionless relative imports (e.g. from "./oauth" or from "../utils").
    // These violate the ESM spec and break Node's ESM loader and Turbopack.
    const staticExtensionless = /(import|export)(.+from\s+['"])(\.\.?\/[^'"]+?)(['"])/g;
    const staticReplacements = [];
    let match;
    while ((match = staticExtensionless.exec(newContent)) !== null) {
        const importPath = match[3];
        if (hasFileExtension(importPath)) continue;
        const resolved = resolveExtensionlessImport(dir, importPath);
        if (resolved != null) {
            staticReplacements.push({
                start: match.index,
                end: match.index + match[0].length,
                replacement: `${match[1]}${match[2]}${resolved}${match[4]}`,
            });
        }
    }
    for (const { start, end, replacement } of staticReplacements.reverse()) {
        newContent = newContent.slice(0, start) + replacement + newContent.slice(end);
    }

    // Handle extensionless dynamic imports
    const dynamicExtensionless = /(yield\s+import|await\s+import|import)\s*\(\s*['"](\.\.?\/[^'"]+?)['"]\s*\)/g;
    const dynamicReplacements = [];
    while ((match = dynamicExtensionless.exec(newContent)) !== null) {
        const importPath = match[2];
        if (hasFileExtension(importPath)) continue;
        const resolved = resolveExtensionlessImport(dir, importPath);
        if (resolved != null) {
            dynamicReplacements.push({
                start: match.index,
                end: match.index + match[0].length,
                replacement: `${match[1]}("${resolved}")`,
            });
        }
    }
    for (const { start, end, replacement } of dynamicReplacements.reverse()) {
        newContent = newContent.slice(0, start) + replacement + newContent.slice(end);
    }

    if (content !== newContent) {
        await fs.writeFile(file, newContent, "utf8");
        return true;
    }
    return false;
}

async function renameFiles(files) {
    let counter = 0;
    for (const file of files) {
        const ext = oldExtensions.find((ext) => file.endsWith(ext));
        const newExt = extensionMap[ext];

        if (newExt) {
            const newPath = file.slice(0, -ext.length) + newExt;
            await fs.rename(file, newPath);
            counter++;
        }
    }

    console.log(`Renamed ${counter} files.`);
}

async function main() {
    try {
        const targetDir = process.argv[2];
        if (!targetDir) {
            console.error("Please provide a target directory");
            process.exit(1);
        }

        const targetPath = path.resolve(targetDir);
        const targetStats = await fs.stat(targetPath);

        if (!targetStats.isDirectory()) {
            console.error("The provided path is not a directory");
            process.exit(1);
        }

        console.log(`Scanning directory: ${targetDir}`);

        const files = await findFiles(targetDir);

        if (files.length === 0) {
            console.log("No matching files found.");
            process.exit(0);
        }

        console.log(`Found ${files.length} files.`);
        await updateFiles(files);
        await renameFiles(files);
        console.log("\nDone!");
    } catch (error) {
        console.error("An error occurred:", error.message);
        process.exit(1);
    }
}

main();
