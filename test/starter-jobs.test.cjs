'use strict';

/**
 * Suggested starter jobs in an agent's empty Schedules tab (Decision 5A,
 * docs/designs/per-agent-schedules.md; TODOS, "Starter jobs in an agent's empty
 * Schedules tab"). Up to 3 suggested jobs from the pack card, each added paused
 * so nothing runs autonomously until the owner turns it on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { parseStarterSchedule, suggestedStarterMissions, pickStarterPack, shouldShowStarters } = loadTs('src/shared/starterJobs.ts');
const { validateOfficePack, mergeWithCore } = loadTs('src/shared/officePack.ts');

const PACKS_DIR = path.resolve(__dirname, '..', 'resources', 'packs');
const readPack = (file) => JSON.parse(fs.readFileSync(path.join(PACKS_DIR, file), 'utf8'));

const hours = {
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  work: { start: '09:00', end: '17:00' }
};

const sampleJobs = [
  { agentId: 'pam', title: 'Inbox to zero', schedule: 'every 2h during office hours', focus: 'Clear the inbox.' },
  { agentId: 'pam', title: 'Follow up on leads', schedule: '18:00 on office days', focus: 'Check inquiries.' },
  { agentId: 'pam', title: 'Draft weekly summary', schedule: 'mon 09:00', focus: 'Prepare draft.' },
  { agentId: 'pam', title: 'Extra routine 4', schedule: 'mon 09:00', focus: 'Extra work.' },
  { agentId: 'oscar', title: 'Weekly money summary', schedule: 'mon 09:00', focus: 'Check numbers.' }
];

test('suggestedStarterMissions returns valid missions with enabled: false', () => {
  const suggestions = suggestedStarterMissions(
    sampleJobs,
    hours,
    'pam',
    'pam-1',
    [],
    'god',
    (i) => `sugg_${i}`
  );

  assert.equal(suggestions.length, 3, 'capped at 3 suggestions (Decision 5A)');
  assert.equal(suggestions[0].label, 'Inbox to zero');
  assert.equal(suggestions[0].enabled, false, 'starter suggestions are always added paused');
  assert.equal(suggestions[0].to, 'pam-1');
  assert.equal(suggestions[0].createdBy, 'owner');
  assert.equal(suggestions[0].focus, 'Clear the inbox.');
  assert.ok(suggestions[0].times && suggestions[0].times.length > 0);

  assert.equal(suggestions[1].label, 'Follow up on leads');
  assert.equal(suggestions[1].enabled, false);
  assert.deepEqual(suggestions[1].weekly, { days: [1, 2, 3, 4, 5], minute: 1080 });

  assert.equal(suggestions[2].label, 'Draft weekly summary');
  assert.equal(suggestions[2].enabled, false);
  assert.deepEqual(suggestions[2].weekly, { days: [1], minute: 540 });
});

test('suggestedStarterMissions excludes jobs the agent already has by label', () => {
  const existing = [
    { id: 'm1', label: 'Inbox to zero', intervalMs: 3600000, to: 'pam-1', enabled: true, createdBy: 'owner' }
  ];

  const suggestions = suggestedStarterMissions(
    sampleJobs,
    hours,
    'pam',
    'pam-1',
    existing,
    'god',
    (i) => `sugg_${i}`
  );

  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0].label, 'Follow up on leads');
  assert.equal(suggestions[1].label, 'Draft weekly summary');
  assert.equal(suggestions[2].label, 'Extra routine 4');
});

test('suggestedStarterMissions ignores jobs belonging to another agent definition', () => {
  const suggestions = suggestedStarterMissions(
    sampleJobs,
    hours,
    'oscar',
    'oscar-1',
    [],
    'god',
    (i) => `sugg_${i}`
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].label, 'Weekly money summary');
  assert.equal(suggestions[0].to, 'oscar-1');
  assert.equal(suggestions[0].enabled, false);
});

test('suggestedStarterMissions returns empty array when no pack jobs or hours are provided', () => {
  assert.deepEqual(suggestedStarterMissions(undefined, hours, 'pam', 'pam-1', [], 'god', (i) => `${i}`), []);
  assert.deepEqual(suggestedStarterMissions([], hours, 'pam', 'pam-1', [], 'god', (i) => `${i}`), []);
  assert.deepEqual(suggestedStarterMissions(sampleJobs, undefined, 'pam', 'pam-1', [], 'god', (i) => `${i}`), []);
  assert.deepEqual(suggestedStarterMissions(sampleJobs, hours, 'unknown', 'unk-1', [], 'god', (i) => `${i}`), []);
});

test('suggestedStarterMissions marks jobs with fromStarter: true', () => {
  const suggestions = suggestedStarterMissions(
    sampleJobs,
    hours,
    'pam',
    'pam-1',
    [],
    'god',
    (i) => `sugg_${i}`
  );

  assert.equal(suggestions.length, 3);
  for (const job of suggestions) {
    assert.equal(job.fromStarter, true, 'every starter suggestion has fromStarter: true');
  }
});

test('adding one of two starters still offers the other (PR #429 fix)', () => {
  // Pam has two starters available; owner adds one and the other should still be offered.
  const pamStarters = [
    { agentId: 'pam', title: 'Inbox to zero', schedule: 'every 2h during office hours', focus: 'Clear the inbox.' },
    { agentId: 'pam', title: 'Follow up on leads', schedule: '18:00 on office days', focus: 'Check inquiries.' }
  ];

  // Start with no existing jobs - both starters offered
  const initialSuggestions = suggestedStarterMissions(
    pamStarters,
    hours,
    'pam',
    'pam-1',
    [],
    'god',
    (i) => `sugg_${i}`
  );
  assert.equal(initialSuggestions.length, 2);
  assert.equal(initialSuggestions[0].label, 'Inbox to zero');
  assert.equal(initialSuggestions[1].label, 'Follow up on leads');

  // Owner adds the first starter - second should still be offered
  const afterAddingOne = suggestedStarterMissions(
    pamStarters,
    hours,
    'pam',
    'pam-1',
    [{ ...initialSuggestions[0], id: 'm1', enabled: true }],
    'god',
    (i) => `sugg_${i}`
  );
  assert.equal(afterAddingOne.length, 1, 'adding one starter still offers the other');
  assert.equal(afterAddingOne[0].label, 'Follow up on leads');

  // Verify visibility logic: starters should still show while all jobs are from starters
  assert.equal(shouldShowStarters([]), true, 'show starters when agent has no jobs');
  assert.equal(shouldShowStarters([{ fromStarter: true }]), true, 'show starters when all jobs are from starters');
  assert.equal(shouldShowStarters([{ fromStarter: true }, { fromStarter: true }]), true, 'show starters when all jobs are from starters');
  assert.equal(shouldShowStarters([{ fromStarter: false }]), false, 'hide starters when owner added a custom job');
  assert.equal(shouldShowStarters([{ fromStarter: true }, { fromStarter: false }]), false, 'hide starters when any job is not from a starter');
});

// ─── PR #429 pack selection tests ─────────────────────────────────────────────

test('original Pam in a retail office gets only retail starters (PR #429 fix)', () => {
  // When the member has no sourceCard (original team), pickStarterPack should select
  // by the office's businessType. Pam in retail-shop gets retail starters, not
  // home-services starters like "Tomorrow's jobs".
  const coreRaw = readPack('core.json');
  const retailRaw = readPack('retail-shop.json');
  const homeServicesRaw = readPack('home-services.json');

  const core = validateOfficePack(coreRaw, 'bundled').pack;
  const retail = mergeWithCore(validateOfficePack(retailRaw, 'bundled').pack, core);
  const homeServices = mergeWithCore(validateOfficePack(homeServicesRaw, 'bundled').pack, core);

  // Verify the packs have different starters for Pam
  const homePamStarters = homeServices.starterMissions.filter((m) => m.agentId === 'pam').map((m) => m.title);
  assert.ok(homePamStarters.includes("Tomorrow's jobs"), 'home-services pack has Tomorrow\'s jobs for pam');

  // Original Pam (no sourceCard) in a retail office: pickStarterPack selects by businessType
  const allPacks = [retail, homeServices, core];
  const { pack, defId } = pickStarterPack(undefined, 'retail-shop', allPacks, core, 'pam');

  assert.equal(pack.businessType, 'retail-shop', 'pickStarterPack selects retail pack for retail businessType');
  assert.equal(defId, 'pam', 'defId stays as the agent id when no sourceCard');

  // Now get suggestions from the selected pack
  const suggestions = suggestedStarterMissions(
    pack.starterMissions,
    pack.officeHours,
    defId,
    'pam-1',
    [],
    'god',
    (i) => `sugg_${i}`
  );

  const labels = suggestions.map((s) => s.label);
  assert.ok(labels.includes('Inbox to zero'), 'retail Pam gets Inbox to zero');
  assert.ok(!labels.includes("Tomorrow's jobs"), 'retail Pam does NOT get Tomorrow\'s jobs (that is home-services)');
});

test('original Ryan in a restaurant gets Tomorrow\'s special (PR #429 fix)', () => {
  // When the member has no sourceCard (original team), pickStarterPack should select
  // by the office's businessType. Ryan in restaurant-food gets "Tomorrow's special".
  const coreRaw = readPack('core.json');
  const restaurantRaw = readPack('restaurant-food.json');
  const proServicesRaw = readPack('pro-services.json');

  const core = validateOfficePack(coreRaw, 'bundled').pack;
  const restaurant = mergeWithCore(validateOfficePack(restaurantRaw, 'bundled').pack, core);
  const proServices = mergeWithCore(validateOfficePack(proServicesRaw, 'bundled').pack, core);

  // Original Ryan (no sourceCard) in a restaurant office: pickStarterPack selects by businessType
  const allPacks = [proServices, restaurant, core];
  const { pack, defId } = pickStarterPack(undefined, 'restaurant-food', allPacks, core, 'ryan');

  assert.equal(pack.businessType, 'restaurant-food', 'pickStarterPack selects restaurant pack for restaurant businessType');
  assert.equal(defId, 'ryan', 'defId stays as the agent id when no sourceCard');

  // Now get suggestions from the selected pack
  const suggestions = suggestedStarterMissions(
    pack.starterMissions,
    pack.officeHours,
    defId,
    'ryan-1',
    [],
    'god',
    (i) => `sugg_${i}`
  );

  const labels = suggestions.map((s) => s.label);
  assert.ok(labels.includes("Tomorrow's special"), 'restaurant Ryan gets Tomorrow\'s special');
});

test('pickStarterPack uses sourceCard when present', () => {
  const coreRaw = readPack('core.json');
  const retailRaw = readPack('retail-shop.json');
  const restaurantRaw = readPack('restaurant-food.json');

  const core = validateOfficePack(coreRaw, 'bundled').pack;
  const retail = mergeWithCore(validateOfficePack(retailRaw, 'bundled').pack, core);
  const restaurant = mergeWithCore(validateOfficePack(restaurantRaw, 'bundled').pack, core);

  // Agent hired from restaurant pack into a retail office: sourceCard wins over businessType
  const allPacks = [retail, restaurant, core];
  const { pack, defId } = pickStarterPack('restaurant-food/kelly', 'retail-shop', allPacks, core, 'kelly-1');

  assert.equal(pack.businessType, 'restaurant-food', 'pickStarterPack uses sourceCard type over businessType');
  assert.equal(defId, 'kelly', 'defId is the card id from sourceCard');
});

test('pickStarterPack falls back to core when businessType not found', () => {
  const coreRaw = readPack('core.json');
  const retailRaw = readPack('retail-shop.json');

  const core = validateOfficePack(coreRaw, 'bundled').pack;
  const retail = mergeWithCore(validateOfficePack(retailRaw, 'bundled').pack, core);

  // Unknown businessType: falls back to core
  const allPacks = [retail, core];
  const { pack, defId } = pickStarterPack(undefined, 'unknown-type', allPacks, core, 'pam');

  assert.equal(pack.businessType, 'core', 'pickStarterPack falls back to core for unknown businessType');
  assert.equal(defId, 'pam');
});
