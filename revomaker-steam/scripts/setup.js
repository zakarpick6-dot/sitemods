'use strict';

/**
 * First-run owner setup.
 *
 * The platform intentionally has NO public registration. Exactly three owner
 * accounts are created from the terminal:
 *
 *   npm run setup
 *
 * Optional non-interactive flags (useful for CI / provisioning):
 *   --email1 --name1 --password1 --email2 --name2 --password2
 *   --generate   (generate strong passwords for all owners)
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const config = require('../server/config');
const { all, get, run, nowIso } = require('../server/db');
const { hashPassword } = require('../server/security');
const { validateEmail, validatePassword } = require('../server/validation');

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/i.exec(arg);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (m[2] !== undefined) {
      flags[key] = m[2];
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      flags[key] = argv[i + 1];
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));

function strongPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 20; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${out}${crypto.randomInt(10, 99)}!`;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const original = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (str) => {
    if (muted && str !== '\r\n' && str !== '\n') return;
    original(str);
  };
  const promise = new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
  muted = true;
  return promise;
}

async function readField(label, flagName, { secret = false, fallbackEnv } = {}) {
  if (typeof flags[flagName] === 'string' && flags[flagName]) return flags[flagName];
  if (fallbackEnv && process.env[fallbackEnv]) return process.env[fallbackEnv];
  if (flags.generate) return null;
  const prompt = `  ${label}: `;
  return secret ? askHidden(prompt) : ask(prompt);
}

function credentialsPath() {
  return path.join(config.ROOT, '.owner-credentials.txt');
}

function writeCredentials(entries) {
  if (!entries.length) return;
  const lines = [
    'REVOMAKER STEAM — generated owner credentials',
    'Store these in a password manager, then delete this file.',
    `Generated: ${new Date().toISOString()}`,
    '',
  ];
  for (const entry of entries) {
    lines.push(`Owner:    ${entry.name}`);
    lines.push(`Email:    ${entry.email}`);
    lines.push(`Password: ${entry.password}`);
    lines.push('');
  }
  fs.writeFileSync(credentialsPath(), lines.join('\n'), { mode: 0o600 });
}

async function main() {
  console.log('\n  REVOMAKER STEAM — owner provisioning');
  console.log('  ------------------------------------');

  const existing = all('SELECT id, name, email FROM users ORDER BY id ASC');
  if (existing.length >= config.OWNER_LIMIT) {
    console.log(`\n  All owner accounts already exist (${existing.length}/${config.OWNER_LIMIT}):`);
    for (const owner of existing) console.log(`   · ${owner.name} <${owner.email}>`);
    console.log('\n  Use "npm run owners list" to inspect or "npm run owners reset -- --email ..." to rotate a password.\n');
    return;
  }

  const slots = [];
  for (let i = existing.length + 1; i <= config.OWNER_LIMIT; i += 1) {
    console.log(`\n  Owner ${i} of ${config.OWNER_LIMIT}`);
    const name = (await readField('Display name', `name${i}`, { fallbackEnv: `OWNER${i}_NAME` }))
      || `Owner ${i}`;
    const email = await readField('Email', `email${i}`, { fallbackEnv: `OWNER${i}_EMAIL` });
    let password = await readField('Password (min 12 chars, letters + numbers)', `password${i}`, {
      secret: true,
      fallbackEnv: `OWNER${i}_PASSWORD`,
    });
    let generated = false;
    if (!password) {
      password = strongPassword();
      generated = true;
      console.log('  → Strong password generated (saved to .owner-credentials.txt).');
    }
    if (!generated && !flags['skip-confirm'] && process.stdin.isTTY) {
      const confirm = await readField('Confirm password', `password${i}`, { secret: true });
      if (confirm !== password) {
        console.error('\n  Passwords do not match. Nothing was created.\n');
        process.exitCode = 1;
        return;
      }
    }
    slots.push({ name: String(name).trim().slice(0, 60), email, password, generated });
  }

  // Validate everything before writing anything.
  for (const slot of slots) {
    slot.email = validateEmail(slot.email);
    validatePassword(slot.password, { label: 'Owner password', min: 12 });
    if (get('SELECT id FROM users WHERE email = ?', slot.email)) {
      throw new Error(`An owner with ${slot.email} already exists.`);
    }
  }

  const generated = [];

  for (const slot of slots) {
    const hash = await hashPassword(slot.password);
    run(
      `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?)`,
      slot.name,
      slot.email,
      hash,
      nowIso(),
      nowIso()
    );
    if (slot.generated) generated.push(slot);
    console.log(`\n  ✓ Owner created: ${slot.name} <${slot.email}>`);
  }

  writeCredentials(generated);

  console.log('\n  Provisioning complete. Sign in at:');
  console.log(`  ${config.APP_URL}/admin/login\n`);
  if (generated.length) {
    console.log('  Generated passwords were written to .owner-credentials.txt — move them');
    console.log('  to a password manager and delete the file.\n');
  }
}

main().catch((error) => {
  console.error(`\n  Setup failed: ${error.message}\n`);
  process.exitCode = 1;
});
