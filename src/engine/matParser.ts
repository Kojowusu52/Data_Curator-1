import { RawEvent } from '../types/curation';

export type MatValue =
  | {
      kind: 'numeric';
      dims: number[];
      data: number[];
    }
  | {
      kind: 'string';
      dims: number[];
      rows: string[];
    }
  | {
      kind: 'cell';
      dims: number[];
      elements: MatValue[];
    }
  | {
      kind: 'struct';
      dims: number[];
      fields: string[];
      records: Record<string, MatValue>[];
    }
  | {
      kind: 'unsupported';
      dims: number[];
      note: string;
    };

export interface MatVariableSummary {
  name: string;
  kind: MatValue['kind'];
  dims: number[];
  value: MatValue;
  summaryText: string;
}

export interface ParsedMatWorkspace {
  format: 'level5' | 'level4';
  variables: MatVariableSummary[];
  warnings: string[];
}

export interface MatColumnMapping {
  sourceType: 'variables' | 'struct' | 'matrix';
  structVarName?: string;
  matrixVarName?: string;
  entityVar?: string;
  dayVar?: string;
  spendVar?: string;
  actionIdVar?: string;
  actionLabelVar?: string;
  channelVar?: string;
  engagementVar?: string;
  rewardVar?: string;
  propensityVar?: string;
  entityCol?: number;
  dayCol?: number;
  spendCol?: number;
  actionIdCol?: number;
  engagementCol?: number;
  rewardCol?: number;
  propensityCol?: number;
}

const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT16 = 3;
const MI_UINT16 = 4;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_SINGLE = 7;
const MI_DOUBLE = 9;
const MI_INT64 = 12;
const MI_UINT64 = 13;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const MI_UTF8 = 16;
const MI_UTF16 = 17;
const MI_UTF32 = 18;

const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_CHAR = 4;
const MX_SPARSE = 5;
const MX_DOUBLE = 6;
const MX_SINGLE = 7;
const MX_INT8 = 8;
const MX_UINT8 = 9;
const MX_INT16 = 10;
const MX_UINT16 = 11;
const MX_INT32 = 12;
const MX_UINT32 = 13;
const MX_INT64 = 14;
const MX_UINT64 = 15;

function decodeAscii(bytes: Uint8Array): string {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder('utf-8').decode(bytes.subarray(0, end)).trim();
}

async function decompressZlib(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'This browser does not support DecompressionStream for compressed .mat entries.'
    );
  }

  const runStream = async (format: 'deflate' | 'deflate-raw') => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const stream = new Blob([copy.buffer])
      .stream()
      .pipeThrough(new DecompressionStream(format));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  };

  try {
    return await runStream('deflate');
  } catch {
    return await runStream('deflate-raw');
  }
}

interface TagHeader {
  dataType: number;
  numBytes: number;
  dataOffset: number;
  nextOffset: number;
}

function readTag(
  view: DataView,
  offset: number,
  le: boolean,
  isCompressedOuter = false
): TagHeader {
  const word0 = view.getUint32(offset, le);
  const upper = (word0 >>> 16) & 0xffff;
  if (upper !== 0) {
    // Small Data Element Format (SDE)
    const dataType = word0 & 0xffff;
    const numBytes = upper;
    return {
      dataType,
      numBytes,
      dataOffset: offset + 4,
      nextOffset: offset + 8,
    };
  }
  const dataType = word0;
  const numBytes = view.getUint32(offset + 4, le);
  const alignedBytes = isCompressedOuter
    ? numBytes
    : Math.ceil(numBytes / 8) * 8;
  return {
    dataType,
    numBytes,
    dataOffset: offset + 8,
    nextOffset: offset + 8 + alignedBytes,
  };
}

