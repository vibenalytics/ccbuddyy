// Binary patcher - finds Claude Code binary, patches salt, handles codesign

import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'fs';
import { readlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir, platform } from 'os';
import { ORIGINAL_SALT } from './companion.mjs';

function findClaudeBinary() {
  const link = join(homedir(), '.local', 'bin', 'claude');
  if (!existsSync(link)) return null;
  try {
    return readlinkSync(link);
  } catch {
    return link;
  }
}

function getConfigPath() {
  const p1 = join(homedir(), '.claude.json');
  if (existsSync(p1)) return p1;
  const p2 = join(homedir(), '.claude', '.config.json');
  if (existsSync(p2)) return p2;
  return null;
}

export function getUserId() {
  const configPath = getConfigPath();
  if (!configPath) return null;
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon';
}

export function getCurrentSalt() {
  const binary = findClaudeBinary();
  if (!binary || !existsSync(binary)) return ORIGINAL_SALT;
  const content = readFileSync(binary);
  if (content.includes(Buffer.from(ORIGINAL_SALT))) return ORIGINAL_SALT;
  const saltFile = binary + '.salt';
  if (existsSync(saltFile)) return readFileSync(saltFile, 'utf8');
  return ORIGINAL_SALT;
}

export function patch(newSalt) {
  if (newSalt.length !== ORIGINAL_SALT.length) {
    throw new Error(`Salt must be exactly ${ORIGINAL_SALT.length} characters (got ${newSalt.length})`);
  }

  const binary = findClaudeBinary();
  if (!binary || !existsSync(binary)) {
    throw new Error('Claude Code binary not found at ~/.local/bin/claude');
  }

  const backup = binary + '.bak';

  // Backup on first patch
  if (!existsSync(backup)) {
    copyFileSync(binary, backup);
  }

  // Always patch from the clean backup
  copyFileSync(backup, binary);

  // Read binary, replace all occurrences of the salt
  let content = readFileSync(binary);
  const oldBuf = Buffer.from(ORIGINAL_SALT);
  const newBuf = Buffer.from(newSalt);
  let replaced = 0;

  let idx = content.indexOf(oldBuf);
  while (idx !== -1) {
    newBuf.copy(content, idx);
    replaced++;
    idx = content.indexOf(oldBuf, idx + newBuf.length);
  }

  if (replaced === 0) {
    throw new Error('Salt string not found in binary - unexpected format');
  }

  writeFileSync(binary, content);
  execSync(`chmod +x "${binary}"`);

  // Re-sign on macOS
  if (platform() === 'darwin') {
    try {
      execSync(`codesign --remove-signature "${binary}" 2>/dev/null`, { stdio: 'ignore' });
      execSync(`codesign -s - "${binary}"`, { stdio: 'ignore' });
    } catch {
      // codesign failure is non-fatal on some setups
    }
  }

  // Save salt for tracking
  writeFileSync(binary + '.salt', newSalt);

  // Clear companion from config to force re-hatch
  const configPath = getConfigPath();
  if (configPath) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.companion) {
      delete config.companion;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  return { binary, backup, replaced };
}

export function restore() {
  const binary = findClaudeBinary();
  if (!binary) throw new Error('Claude Code binary not found');

  const backup = binary + '.bak';
  if (!existsSync(backup)) {
    return { message: 'No backup found - binary is original.' };
  }

  copyFileSync(backup, binary);
  execSync(`chmod +x "${binary}"`);

  if (platform() === 'darwin') {
    try {
      execSync(`codesign --remove-signature "${binary}" 2>/dev/null`, { stdio: 'ignore' });
      execSync(`codesign -s - "${binary}"`, { stdio: 'ignore' });
    } catch {}
  }

  const saltFile = binary + '.salt';
  if (existsSync(saltFile)) unlinkSync(saltFile);

  // Clear companion
  const configPath = getConfigPath();
  if (configPath) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.companion) {
      delete config.companion;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  return { message: 'Restored. Restart Claude Code.' };
}
