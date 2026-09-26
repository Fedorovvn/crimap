import { z } from 'zod';
import { normalizeQuote, eventSchema } from './contract.mjs';
import { normalizePlace, districtNumber } from './geocode.mjs';

const anchor = z.object({
  label: z.string().trim().min(3).max(160),
  kind: z.enum(['stop', 'landmark', 'street', 'address']),
  documentId: z.string(),
  quote: z.string().trim().min(3).max(2000),
}).strict();
export const locationResolutionSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('search'), queries: z.array(anchor).min(1).max(2)}).strict(),
  z.object({action: z.literal('select'), candidateId: z.string(), reason: z.string().trim().min(1).max(2000)}).strict(),
  z.object({action: z.literal('keep'), reason: z.string().trim().min(1).max(2000)}).strict(),
]);

export function checkLocationResolution(result, documents, lookup) {
  const action = result.locationResolution;
  if (lookup?.enabled && !action) throw new Error('Review location: search a source-supported anchor, select an observed candidate, or explicitly keep the approximation');
  if (!action) return result;
  if (!lookup?.enabled && action.action !== 'keep') throw new Error('Location lookup is not available');
  if (action.action === 'search') {
    if (lookup.searched || lookup.applied) throw new Error('Location search already completed; select a supplied candidate or keep the approximation');
    for (const query of action.queries) {
      const supported = documents.some(d => String(d.id) === query.documentId && normalizeQuote(d.text).includes(normalizeQuote(query.quote)));
      if (!supported || !normalizePlace(query.quote).includes(normalizePlace(query.label))) throw new Error('Location anchor must occur in an exact original-source quote; preserve Hungarian place names');
    }
  }
  if (action.action === 'select' && (lookup.applied || !lookup.candidates?.some(c => c.id === action.candidateId))) throw new Error('Select only an observed location candidate, once');
  return result;
}

// Lookup progress is revision-bound and persisted before network work, so retries
// resume cached queries without asking Pro to plan the same search again.
export async function resolveLocationSearch(store, row, preparation, geocoder) {
  const search = preparation.locationReview;
  for (let i = search.completed ?? 0; i < search.queries.length; i++) {
    const query = search.queries[i];
    const candidates = await geocoder.landmarks(query, row.canonical.location);
    search.candidates.push(...candidates.map(c => ({...c, anchor: query})));
    search.completed = i + 1;
    saveLocationPreparation(store, row, preparation);
  }
  search.searched = true;
  delete search.pending;
  saveLocationPreparation(store, row, preparation);
}

export function saveLocationPreparation(store, row, preparation) {
  store.transaction(() => {
    if (store.event(row.id)?.revision !== row.revision) throw new Error('Event changed during location review');
    store.db.prepare('UPDATE preparation SET payload=? WHERE event_id=? AND revision=?').run(JSON.stringify(preparation), row.id, row.revision);
  });
}

export function applyReviewedLocation(store, row, preparation, candidate, reason, campaignId) {
  const event = structuredClone(row.canonical);
  const {latitude, longitude, precision} = candidate;
  event.location = {...event.location, label: candidate.anchor.label, latitude, longitude, precision};
  // A precise district can be retained only when the map and source agree.
  if (candidate.district && districtNumber(event.location.district) && candidate.district !== districtNumber(event.location.district)) throw new Error('Location candidate conflicts with source district');
  event.evidence = event.evidence.filter(e => e.field !== 'location' && !e.field.startsWith('location.'));
  event.evidence.push({field:'location', documentId:candidate.anchor.documentId, quote:candidate.anchor.quote});
  eventSchema.parse(event);
  const revision = row.revision + 1, now = new Date().toISOString();
  preparation.geocoding = {...candidate, provider:'photon-pro-reviewed', reason};
  preparation.locationReview = {...preparation.locationReview, applied:true, selectedCandidateId:candidate.id};
  store.transaction(() => {
    if (store.event(row.id)?.revision !== row.revision) throw new Error('Event changed during location review');
    store.db.prepare("UPDATE events SET canonical=?,revision=?,state='draft',review_reason='Pro уточнила место по источнику; готовятся переводы и повторная проверка' WHERE id=?").run(JSON.stringify(event), revision, row.id);
    store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(row.id, revision, JSON.stringify(event), 'pro-location-resolution', now);
    store.db.prepare('INSERT INTO preparation VALUES(?,?,?,?)').run(row.id, revision, JSON.stringify(preparation), now);
    store.enqueue('translate', row.id, {eventId:row.id, campaignId});
    store.log('location-resolved', row.id, {revision, candidate, reason});
  });
  return {deferred:true, locationResolved:true, revision};
}