function readNumericSlice(
  bytes: Uint8Array,
  view: DataView,
  dataType: number,
  dataOffset: number,
  numBytes: number,
  le: boolean
): number[] {
  const out: number[] = [];
  switch (dataType) {
    case MI_INT8: {
      for (let i = 0; i < numBytes; i++) {
        out.push(view.getInt8(dataOffset + i));
      }
      return out;
    }
    case MI_UINT8: {
      for (let i = 0; i < numBytes; i++) {
        out.push(bytes[dataOffset + i]);
      }
      return out;
    }
    case MI_INT16: {
      const count = Math.floor(numBytes / 2);
      for (let i = 0; i < count; i++) {
        out.push(view.getInt16(dataOffset + i * 2, le));
      }
      return out;
    }
    case MI_UINT16: {
      const count = Math.floor(numBytes / 2);
      for (let i = 0; i < count; i++) {
        out.push(view.getUint16(dataOffset + i * 2, le));
      }
      return out;
    }
    case MI_INT32: {
      const count = Math.floor(numBytes / 4);
      for (let i = 0; i < count; i++) {
        out.push(view.getInt32(dataOffset + i * 4, le));
      }
      return out;
    }
    case MI_UINT32: {
      const count = Math.floor(numBytes / 4);
      for (let i = 0; i < count; i++) {
        out.push(view.getUint32(dataOffset + i * 4, le));
      }
      return out;
    }
    case MI_SINGLE: {
      const count = Math.floor(numBytes / 4);
      for (let i = 0; i < count; i++) {
        out.push(view.getFloat32(dataOffset + i * 4, le));
      }
      return out;
    }
    case MI_DOUBLE: {
      const count = Math.floor(numBytes / 8);
      for (let i = 0; i < count; i++) {
        out.push(view.getFloat64(dataOffset + i * 8, le));
      }
      return out;
    }
    case MI_INT64: {
      const count = Math.floor(numBytes / 8);
      for (let i = 0; i < count; i++) {
        out.push(Number(view.getBigInt64(dataOffset + i * 8, le)));
      }
      return out;
    }
    case MI_UINT64: {
      const count = Math.floor(numBytes / 8);
      for (let i = 0; i < count; i++) {
        out.push(Number(view.getBigUint64(dataOffset + i * 8, le)));
      }
      return out;
    }
    default:
      return out;
  }
}

function readCharStrings(
  bytes: Uint8Array,
  view: DataView,
  dataType: number,
  dataOffset: number,
  numBytes: number,
  dims: number[],
  le: boolean
): string[] {
  const rows = dims[0] ?? 0;
  const cols = dims[1] ?? 1;
  if (rows === 0 || cols === 0) return [];

  const codes: number[] = [];
  if (dataType === MI_UINT16 || dataType === MI_INT16 || dataType === MI_UTF16) {
    const count = Math.floor(numBytes / 2);
    for (let i = 0; i < count; i++) {
      codes.push(view.getUint16(dataOffset + i * 2, le));
    }
  } else if (dataType === MI_UTF32 || dataType === MI_UINT32 || dataType === MI_INT32) {
    const count = Math.floor(numBytes / 4);
    for (let i = 0; i < count; i++) {
      codes.push(view.getUint32(dataOffset + i * 4, le));
    }
  } else {
    for (let i = 0; i < numBytes; i++) {
      codes.push(bytes[dataOffset + i]);
    }
  }

  // MATLAB stores char matrices in column-major order
  const result: string[] = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) {
      const ch = codes[r + c * rows];
      if (ch !== undefined && ch !== 0) {
        s += String.fromCharCode(ch);
      }
    }
    result.push(s.trim());
  }
  return result;
}

