'use strict';

/**
 * Clears every recorded statistic — useful before launching to production.
 * Drops, categories and owner accounts are preserved.
 *
 *   npm run reset:stats
 *   npm run reset:stats -- --yes
 */

const readline = require('node:readline');
const { db, get, tx } = require('../server/db');

const flags = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--([a-z0-9-]+)$/.exec(arg);
  if (m) flags[m[1]] = true;
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function main() {
  const counts = get(
    `SELECT (SELECT COUNT(*) FROM events) AS events,
            (SELECT COUNT(*) FROM visitors) AS visitors,
            (SELECT COALESCE(SUM(views + clicks), 0) FROM drops) AS counters`
  );
  console.log('\n  This will delete:');
  console.log(`   · ${counts.events} analytics events`);
  console.log(`   · ${counts.visitors} visitor records`);
  console.log(`   · ${counts.counters} accumulated drop view/click counters`);
  console.log('  Drops, categories and owners are kept.\n');

  if (!flags.yes) {
    const answer = await confirm('  Type RESET to continue: ');
    if (answer !== 'RESET') {
      console.log('  Cancelled.\n');
      return;
    }
  }

  tx(() => {
    db.exec('DELETE FROM events; DELETE FROM visitors;');
    db.exec('UPDATE drops SET views = 0, clicks = 0;');
  });

  console.log('  ✓ Statistics reset. The dashboard starts counting from zero.\n');
}

main().catch((error) => {
  console.error(`  Error: ${error.message}`);
  process.exitCode = 1;
});
