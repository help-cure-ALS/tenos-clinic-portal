/**
 * Cleanup helper — removes clinic-study assignments that point to
 * deleted studies. Without cleanup, dangling references would be
 * left behind in the clinic `List` resources.
 *
 * Pattern analogous to `web/src/hooks/useClinicStudies.ts`:
 *   List.code = { system: "http://help-cure-als.org/list-type", code: "clinic-studies" }
 *   List.entry[].item.reference = "ResearchStudy/{id}"
 */

import type { List } from "@medplum/fhirtypes";
import type { FastifyBaseLogger } from "fastify";
import { getServiceClient } from "./medplum";

const LIST_SYSTEM = "http://help-cure-als.org/list-type";
const LIST_CODE = "clinic-studies";

/**
 * Removes from all clinic-study lists the entries whose reference
 * points to one of the given study IDs. Returns the number of
 * removed entries.
 */
export async function removeStudiesFromClinicLists(
    log: FastifyBaseLogger,
    studyIds: string[],
): Promise<{ listsUpdated: number; entriesRemoved: number }> {
    if (studyIds.length === 0) return { listsUpdated: 0, entriesRemoved: 0 };

    const client = await getServiceClient();
    const idSet = new Set(studyIds.map((id) => `ResearchStudy/${id}`));

    // Fetch all clinic-study lists (paginated up to _count=1000).
    const bundle = await client.search("List", {
        code: `${LIST_SYSTEM}|${LIST_CODE}`,
        _count: "1000",
    });
    const lists = (bundle.entry ?? [])
        .map((e) => e.resource as List | undefined)
        .filter((l): l is List => !!l);

    let listsUpdated = 0;
    let entriesRemoved = 0;

    for (const list of lists) {
        const originalEntries = list.entry ?? [];
        const kept = originalEntries.filter(
            (e) => !e.item?.reference || !idSet.has(e.item.reference),
        );
        const removed = originalEntries.length - kept.length;
        if (removed === 0) continue;

        entriesRemoved += removed;
        listsUpdated++;
        try {
            await client.updateResource({ ...list, entry: kept });
        } catch (err) {
            log.warn(
                { listId: list.id, err },
                "[clinic-cleanup] failed to update list, skipping",
            );
        }
    }

    return { listsUpdated, entriesRemoved };
}

/**
 * Reset variant: empties ALL clinic-study lists (sets `entry = []`).
 * Used during a full reset so that the freshly created studies can be
 * explicitly assigned to the clinics after the backfill.
 */
export async function clearAllClinicStudyLists(
    log: FastifyBaseLogger,
): Promise<{ listsCleared: number; entriesRemoved: number }> {
    const client = await getServiceClient();

    const bundle = await client.search("List", {
        code: `${LIST_SYSTEM}|${LIST_CODE}`,
        _count: "1000",
    });
    const lists = (bundle.entry ?? [])
        .map((e) => e.resource as List | undefined)
        .filter((l): l is List => !!l);

    let listsCleared = 0;
    let entriesRemoved = 0;

    for (const list of lists) {
        const removed = list.entry?.length ?? 0;
        if (removed === 0) continue;
        entriesRemoved += removed;
        listsCleared++;
        try {
            await client.updateResource({ ...list, entry: [] });
        } catch (err) {
            log.warn(
                { listId: list.id, err },
                "[clinic-cleanup] failed to clear list, skipping",
            );
        }
    }

    return { listsCleared, entriesRemoved };
}