function parseMatrixElement(
  bytes: Uint8Array,
  view: DataView,
  startOffset: number,
  endOffset: number,
  le: boolean
): { name: string; value: MatValue } {
  let cursor = startOffset;

  // 1. Array Flags (miUINT32)
  const flagsTag = readTag(view, cursor, le);
  const flagsData = readNumericSlice(
    bytes,
    view,
    flagsTag.dataType,
    flagsTag.dataOffset,
    flagsTag.numBytes,
    le
  );
  const mxClass = (flagsData[0] ?? 0) & 0xff;
  cursor = flagsTag.nextOffset;

  // 2. Dimensions Array (miINT32)
  const dimsTag = readTag(view, cursor, le);
  const dims = readNumericSlice(
    bytes,
    view,
    dimsTag.dataType,
    dimsTag.dataOffset,
    dimsTag.numBytes,
    le
  );
  cursor = dimsTag.nextOffset;

  // 3. Array Name (miINT8 / miUTF8)
  const nameTag = readTag(view, cursor, le);
  const name = decodeAscii(
    bytes.subarray(nameTag.dataOffset, nameTag.dataOffset + nameTag.numBytes)
  );
  cursor = nameTag.nextOffset;

  const totalElements = dims.reduce((acc, d) => acc * d, 1);

  const isNumericClass =
    mxClass === MX_DOUBLE ||
    mxClass === MX_SINGLE ||
    mxClass === MX_INT8 ||
    mxClass === MX_UINT8 ||
    mxClass === MX_INT16 ||
    mxClass === MX_UINT16 ||
    mxClass === MX_INT32 ||
    mxClass === MX_UINT32 ||
    mxClass === MX_INT64 ||
    mxClass === MX_UINT64;

  if (isNumericClass) {
    if (cursor >= endOffset || totalElements === 0) {
      return { name, value: { kind: 'numeric', dims, data: [] } };
    }
    const realTag = readTag(view, cursor, le);
    const data = readNumericSlice(
      bytes,
      view,
      realTag.dataType,
      realTag.dataOffset,
      realTag.numBytes,
      le
    );
    return { name, value: { kind: 'numeric', dims, data } };
  }

  if (mxClass === MX_CHAR) {
    if (cursor >= endOffset || totalElements === 0) {
      return { name, value: { kind: 'string', dims, rows: [] } };
    }
    const charTag = readTag(view, cursor, le);
    const rows = readCharStrings(
      bytes,
      view,
      charTag.dataType,
      charTag.dataOffset,
      charTag.numBytes,
      dims,
      le
    );
    return { name, value: { kind: 'string', dims, rows } };
  }

  if (mxClass === MX_CELL) {
    const elements: MatValue[] = [];
    for (let i = 0; i < totalElements && cursor + 8 <= endOffset; i++) {
      const cellTag = readTag(view, cursor, le);
      if (cellTag.dataType === MI_MATRIX && cellTag.numBytes > 0) {
        const parsedCell = parseMatrixElement(
          bytes,
          view,
          cellTag.dataOffset,
          cellTag.dataOffset + cellTag.numBytes,
          le
        );
        elements.push(parsedCell.value);
      } else {
        elements.push({ kind: 'numeric', dims: [0, 0], data: [] });
      }
      cursor = cellTag.nextOffset;
    }
    return { name, value: { kind: 'cell', dims, elements } };
  }

  if (mxClass === MX_STRUCT) {
    if (cursor + 8 > endOffset) {
      return { name, value: { kind: 'unsupported', dims, note: 'Empty struct' } };
    }
    const fieldLenTag = readTag(view, cursor, le);
    const fieldLenVals = readNumericSlice(
      bytes,
      view,
      fieldLenTag.dataType,
      fieldLenTag.dataOffset,
      fieldLenTag.numBytes,
      le
    );
    const fieldNameLength = Math.max(1, fieldLenVals[0] ?? 32);
    cursor = fieldLenTag.nextOffset;

    const fieldNamesTag = readTag(view, cursor, le);
    const numFields = Math.floor(fieldNamesTag.numBytes / fieldNameLength);
    const fields: string[] = [];
    for (let f = 0; f < numFields; f++) {
      const slice = bytes.subarray(
        fieldNamesTag.dataOffset + f * fieldNameLength,
        fieldNamesTag.dataOffset + (f + 1) * fieldNameLength
      );
      fields.push(decodeAscii(slice) || `field_${f + 1}`);
    }
    cursor = fieldNamesTag.nextOffset;

    const records: Record<string, MatValue>[] = [];
    for (let elemIdx = 0; elemIdx < totalElements; elemIdx++) {
      const rec: Record<string, MatValue> = {};
      for (let f = 0; f < numFields && cursor + 8 <= endOffset; f++) {
        const fieldTag = readTag(view, cursor, le);
        if (fieldTag.dataType === MI_MATRIX && fieldTag.numBytes > 0) {
          const parsedField = parseMatrixElement(
            bytes,
            view,
            fieldTag.dataOffset,
            fieldTag.dataOffset + fieldTag.numBytes,
            le
          );
          rec[fields[f]] = parsedField.value;
        } else {
          rec[fields[f]] = { kind: 'numeric', dims: [0, 0], data: [] };
        }
        cursor = fieldTag.nextOffset;
      }
      records.push(rec);
    }

    return { name, value: { kind: 'struct', dims, fields, records } };
  }

  if (mxClass === MX_SPARSE) {
    return {
      name,
      value: { kind: 'unsupported', dims, note: 'Sparse MATLAB matrices are skipped' },
    };
  }

  return {
    name,
    value: {
      kind: 'unsupported',
      dims,
      note: `Unsupported MATLAB class (${mxClass})`,
    },
  };
}

function summarizeMatValue(val: MatValue): string {
  const dimLabel = val.dims.join('×');
  if (val.kind === 'numeric') return `${dimLabel} numeric`;
  if (val.kind === 'string') return `${dimLabel} char`;
  if (val.kind === 'cell') return `${dimLabel} cell`;
  if (val.kind === 'struct') {
    return `${dimLabel} struct (${val.fields.length} fields)`;
  }
  return `${dimLabel} ${val.note}`;
}

