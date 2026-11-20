// Copyright 2026 ByteLand Technology Limited
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Base64-encoded Codicon TrueType font embedded in webviews. */
const font = readFileSync(join(__dirname, '../resources/codicon.ttf')).toString('base64');
/** All webviews use the same bundled Codicons font under their existing CSP. */
export const iconFontStyles = `@font-face{font-family:call-icons;src:url(data:font/ttf;base64,${font}) format('truetype')}`;
