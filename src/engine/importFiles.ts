import {
  getMatMappedFields,
  inferDefaultMatMapping,
  matWorkspaceToEvents,
  parseCsvToEvents,
  parseMatFileBuffer,
  validateImportedDatasetSchema,
} from './curationEngine';
import { RawEvent, SchemaValidationReport } from '../types/curation';

export interface MultiFileImportResult {
  events: RawEvent[];
  fileNames: string[];
  schemaReport: SchemaValidationReport;
}

export async function parseMultipleDatasetFiles(
  files: File[]
): Promise<MultiFileImportResult> {
  if (files.length < 2) {
    throw new Error('Select at least two files for a multiple-file import.');
  }

  const importedEvents: RawEvent[] = [];
  const presentFields = new Set<string>();
  const parseErrors: string[] = [];
  const fileErrors: string[] = [];

  for (const [fileIndex, file] of files.entries()) {
    const extension = file.name.toLowerCase().split('.').pop();
    try {
      let events: RawEvent[];
      let mappedFields: string[];
      let errors: string[];

      if (extension === 'csv') {
        const parsed = parseCsvToEvents(await file.text());
        events = parsed.events;
        mappedFields = parsed.presentFields;
        errors = parsed.errors;
      } else if (extension === 'mat') {
        const workspace = await parseMatFileBuffer(await file.arrayBuffer());
        if (workspace.variables.length === 0) {
          throw new Error('No supported variables were found in this .mat file.');
        }
        const mapping = inferDefaultMatMapping(workspace);
        const parsed = matWorkspaceToEvents(workspace, mapping);
        events = parsed.events;
        mappedFields = getMatMappedFields(mapping);
        errors = parsed.errors;
      } else {
        throw new Error('Only .csv and .mat files are supported.');
      }

      if (events.length === 0) {
        throw new Error(errors[0] ?? 'No valid events could be read from this file.');
      }

      mappedFields.forEach((field) => presentFields.add(field));
      importedEvents.push(
        ...events.map((event) => ({
          ...event,
          eventId: `${fileIndex}:${file.name}:${event.eventId}`,
        }))
      );
      parseErrors.push(...errors.slice(0, 5).map((error) => `${file.name}: ${error}`));
      if (errors.length > 5) {
        parseErrors.push(`${file.name}: ${errors.length - 5} additional rows were skipped.`);
      }
    } catch (error) {
      fileErrors.push(
        `${file.name}: ${
          error instanceof Error ? error.message : 'Unable to parse this file.'
        }`
      );
    }
  }

  if (fileErrors.length > 0) {
    throw new Error(fileErrors.join('\n'));
  }

  const sortedEvents = [...importedEvents].sort(
    (a, b) =>
      a.entityId.localeCompare(b.entityId) ||
      a.timestampDay - b.timestampDay ||
      a.eventId.localeCompare(b.eventId)
  );
  const lastByEntity = new Map<string, { day: number; count: number }>();
  const mergedEvents = sortedEvents.map((event) => {
    const previous = lastByEntity.get(event.entityId);
    const next = {
      ...event,
      recencyDays: previous ? event.timestampDay - previous.day : 0,
      frequencyCount: previous ? previous.count + 1 : 1,
    };
    lastByEntity.set(event.entityId, {
      day: event.timestampDay,
      count: next.frequencyCount,
    });
    return next;
  });

  return {
    events: mergedEvents,
    fileNames: files.map((file) => file.name),
    schemaReport: validateImportedDatasetSchema({
      presentFields: [...presentFields],
      events: mergedEvents,
      parseErrors,
    }),
  };
}