function parseLevel4Mat(bytes: Uint8Array, view: DataView): ParsedMatWorkspace {
  const variables: MatVariableSummary[] = [];
  const warnings: string[] = [];
  let offset = 0;

  while (offset + 20 <= bytes.length) {
    const typeFlag = view.getInt32(offset, true);
    const le = typeFlag >= 0 && typeFlag <= 5000;
    const mopt = view.getInt32(offset, le);
    const mrows = view.getInt32(offset + 4, le);
    const ncols = view.getInt32(offset + 8, le);
    const imagf = view.getInt32(offset + 12, le);
    const namlen = view.getInt32(offset + 16, le);

    if (mrows < 0 || ncols < 0 || namlen <= 0 || namlen > 256 || offset + 20 + namlen > bytes.length) {
      warnings.push('Stopped parsing Level 4 MAT-file at unexpected header offset.');
      break;
    }

    const name = decodeAscii(bytes.subarray(offset + 20, offset + 20 + namlen)) || 'var';
    let pos = offset + 20 + namlen;

    const precisionCode = Math.floor((mopt % 100) / 10);
    const textFlag = mopt % 10;
    const elemSize =
      precisionCode === 0
        ? 8
        : precisionCode === 1 || precisionCode === 2
        ? 4
        : precisionCode === 3 || precisionCode === 4
        ? 2
        : 1;
    const totalCount = mrows * ncols;
    const byteCount = totalCount * elemSize;

    if (pos + byteCount > bytes.length) break;

    if (textFlag === 1) {
      const rows: string[] = [];
      for (let r = 0; r < mrows; r++) {
        let s = '';
        for (let c = 0; c < ncols; c++) {
          const idx = r + c * mrows;
          const ch =
            elemSize === 8
              ? view.getFloat64(pos + idx * 8, le)
              : elemSize === 4
              ? view.getInt32(pos + idx * 4, le)
              : elemSize === 2
              ? view.getInt16(pos + idx * 2, le)
              : bytes[pos + idx];
          if (ch > 0) s += String.fromCharCode(ch);
        }
        rows.push(s.trim());
      }
      const value: MatValue = { kind: 'string', dims: [mrows, ncols], rows };
      variables.push({
        name,
        kind: value.kind,
        dims: value.dims,
        value,
        summaryText: summarizeMatValue(value),
      });
    } else {
      const data: number[] = [];
      for (let i = 0; i < totalCount; i++) {
        const p = pos + i * elemSize;
        if (precisionCode === 0) data.push(view.getFloat64(p, le));
        else if (precisionCode === 1) data.push(view.getFloat32(p, le));
        else if (precisionCode === 2) data.push(view.getInt32(p, le));
        else if (precisionCode === 3) data.push(view.getInt16(p, le));
        else if (precisionCode === 4) data.push(view.getUint16(p, le));
        else data.push(bytes[p]);
      }
      const value: MatValue = { kind: 'numeric', dims: [mrows, ncols], data };
      variables.push({
        name,
        kind: value.kind,
        dims: value.dims,
        value,
        summaryText: summarizeMatValue(value),
      });
    }

    pos += byteCount;
    if (imagf) pos += byteCount;
    offset = pos;
  }

  return { format: 'level4', variables, warnings };
}

export async function parseMatFileBuffer(
  buffer: ArrayBuffer
): Promise<ParsedMatWorkspace> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 20) {
    throw new Error('File is too small to be a valid MATLAB .mat file.');
  }

  // Detect MATLAB v7.3 (HDF5) signature: \x89HDF\r\n\x1a\n
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x48 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    throw new Error(
      'Detected MATLAB v7.3 (HDF5) .mat file. Please re-save using MATLAB save("file.mat", "-v7") or scipy.io.savemat(...) for browser Level 5 import.'
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Heuristic check for Level 4 vs Level 5 MAT-file
  const firstIntLe = view.getInt32(0, true);
  const firstIntBe = view.getInt32(0, false);
  const looksLevel5 = bytes.length >= 128 && (
    (bytes[126] === 0x49 && bytes[127] === 0x4d) || // 'IM'
    (bytes[126] === 0x4d && bytes[127] === 0x49)    // 'MI'
  );

  if (!looksLevel5 && ((firstIntLe >= 0 && firstIntLe <= 4052) || (firstIntBe >= 0 && firstIntBe <= 4052))) {
    return parseLevel4Mat(bytes, view);
  }

  if (bytes.length < 128) {
    throw new Error('Invalid Level 5 MAT-file: missing 128-byte header.');
  }

  const endianA = bytes[126];
  const endianB = bytes[127];
  const le = endianA === 0x49 && endianB === 0x4d; // 'IM' = little-endian
  if (!le && !(endianA === 0x4d && endianB === 0x49)) {
    throw new Error(
      'This file is not a supported Level 4 or Level 5 MATLAB binary. If it is a delimited text file, import it as CSV.'
    );
  }

  const variables: MatVariableSummary[] = [];
  const warnings: string[] = [];
  let offset = 128;

  while (offset + 8 <= bytes.length) {
    const tag = readTag(view, offset, le, true);
    if (tag.numBytes <= 0 || tag.dataOffset + tag.numBytes > bytes.length) {
      break;
    }

    if (tag.dataType === MI_COMPRESSED) {
      const compressedSlice = bytes.subarray(
        tag.dataOffset,
        tag.dataOffset + tag.numBytes
      );
      try {
        const inflated = await decompressZlib(compressedSlice);
        const innerView = new DataView(
          inflated.buffer,
          inflated.byteOffset,
          inflated.byteLength
        );
        if (inflated.length >= 8) {
          const innerTag = readTag(innerView, 0, le);
          if (innerTag.dataType === MI_MATRIX) {
            const parsed = parseMatrixElement(
              inflated,
              innerView,
              innerTag.dataOffset,
              Math.min(inflated.length, innerTag.dataOffset + innerTag.numBytes),
              le
            );
            variables.push({
              name: parsed.name || `var_${variables.length + 1}`,
              kind: parsed.value.kind,
              dims: parsed.value.dims,
              value: parsed.value,
              summaryText: summarizeMatValue(parsed.value),
            });
          }
        }
      } catch (err) {
        warnings.push(
          `Skipped compressed entry at byte ${offset}: ${
            err instanceof Error ? err.message : 'decompression failed'
          }`
        );
      }
      offset = tag.dataOffset + tag.numBytes;
    } else if (tag.dataType === MI_MATRIX) {
      const parsed = parseMatrixElement(
        bytes,
        view,
        tag.dataOffset,
        tag.dataOffset + tag.numBytes,
        le
      );
      variables.push({
        name: parsed.name || `var_${variables.length + 1}`,
        kind: parsed.value.kind,
        dims: parsed.value.dims,
        value: parsed.value,
        summaryText: summarizeMatValue(parsed.value),
      });
      const alignedNext = tag.dataOffset + Math.ceil(tag.numBytes / 8) * 8;
      offset = alignedNext;
    } else {
      const alignedNext = tag.dataOffset + Math.ceil(tag.numBytes / 8) * 8;
      offset = Math.max(offset + 8, alignedNext);
    }
  }

  return { format: 'level5', variables, warnings };
}

