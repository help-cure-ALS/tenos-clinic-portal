#!/usr/bin/env node
/**
 * Merges all individual FHIR Bundle files into batch-upload-ready bundles.
 *
 * Enrichment (ported from bots/src/seed-clinics.ts):
 *   - Adds clinic-id identifier to every Organization and Practitioner
 *   - Copies Organization address to Practitioners that lack one
 *
 * Output (all in fhir/):
 *   fhir/all-clinics.batch.json           — all clinics + practitioners
 *   fhir/access-policies.batch.json       — access policies
 *
 * ResearchStudies are NOT part of this seed anymore — they are loaded
 * live from ClinicalTrials.gov and CTIS by the `studies-sync` service.
 * Run `docker compose run --rm studies-sync npm run once` after the
 * initial Medplum setup for the first backfill.
 *
 * The output bundles use type "collection" so they can be uploaded
 * directly via Medplum Admin → Batch.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CLINICS_DIR = join(ROOT, 'data/clinics/data');
const IDENTIFIER_SYSTEM = 'http://help-cure-als.org/clinic-id';

// ---------------------------------------------------------------------------
// Enrichment helpers
// ---------------------------------------------------------------------------

/** Add clinic-id identifier to a resource (Organization or Practitioner). */
function addClinicIdentifier(resource) {
  if (!resource.id) return;
  resource.identifier = [
    ...(resource.identifier || []),
    { system: IDENTIFIER_SYSTEM, value: resource.id },
  ];
}

/**
 * For practitioners without an address, copy the address from the referenced
 * organization (via the organization-ref extension).
 * Returns the number of practitioners enriched.
 */
function enrichPractitionerAddresses(practitioners, orgAddressMap) {
  let enriched = 0;
  for (const prac of practitioners) {
    if (prac.address?.length) continue;
    const orgRef = prac.extension?.find(
      (e) => e.url === 'http://help-cure-als.org/ext/organization-ref'
    )?.valueString;
    if (orgRef && orgAddressMap.has(orgRef)) {
      prac.address = orgAddressMap.get(orgRef);
      enriched++;
    }
  }
  return enriched;
}

// ---------------------------------------------------------------------------
// Entry helper
// ---------------------------------------------------------------------------

function toCollectionEntry(resource) {
  return { resource };
}

// ---------------------------------------------------------------------------
// Merge functions
// ---------------------------------------------------------------------------

async function mergeClinics() {
  const files = (await readdir(CLINICS_DIR)).filter(f => f.endsWith('.json')).sort();
  const organizations = [];
  const practitioners = [];
  const orgAddressMap = new Map();
  let countries = 0;

  for (const file of files) {
    const raw = await readFile(join(CLINICS_DIR, file), 'utf8');
    const bundle = JSON.parse(raw);
    if (!bundle.entry) continue;
    countries++;

    for (const entry of bundle.entry) {
      const resource = entry.resource;
      if (!resource) continue;

      addClinicIdentifier(resource);

      if (resource.resourceType === 'Organization') {
        if (resource.id && resource.address?.length) {
          orgAddressMap.set(resource.id, resource.address);
        }
        organizations.push(resource);
      } else if (resource.resourceType === 'Practitioner') {
        practitioners.push(resource);
      }
    }
  }

  // Enrich practitioners with org addresses
  const enriched = enrichPractitionerAddresses(practitioners, orgAddressMap);

  // Build collection: organizations first, then practitioners
  const allEntries = [
    ...organizations.map(toCollectionEntry),
    ...practitioners.map(toCollectionEntry),
  ];

  const bundle = {
    resourceType: 'Bundle',
    type: 'collection',
    entry: allEntries,
  };

  const outPath = join(ROOT, 'fhir/all-clinics.batch.json');
  await writeFile(outPath, JSON.stringify(bundle, null, 2));

  console.log(`Clinics: ${countries} countries, ${allEntries.length} resources`);
  console.log(`  Practitioners enriched with org address: ${enriched}`);
  console.log(`  → ${outPath}`);
}

async function mergePolicies() {
  const dir = join(ROOT, 'fhir');
  const files = (await readdir(dir)).filter(f => f.endsWith('.json') && !f.endsWith('.batch.json')).sort();
  const entries = [];
  for (const file of files) {
    const resource = JSON.parse(await readFile(join(dir, file), 'utf8'));
    entries.push(toCollectionEntry(resource));
  }
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: entries };
  const outPath = join(dir, 'access-policies.batch.json');
  await writeFile(outPath, JSON.stringify(bundle, null, 2));
  console.log(`Policies: ${entries.length} resources → ${outPath}`);
}

await mergeClinics();
await mergePolicies();
console.log('Done.');
