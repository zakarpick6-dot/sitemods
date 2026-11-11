'use strict';

/**
 * Owner account utilities (max three accounts, enforced at the database level).
 *
 *   npm run owners list
 *   npm run owners reset -- --email owner@example.com [--password "new password"]
 *   npm run owners create -- --email owner@example.com --name "Owner" [--password "..."]
 *   npm run owners delete -- --email owner@example.com
 *   npm run owners unlock -- --email owner@example.com
 */

const readline = require('node:readline');
const crypto = require('node:crypto');
const config = require('../server/config');
const { all, get, run, nowIso } = require('../server/db');
const { hashPassword } = require('../server/security');
const { validateEmail, validatePassword } = require('../server/validation');

const [, , command = 'list', ...rest] = process.argv;
const flags = {};
for (let i = 0; i < rest.length; i += 1) {
  const arg = rest[i];
  const m = /^--([a-z0-9-]+)(?:=(.*))?$/i.exec(arg);
  if (!m) continue;
  const key = m[1].toLowerCase();
  if (m[2] !== undefined) {
    flags[key] = m[2];
  } else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) {
    flags[key] = rest[i + 1];
    i += 1;
  } else {
    flags[key] = true;
  }
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
  const promise = new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    process.stdout.write('\n');
    resolve(answer);
  }));
  muted = true;
  return promise;
}

function strongPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 20; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${out}${crypto.randomInt(10, 99)}!`;
}

async function resolvePassword() {
  if (typeof flags.password === 'string' && flags.password) return flags.password;
  const generated = strongPassword();
  console.log(`  Generated password: ${generated}`);
  return generated;
}

async function main() {
  if (command === 'list') {
    const owners = all(
      `SELECT id, name, email, role, created_at, last_login_at FROM users ORDER BY id ASC`
    );
    console.log(`\n  Owner accounts: ${owners.length}/${config.OWNER_LIMIT}\n`);
    for (const owner of owners) {
      console.log(`  #${owner.id}  ${owner.name}`);
      console.log(`      ${owner.email}`);
      console.log(`      last sign-in: ${owner.last_login_at || 'never'}`);
      console.log('');
    }
    return;
  }

  if (command === 'create') {
    if (all('SELECT id FROM users').length >= config.OWNER_LIMIT) {
      console.error('  Three owners already exist. Delete one first with: npm run owners delete -- --email ...');
      process.exitCode = 1;
      return;
    }
    const email = validateEmail(flags.email || (await ask('  Email: ')));
    const name = String(flags.name || (await ask('  Display name: '))).trim().slice(0, 60) || 'Owner';
    const password = validatePassword(await resolvePassword(), { min: 12 });
    const hash = await hashPassword(password);
    const result = run(
      `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?)`,
      name,
      email,
      hash,
      nowIso(),
      nowIso()
    );
    console.log(`\n  ✓ Owner #${result.lastInsertRowid} created: ${name} <${email}>\n`);
    return;
  }

  if (command === 'reset') {
    if (!flags.email) {
      console.error('  Provide --email owner@example.com');
      process.exitCode = 1;
      return;
    }
    const email = validateEmail(flags.email);
    const owner = get('SELECT * FROM users WHERE email = ?', email);
    if (!owner) {
      console.error(`  No owner found for ${email}`);
      process.exitCode = 1;
      return;
    }
    const password = validatePassword(await resolvePassword(), {
      label: 'New password',
      min: 12,
    });
    const hash = await hashPassword(password);
    run(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      hash,
      nowIso(),
      owner.id
    );
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', nowIso(), owner.id);
    run('DELETE FROM auth_attempts WHERE success = 0');
    console.log(`\n  ✓ Password rotated and sessions revoked for ${email}\n`);
    return;
  }

  if (command === 'delete') {
    if (!flags.email) {
      console.error('  Provide --email owner@example.com');
      process.exitCode = 1;
      return;
    }
    const email = validateEmail(flags.email);
    const owner = get('SELECT * FROM users WHERE email = ?', email);
    if (!owner) {
      console.error(`  No owner found for ${email}`);
      process.exitCode = 1;
      return;
    }
    if (!flags.yes && process.stdin.isTTY) {
      const answer = await ask(`  Delete owner ${owner.name} <${owner.email}>? Type DELETE: `);
      if (answer !== 'DELETE') {
        console.log('  Cancelled.');
        return;
      }
    }
    run('DELETE FROM users WHERE id = ?', owner.id);
    console.log(`  ✓ Deleted owner ${email}. You can provision a replacement with "npm run setup".`);
    return;
  }

  if (command === 'unlock') {
    run('DELETE FROM auth_attempts WHERE success = 0');
    console.log('  ✓ Sign-in lockout counters cleared.');
    return;
  }

  console.error(`  Unknown command "${command}". Use: list | create | reset | delete | unlock`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`  Error: ${error.message}`);
  process.exitCode = 1;
});