function extractValueList(val: MatValue): (string | number)[] {
  if (val.kind === 'numeric') {
    return val.data;
  }
  if (val.kind === 'string') {
    return val.rows;
  }
  if (val.kind === 'cell') {
    return val.elements.map((el) => {
      if (el.kind === 'string') return el.rows[0] ?? '';
      if (el.kind === 'numeric') return el.data[0] ?? '';
      return '';
    });
  }
  return [];
}

function findMatchingKey(names: string[], candidates: string[]): string | undefined {
  const lowerMap = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const c of candidates) {
    const exact = lowerMap.get(c);
    if (exact) return exact;
  }
  for (const n of names) {
    const ln = n.toLowerCase();
    if (candidates.some((c) => ln.includes(c))) return n;
  }
  return undefined;
}

export function inferDefaultMatMapping(
  workspace: ParsedMatWorkspace
): MatColumnMapping {
  // Prefer struct if a single struct variable looks like an event table
  const structVar = workspace.variables.find(
    (v) => v.value.kind === 'struct' && v.value.fields.length >= 3
  );
  if (structVar && structVar.value.kind === 'struct') {
    const fields = structVar.value.fields;
    return {
      sourceType: 'struct',
      structVarName: structVar.name,
      entityVar: findMatchingKey(fields, ['entity_id', 'user_id', 'customer_id', 'entity', 'id']),
      dayVar: findMatchingKey(fields, ['timestamp_day', 'day', 'timestamp', 't']),
      spendVar: findMatchingKey(fields, ['spend_amount', 'spend', 'amount', 'revenue', 'ltv']),
      actionIdVar: findMatchingKey(fields, ['action_id', 'action']),
      actionLabelVar: findMatchingKey(fields, ['action_label', 'treatment', 'action_name']),
      channelVar: findMatchingKey(fields, ['channel', 'source']),
      engagementVar: findMatchingKey(fields, ['engagement_score', 'engagement', 'utilization']),
      rewardVar: findMatchingKey(fields, ['reward', 'margin', 'r']),
      propensityVar: findMatchingKey(fields, ['propensity', 'mu', 'prob']),
    };
  }

  // Check vector variables
  const vectorVars = workspace.variables.filter(
    (v) =>
      (v.value.kind === 'numeric' ||
        v.value.kind === 'string' ||
        v.value.kind === 'cell') &&
      (v.dims[0] === 1 || v.dims[1] === 1 || v.dims.length === 1)
  );
  const vectorNames = vectorVars.map((v) => v.name);
  const entityVar = findMatchingKey(vectorNames, ['entity_id', 'user_id', 'customer_id', 'entity', 'id']);
  const dayVar = findMatchingKey(vectorNames, ['timestamp_day', 'day', 'timestamp', 't']);
  const spendVar = findMatchingKey(vectorNames, ['spend_amount', 'spend', 'amount', 'revenue']);

  if (entityVar || dayVar || spendVar || vectorVars.length >= 3) {
    return {
      sourceType: 'variables',
      entityVar: entityVar ?? vectorNames[0],
      dayVar: dayVar ?? vectorNames[1],
      spendVar: spendVar ?? vectorNames[2],
      actionIdVar: findMatchingKey(vectorNames, ['action_id', 'action']),
      actionLabelVar: findMatchingKey(vectorNames, ['action_label', 'treatment', 'action_name']),
      channelVar: findMatchingKey(vectorNames, ['channel', 'source']),
      engagementVar: findMatchingKey(vectorNames, ['engagement_score', 'engagement', 'utilization']),
      rewardVar: findMatchingKey(vectorNames, ['reward', 'margin', 'r']),
      propensityVar: findMatchingKey(vectorNames, ['propensity', 'mu', 'prob']),
    };
  }

  // Fallback to 2D numeric matrix
  const matrixVar = workspace.variables.find(
    (v) => v.value.kind === 'numeric' && (v.dims[0] ?? 0) >= 1 && (v.dims[1] ?? 0) >= 3
  );
  if (matrixVar) {
    const ncols = matrixVar.dims[1] ?? 3;
    return {
      sourceType: 'matrix',
      matrixVarName: matrixVar.name,
      entityCol: 0,
      dayCol: 1,
      spendCol: 2,
      actionIdCol: ncols > 3 ? 3 : undefined,
      engagementCol: ncols > 4 ? 4 : undefined,
      rewardCol: ncols > 5 ? 5 : undefined,
      propensityCol: ncols > 6 ? 6 : undefined,
    };
  }

  return {
    sourceType: 'variables',
    entityVar: workspace.variables[0]?.name,
    dayVar: workspace.variables[1]?.name,
    spendVar: workspace.variables[2]?.name,
  };
}

