// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

/**
 * Dedicated extensions for virtual views that can open in more than one editor.
 *
 * VS Code names editor associations after the resource extension ("Set Default for '*.ext'").
 * Without one, the association would be '*' (every file), and a type path such as
 * `/DWARF/stdio.h/FILE` would propose '*.h'. A Ghidra-only extension keeps that choice scoped.
 */
/** Virtual filename suffix for listing documents. */
export const listingExtension = '.ghidra-listing';
/** Virtual filename suffix for byte window documents. */
export const bytesExtension = '.ghidra-bytes';
/** Virtual filename suffix for editable data type documents. */
export const typeExtension = '.ghidra-type';

/** Paths from older versions have no extension; tabs restored from them must keep resolving. */
export function withoutExtension(segment: string, extension: string): string {
    return segment.endsWith(extension) ? segment.slice(0, -extension.length) : segment;
}
