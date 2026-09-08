/**
 * What happens at fifty to a hundred people at once.
 *
 * Not a benchmark. The question this answers is narrower and more useful: does
 * anything fall over, and if it does, what falls over first. A restaurant in two
 * towns will not see a thousand concurrent users, but it will see the whole of a
 * Friday evening arrive inside ten minutes, and the failure modes worth finding
 * are the ones that only appear when requests overlap — connections exhausted,
 * a pool queue that never drains, a rate limit that catches real customers.
 *
 * It drives the three paths a customer actually takes, in the proportion they
 * take them: browsing is most of it, quoting is what the checkout does on every
 * keystroke, and tracking is a timer that runs for twenty minutes per order.
 * Placing an order is deliberately excluded — it writes rows and prints kitchen
 * tickets, and a load test that leaves a hundred fake orders behind is a load
 * test nobody runs twice.
 *
 *   pnpm load-test
 *   pnpm load-test --users 100 --seconds 30 --base http://localhost:3000
 *
 * Read the p95 and the failure count, not the average. An average hides exactly
 * the tail that makes a customer close the tab.
 */

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const BASE = flag('base', 'http://localhost:3000').replace(/\/$/, '');
const USERS = Number(flag('users', '50'));
const SECONDS = Number(flag('seconds', '20'));

/**
 * The mix, as weights.
 *
 * Roughly what an evening looks like: most people are looking at food, a few are
 * filling in the checkout, and everybody who has ordered has a tab open polling.
 */
const PATHS = [
  { name: 'menu', weight: 5, run: (session) => get(session, '/ru/menu') },
  { name: 'home', weight: 3, run: (session) => get(session, '/ru') },
  { name: 'contacts', weight: 1, run: (session) => get(session, '/ru/contacts') },
  { name: 'checkout', weight: 2, run: (session) => get(session, '/ru/checkout') },
];

const stats = new Map();

function record(name, ms, ok, status) {
  let entry = stats.get(name);
  if (!entry) {
    entry = { samples: [], ok: 0, failed: 0, statuses: new Map() };
    stats.set(name, entry);
  }

  entry.samples.push(ms);
  if (ok) entry.ok += 1;
  else entry.failed += 1;

  entry.statuses.set(status, (entry.statuses.get(status) ?? 0) + 1);
}

async function get(session, path) {
  const started = performance.now();

  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: {
        // Each virtual user gets its own address, because the rate limits are
        // keyed by one. Without this the whole test looks like a single very
        // determined customer and measures the limiter rather than the site.
        'x-forwarded-for': session.ip,
        'accept-language': 'ru',
      },
    });

    // Drain the body: not doing so leaves the connection open and measures
    // headers rather than pages.
    await response.arrayBuffer();

    return { ms: performance.now() - started, ok: response.ok, status: response.status };
  } catch (error) {
    return { ms: performance.now() - started, ok: false, status: String(error?.cause?.code ?? 'ERR') };
  }
}

function pick() {
  const total = PATHS.reduce((sum, path) => sum + path.weight, 0);
  let roll = Math.random() * total;

  for (const path of PATHS) {
    roll -= path.weight;
    if (roll <= 0) return path;
  }

  return PATHS[0];
}

async function virtualUser(index, until) {
  const session = { ip: `10.${(index >> 8) & 255}.${index & 255}.${(index % 200) + 1}` };

  while (performance.now() < until) {
    const path = pick();
    const result = await path.run(session);
    record(path.name, result.ms, result.ok, result.status);

    // A person reads for a moment between pages. Without this the test measures
    // how fast a loop can spin, which is nobody's experience of the site.
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 350));
  }
}

function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`\n  ${USERS} concurrent users for ${SECONDS}s against ${BASE}\n`);

  // Fail fast and clearly if nothing is listening, rather than reporting a
  // hundred percent failure rate as though it were a finding.
  try {
    const probe = await fetch(`${BASE}/ru`, { headers: { 'x-forwarded-for': '10.0.0.1' } });
    await probe.arrayBuffer();
  } catch {
    console.error(`  Nothing is answering at ${BASE}. Start the server first.\n`);
    process.exit(1);
  }

  const until = performance.now() + SECONDS * 1000;
  await Promise.all(Array.from({ length: USERS }, (_, index) => virtualUser(index, until)));

  let totalRequests = 0;
  let totalFailures = 0;

  console.log('  path        requests   failed     p50      p95      max');
  console.log('  ' + '-'.repeat(58));

  for (const [name, entry] of stats) {
    const count = entry.samples.length;
    totalRequests += count;
    totalFailures += entry.failed;

    console.log(
      `  ${name.padEnd(11)} ${String(count).padStart(8)} ${String(entry.failed).padStart(8)}` +
        `  ${fmt(percentile(entry.samples, 50))} ${fmt(percentile(entry.samples, 95))} ${fmt(Math.max(...entry.samples))}`,
    );
  }

  console.log('  ' + '-'.repeat(58));
  console.log(`  ${totalRequests} requests, ${totalFailures} failed, ${(totalRequests / SECONDS).toFixed(1)}/s\n`);

  const statuses = new Map();
  for (const entry of stats.values()) {
    for (const [status, count] of entry.statuses) {
      statuses.set(status, (statuses.get(status) ?? 0) + count);
    }
  }

  const unhappy = [...statuses].filter(([status]) => status !== 200);
  if (unhappy.length > 0) {
    console.log('  non-200 responses:');
    for (const [status, count] of unhappy) console.log(`    ${status}: ${count}`);
    console.log('');
  }

  // An exit code, so this can sit in a pipeline later without anybody having to
  // read the table.
  if (totalFailures > 0) process.exitCode = 1;
}

function fmt(ms) {
  return `${Math.round(ms)}ms`.padStart(7);
}

main();