export function matWorkspaceToEvents(
  workspace: ParsedMatWorkspace,
  mapping: MatColumnMapping
): { events: RawEvent[]; errors: string[] } {
  const errors: string[] = [];
  const rawParsed: RawEvent[] = [];

  if (mapping.sourceType === 'matrix') {
    const v = workspace.variables.find((item) => item.name === mapping.matrixVarName);
    if (!v || v.value.kind !== 'numeric') {
      return { events: [], errors: ['Select a valid 2D numeric matrix variable.'] };
    }
    const nrows = v.dims[0] ?? 0;
    const ncols = v.dims[1] ?? 0;
    const data = v.value.data;
    const eCol = mapping.entityCol ?? 0;
    const dCol = mapping.dayCol ?? 1;
    const sCol = mapping.spendCol ?? 2;

    if (eCol >= ncols || dCol >= ncols || sCol >= ncols) {
      return { events: [], errors: ['Selected column index exceeds matrix width.'] };
    }

    const readCell = (r: number, c: number | undefined): number | undefined => {
      if (c === undefined || c < 0 || c >= ncols) return undefined;
      return data[r + c * nrows]; // column-major
    };

    for (let r = 0; r < nrows; r++) {
      const entityNum = readCell(r, eCol);
      const dayVal = readCell(r, dCol);
      const spendVal = readCell(r, sCol);

      if (
        entityNum === undefined ||
        dayVal === undefined ||
        spendVal === undefined ||
        !Number.isFinite(entityNum) ||
        !Number.isFinite(dayVal) ||
        !Number.isFinite(spendVal)
      ) {
        errors.push(`Row ${r + 1}: non-finite entity, day, or spend value.`);
        continue;
      }

      const entityId = `ENT-${Math.round(entityNum)}`;
      const actionId = Math.round(readCell(r, mapping.actionIdCol) ?? 0);
      const engVal = readCell(r, mapping.engagementCol);
      const engagementScore =
        engVal !== undefined && Number.isFinite(engVal)
          ? Math.min(1, Math.max(0, engVal))
          : 0.5;
      const rewVal = readCell(r, mapping.rewardCol);
      const reward =
        rewVal !== undefined && Number.isFinite(rewVal)
          ? Math.round(rewVal * 100) / 100
          : Math.round(spendVal * 0.3 * 100) / 100;
      const propVal = readCell(r, mapping.propensityCol);
      const propensity =
        propVal !== undefined && Number.isFinite(propVal)
          ? Math.min(1, Math.max(0.01, propVal))
          : 0.5;

      rawParsed.push({
        eventId: `MAT-${r + 1}`,
        entityId,
        timestampDay: Math.round(dayVal),
        actionId,
        actionLabel: `Action ${actionId}`,
        channel: 'MATLAB Import',
        recencyDays: 0,
        frequencyCount: 1,
        spendAmount: Math.round(spendVal * 100) / 100,
        engagementScore: Math.round(engagementScore * 1000) / 1000,
        reward,
        propensity: Math.round(propensity * 1000) / 1000,
      });
    }
  } else {
    let fieldMap = new Map<string, (string | number)[]>();

    if (mapping.sourceType === 'struct') {
      const sVar = workspace.variables.find((v) => v.name === mapping.structVarName);
      if (!sVar || sVar.value.kind !== 'struct') {
        return { events: [], errors: ['Select a valid MATLAB struct variable.'] };
      }
      const { fields, records } = sVar.value;
      if (records.length === 1) {
        // Scalar struct of vectors: data.entity_id = [...], data.spend_amount = [...]
        for (const f of fields) {
          fieldMap.set(f, extractValueList(records[0][f]));
        }
      } else {
        // 1xN or Nx1 struct array: data(i).entity_id, data(i).spend_amount
        for (const f of fields) {
          const col: (string | number)[] = records.map((rec) => {
            const list = extractValueList(rec[f]);
            return list[0] ?? '';
          });
          fieldMap.set(f, col);
        }
      }
    } else {
      for (const v of workspace.variables) {
        fieldMap.set(v.name, extractValueList(v.value));
      }
    }

    const entityArr = mapping.entityVar ? fieldMap.get(mapping.entityVar) : undefined;
    const dayArr = mapping.dayVar ? fieldMap.get(mapping.dayVar) : undefined;
    const spendArr = mapping.spendVar ? fieldMap.get(mapping.spendVar) : undefined;

    if (!entityArr || !dayArr || !spendArr) {
      return {
        events: [],
        errors: [
          'Map Entity ID, Timestamp Day, and Spend Amount to valid fields/variables in the .mat file.',
        ],
      };
    }

    const rowCount = Math.min(entityArr.length, dayArr.length, spendArr.length);
    const actionIdArr = mapping.actionIdVar ? fieldMap.get(mapping.actionIdVar) : undefined;
    const actionLabelArr = mapping.actionLabelVar ? fieldMap.get(mapping.actionLabelVar) : undefined;
    const channelArr = mapping.channelVar ? fieldMap.get(mapping.channelVar) : undefined;
    const engArr = mapping.engagementVar ? fieldMap.get(mapping.engagementVar) : undefined;
    const rewArr = mapping.rewardVar ? fieldMap.get(mapping.rewardVar) : undefined;
    const propArr = mapping.propensityVar ? fieldMap.get(mapping.propensityVar) : undefined;

    for (let i = 0; i < rowCount; i++) {
      const rawEnt = entityArr[i];
      const entityId =
        typeof rawEnt === 'string'
          ? rawEnt.trim()
          : Number.isFinite(Number(rawEnt))
          ? `ENT-${Math.round(Number(rawEnt))}`
          : '';
      const timestampDay = Number(dayArr[i]);
      const spendAmount = Number(spendArr[i]);

      if (!entityId || !Number.isFinite(timestampDay) || !Number.isFinite(spendAmount)) {
        errors.push(`Row ${i + 1}: invalid entity_id, timestamp_day, or spend_amount.`);
        continue;
      }

      const actionId = actionIdArr ? Number(actionIdArr[i]) || 0 : 0;
      const rawLabel = actionLabelArr?.[i];
      const actionLabel =
        rawLabel !== undefined && String(rawLabel).trim()
          ? String(rawLabel).trim()
          : `Action ${actionId}`;
      const rawChannel = channelArr?.[i];
      const channel =
        rawChannel !== undefined && String(rawChannel).trim()
          ? String(rawChannel).trim()
          : 'MATLAB Import';
      const engNum = engArr ? Number(engArr[i]) : NaN;
      const engagementScore = Number.isFinite(engNum)
        ? Math.min(1, Math.max(0, engNum))
        : 0.5;
      const rewNum = rewArr ? Number(rewArr[i]) : NaN;
      const reward = Number.isFinite(rewNum)
        ? Math.round(rewNum * 100) / 100
        : Math.round(spendAmount * 0.3 * 100) / 100;
      const propNum = propArr ? Number(propArr[i]) : NaN;
      const propensity = Number.isFinite(propNum)
        ? Math.min(1, Math.max(0.01, propNum))
        : 0.5;

      rawParsed.push({
        eventId: `MAT-${i + 1}`,
        entityId,
        timestampDay: Math.round(timestampDay),
        actionId,
        actionLabel,
        channel,
        recencyDays: 0,
        frequencyCount: 1,
        spendAmount: Math.round(spendAmount * 100) / 100,
        engagementScore: Math.round(engagementScore * 1000) / 1000,
        reward,
        propensity: Math.round(propensity * 1000) / 1000,
      });
    }
  }

  const grouped = new Map<string, RawEvent[]>();
  for (const ev of rawParsed) {
    const existing = grouped.get(ev.entityId);
    if (existing) {
      existing.push(ev);
    } else {
      grouped.set(ev.entityId, [ev]);
    }
  }
  const finalEvents: RawEvent[] = [];
  for (const list of grouped.values()) {
    list.sort((a, b) => a.timestampDay - b.timestampDay);
    for (let i = 0; i < list.length; i++) {
      list[i].frequencyCount = i + 1;
      list[i].recencyDays =
        i === 0 ? 0 : Math.max(0, list[i].timestampDay - list[i - 1].timestampDay);
      finalEvents.push(list[i]);
    }
  }

  return { events: finalEvents, errors };
}

// Builds a valid Level 5 MAT-file binary containing sample event vectors for testing & template download
function encodeDoubleVectorElement(name: string, values: number[]): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const namePaddedLen = Math.max(8, Math.ceil(nameBytes.length / 8) * 8);
  const dataLen = values.length * 8;
  const dataPaddedLen = Math.ceil(dataLen / 8) * 8;

  // Sub-elements inside miMATRIX:
  // Array Flags (16 bytes) + Dims (16 bytes) + Name (8 + namePaddedLen) + Real Data (8 + dataPaddedLen)
  const payloadLen = 16 + 16 + (8 + namePaddedLen) + (8 + dataPaddedLen);
  const totalLen = 8 + payloadLen;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  // Outer miMATRIX tag
  view.setUint32(0, MI_MATRIX, true);
  view.setUint32(4, payloadLen, true);

  let pos = 8;
  // 1. Array flags
  view.setUint32(pos, MI_UINT32, true);
  view.setUint32(pos + 4, 8, true);
  view.setUint32(pos + 8, MX_DOUBLE, true);
  view.setUint32(pos + 12, 0, true);
  pos += 16;

  // 2. Dimensions [N, 1]
  view.setUint32(pos, MI_INT32, true);
  view.setUint32(pos + 4, 8, true);
  view.setInt32(pos + 8, values.length, true);
  view.setInt32(pos + 12, 1, true);
  pos += 16;

  // 3. Name
  view.setUint32(pos, MI_INT8, true);
  view.setUint32(pos + 4, nameBytes.length, true);
  buf.set(nameBytes, pos + 8);
  pos += 8 + namePaddedLen;

  // 4. Data (miDOUBLE)
  view.setUint32(pos, MI_DOUBLE, true);
  view.setUint32(pos + 4, dataLen, true);
  for (let i = 0; i < values.length; i++) {
    view.setFloat64(pos + 8 + i * 8, values[i], true);
  }

  return buf;
}

export function buildSampleMatBuffer(): ArrayBuffer {
  // Deterministic 45-event, 15-entity Level 5 MAT sample
  const entityIds: number[] = [];
  const days: number[] = [];
  const spend: number[] = [];
  const actions: number[] = [];
  const engagement: number[] = [];
  const reward: number[] = [];
  const propensity: number[] = [];

  for (let e = 0; e < 15; e++) {
    const id = 8001 + e;
    const baseSpend = 45 + (e % 5) * 28;
    const steps = 4 + (e % 4);
    for (let s = 0; s < steps; s++) {
      entityIds.push(id);
      days.push(10 + s * 45 + (e % 7) * 3);
      const sp = Math.round((baseSpend + s * 14 + ((e + s) % 3) * 9) * 100) / 100;
      spend.push(sp);
      const act = (e + s) % 4;
      actions.push(act);
      engagement.push(Math.round((0.35 + ((e + s) % 6) * 0.1) * 1000) / 1000);
      reward.push(Math.round(sp * 0.34 * 100) / 100);
      propensity.push(act === 0 ? 0.45 : act === 1 ? 0.35 : 0.25);
    }
  }

  const blocks = [
    encodeDoubleVectorElement('entity_id', entityIds),
    encodeDoubleVectorElement('timestamp_day', days),
    encodeDoubleVectorElement('spend_amount', spend),
    encodeDoubleVectorElement('action_id', actions),
    encodeDoubleVectorElement('engagement_score', engagement),
    encodeDoubleVectorElement('reward', reward),
    encodeDoubleVectorElement('propensity', propensity),
  ];

  const bodyLen = blocks.reduce((acc, b) => acc + b.length, 0);
  const out = new Uint8Array(128 + bodyLen);
  const headerText = new TextEncoder().encode(
    'MATLAB 5.0 MAT-file, Platform: Stratum Web, Created on: 2026-11-15'
  );
  out.set(headerText.subarray(0, 116), 0);
  for (let i = headerText.length; i < 116; i++) out[i] = 0x20;

  const view = new DataView(out.buffer);
  view.setUint16(124, 0x0100, true);
  out[126] = 0x49; // 'I'
  out[127] = 0x4d; // 'M' (little-endian)

  let offset = 128;
  for (const blk of blocks) {
    out.set(blk, offset);
    offset += blk.length;
  }

  return out.buffer;
}
