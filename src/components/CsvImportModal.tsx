import React, { useMemo, useState } from 'react';
import {
  X,
  FileUp,
  AlertCircle,
  Download,
  FlaskConical,
  Database,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { SAMPLE_CSV_TEMPLATE, SAMPLE_SENSOR_CSV_TEMPLATE } from '../data/presets';
import {
  buildSampleMatBuffer,
  CsvColumnMapping,
  getCsvHeaders,
  getMatMappedFields,
  inferDefaultCsvMapping,
  inferDefaultMatMapping,
  MatColumnMapping,
  matWorkspaceToEvents,
  parseCsvToEvents,
  ParsedMatWorkspace,
  parseMatFileBuffer,
  validateImportedDatasetSchema,
} from '../engine/curationEngine';
import { parseMultipleDatasetFiles } from '../engine/importFiles';
import { RawEvent, SchemaValidationReport } from '../types/curation';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportEvents: (
    events: RawEvent[],
    name: string,
    schemaReport?: SchemaValidationReport
  ) => void;
}

type ImportFormat = 'csv' | 'mat';

interface MultiFileImportResult {
  events: RawEvent[];
  fileNames: string[];
  schemaReport: SchemaValidationReport;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onImportEvents,
}) => {
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [csvText, setCsvText] = useState(SAMPLE_CSV_TEMPLATE);
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping | null>(null);
  const [datasetTitle, setDatasetTitle] = useState('Custom Event Stream');
  const [errors, setErrors] = useState<string[]>([]);

  // MATLAB .mat state
  const [matFileName, setMatFileName] = useState<string | null>(null);
  const [parsedMat, setParsedMat] = useState<ParsedMatWorkspace | null>(null);
  const [matMapping, setMatMapping] = useState<MatColumnMapping>({
    sourceType: 'variables',
  });
  const [isParsingMat, setIsParsingMat] = useState(false);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [multiFileMode, setMultiFileMode] = useState(false);
  const [multiFileResult, setMultiFileResult] =
    useState<MultiFileImportResult | null>(null);

  const matPreview = useMemo(() => {
    if (!parsedMat) return null;
    return matWorkspaceToEvents(parsedMat, matMapping);
  }, [parsedMat, matMapping]);

  const csvPreview = useMemo(() => {
    if (format !== 'csv') return null;
    return parseCsvToEvents(
      csvText,
      csvMapping ?? inferDefaultCsvMapping(getCsvHeaders(csvText))
    );
  }, [format, csvText, csvMapping]);

  const activeSchemaReport = useMemo<SchemaValidationReport | null>(() => {
    if (multiFileMode) return multiFileResult?.schemaReport ?? null;
    if (format === 'csv' && csvPreview) {
      return validateImportedDatasetSchema({
        presentFields: csvPreview.presentFields,
        events: csvPreview.events,
        parseErrors: csvPreview.errors,
      });
    }
    if (format === 'mat' && parsedMat && matPreview) {
      return validateImportedDatasetSchema({
        presentFields: getMatMappedFields(matMapping),
        events: matPreview.events,
        parseErrors: matPreview.errors,
      });
    }
    return null;
  }, [
    format,
    csvPreview,
    parsedMat,
    matPreview,
    matMapping,
    multiFileMode,
    multiFileResult,
  ]);

  const structVars = useMemo(
    () => parsedMat?.variables.filter((v) => v.value.kind === 'struct') ?? [],
    [parsedMat]
  );

  const matrixVars = useMemo(
    () =>
      parsedMat?.variables.filter(
        (v) =>
          v.value.kind === 'numeric' &&
          (v.dims[0] ?? 0) >= 1 &&
          (v.dims[1] ?? 0) >= 3
      ) ?? [],
    [parsedMat]
  );

  const vectorLikeVars = useMemo(
    () =>
      parsedMat?.variables.filter(
        (v) =>
          v.value.kind === 'numeric' ||
          v.value.kind === 'string' ||
          v.value.kind === 'cell'
      ) ?? [],
    [parsedMat]
  );

  const selectedStructFields = useMemo(() => {
    const sVar = structVars.find((v) => v.name === matMapping.structVarName);
    return sVar && sVar.value.kind === 'struct' ? sVar.value.fields : [];
  }, [structVars, matMapping.structVarName]);

  const selectedMatrixCols = useMemo(() => {
    const mVar = matrixVars.find((v) => v.name === matMapping.matrixVarName);
    return mVar ? mVar.dims[1] ?? 0 : 0;
  }, [matrixVars, matMapping.matrixVarName]);

  if (!isOpen) return null;

  const loadMatArrayBuffer = async (buffer: ArrayBuffer, fileName: string) => {
    setIsParsingMat(true);
    setErrors([]);
    try {
      const sample = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
      const isText = !sample.includes(0);
      const sampleText = isText ? new TextDecoder().decode(sample) : '';
      if (isText && /[,;\t]/.test(sampleText) && /[\r\n]/.test(sampleText)) {
        setParsedMat(null);
        setMatFileName(null);
        setCsvText(new TextDecoder().decode(buffer));
        setCsvMapping(null);
        setDatasetTitle(fileName.replace(/\.(csv|mat)$/i, ''));
        setFormat('csv');
        return;
      }

      const workspace = await parseMatFileBuffer(buffer);
      if (workspace.variables.length === 0) {
        setParsedMat(null);
        setMatFileName(fileName);
        setErrors([
          'No supported variables found in this .mat file. Ensure variables are numeric vectors/matrices, char arrays, cell arrays, or structs (Level 4 or Level 5).',
        ]);
        return;
      }
      setParsedMat(workspace);
      setMatFileName(fileName);
      setDatasetTitle(fileName.replace(/\.mat$/i, ''));
      setMatMapping(inferDefaultMatMapping(workspace));
      setFormat('mat');
    } catch (err) {
      setParsedMat(null);
      setMatFileName(fileName);
      setErrors([
        err instanceof Error
          ? err.message
          : 'Unable to parse MATLAB .mat file.',
      ]);
    } finally {
      setIsParsingMat(false);
    }
  };

  const handleMultipleFiles = async (files: File[]) => {
    setMultiFileMode(true);
    setMultiFileResult(null);
    setErrors([]);
    setIsParsingFiles(true);
    try {
      const result = await parseMultipleDatasetFiles(files);
      setDatasetTitle(`Imported files (${files.length})`);
      setMultiFileResult(result);
    } catch (error) {
      setErrors([
        error instanceof Error
          ? error.message
          : 'Unable to prepare the selected files for import.',
      ]);
    } finally {
      setIsParsingFiles(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    if (files.length > 1) {
      void handleMultipleFiles(files);
      return;
    }

    setMultiFileMode(false);
    setMultiFileResult(null);
    setErrors([]);
    const file = files[0];
    if (!file) return;
    const isMat = file.name.toLowerCase().endsWith('.mat');

    if (isMat || format === 'mat') {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          void loadMatArrayBuffer(reader.result, file.name);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setDatasetTitle(file.name.replace(/\.csv$/i, ''));
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setCsvText(reader.result);
          setErrors([]);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleLoadSampleMat = () => {
    setMultiFileMode(false);
    setMultiFileResult(null);
    const buffer = buildSampleMatBuffer();
    void loadMatArrayBuffer(buffer, 'stratum_sample_events.mat');
  };

  const handleDownloadSampleMat = () => {
    const buffer = buildSampleMatBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stratum_sample_events.mat';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSourceTypeChange = (
    nextType: MatColumnMapping['sourceType']
  ) => {
    if (!parsedMat) return;
    if (nextType === 'struct' && structVars.length > 0) {
      const firstStruct = structVars[0];
      const fields =
        firstStruct.value.kind === 'struct' ? firstStruct.value.fields : [];
      setMatMapping({
        sourceType: 'struct',
        structVarName: firstStruct.name,
        entityVar: fields[0],
        dayVar: fields[1],
        spendVar: fields[2],
      });
    } else if (nextType === 'matrix' && matrixVars.length > 0) {
      const firstMat = matrixVars[0];
      const ncols = firstMat.dims[1] ?? 3;
      setMatMapping({
        sourceType: 'matrix',
        matrixVarName: firstMat.name,
        entityCol: 0,
        dayCol: 1,
        spendCol: 2,
        actionIdCol: ncols > 3 ? 3 : undefined,
        engagementCol: ncols > 4 ? 4 : undefined,
        rewardCol: ncols > 5 ? 5 : undefined,
        propensityCol: ncols > 6 ? 6 : undefined,
      });
    } else {
      const names = vectorLikeVars.map((v) => v.name);
      setMatMapping({
        sourceType: 'variables',
        entityVar: names[0],
        dayVar: names[1],
        spendVar: names[2],
      });
    }
    setErrors([]);
  };

  const handleApply = () => {
    if (multiFileMode) {
      if (!multiFileResult || isParsingFiles) return;
      onImportEvents(
        multiFileResult.events,
        datasetTitle.trim() || `Imported files (${multiFileResult.fileNames.length})`,
        multiFileResult.schemaReport
      );
      setMultiFileMode(false);
      setMultiFileResult(null);
      onClose();
      return;
    }

    if (format === 'mat') {
      if (!parsedMat || !matPreview) {
        setErrors([
          'Upload a .mat file or click "Load Sample .mat" before materializing.',
        ]);
        return;
      }
      if (matPreview.events.length === 0) {
        setErrors(
          matPreview.errors.length > 0
            ? matPreview.errors
            : [
                'No valid events could be extracted with the current MATLAB variable mapping.',
              ]
        );
        return;
      }
      onImportEvents(
        matPreview.events,
        datasetTitle.trim() || 'Uploaded MAT',
        activeSchemaReport ?? undefined
      );
      onClose();
      return;
    }

    const parsed = csvPreview ?? parseCsvToEvents(csvText);
    if (parsed.events.length === 0) {
      setErrors(
        parsed.errors.length > 0
          ? parsed.errors
          : ['No valid events could be parsed from the CSV input.']
      );
      return;
    }
    onImportEvents(
      parsed.events,
      datasetTitle.trim() || 'Uploaded CSV',
      activeSchemaReport ?? undefined
    );
    onClose();
  };

  const fieldOptions =
    matMapping.sourceType === 'struct'
      ? selectedStructFields
      : vectorLikeVars.map((v) => v.name);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[90vh] shadow-lg overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2
              id="csv-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              Import a Training or Telemetry Dataset
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              CSV columns can use any heading; map the entity, timestamp, and target/value columns after upload. MATLAB Level 4/5 files are also supported.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Format Switcher & Dataset Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">
                Input Format
              </span>
              <div className="inline-flex w-full p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    setFormat('csv');
                    setErrors([]);
                  }}
                  className={`flex-1 py-1.5 px-3 text-xs font-medium rounded transition-colors ${
                    format === 'csv'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  CSV (.csv)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormat('mat');
                    setErrors([]);
                  }}
                  className={`flex-1 py-1.5 px-3 text-xs font-medium rounded transition-colors ${
                    format === 'mat'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  MATLAB (.mat)
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="csv-dataset-name"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Dataset Name
              </label>
              <input
                id="csv-dataset-name"
                type="text"
                value={datasetTitle}
                onChange={(e) => setDatasetTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>
          </div>

          {!multiFileMode && format === 'csv' ? (
            <>
              <div>
                <label
                  htmlFor="csv-file-upload"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Upload Local File (.csv or .mat)
                </label>
                <label
                  htmlFor="csv-file-upload"
                  className="w-full px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer flex items-center gap-2"
                >
                  <FileUp className="w-3.5 h-3.5 text-slate-500" />
                  <span>Choose .csv or .mat file(s)</span>
                  <input
                    id="csv-file-upload"
                    type="file"
                    accept=".csv,.mat,text/csv"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="csv-raw-textarea"
                    className="text-xs font-medium text-slate-700"
                  >
                    CSV Payload
                  </label>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setMultiFileMode(false);
                        setMultiFileResult(null);
                        setCsvText(SAMPLE_CSV_TEMPLATE);
                        setCsvMapping(null);
                        setDatasetTitle('Custom Event Stream');
                        setErrors([]);
                      }}
                      className="text-blue-700 hover:underline"
                    >
                      Load Behavioral Sample
                    </button>
                    <span className="text-slate-300" aria-hidden="true">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMultiFileMode(false);
                        setMultiFileResult(null);
                        setCsvText(SAMPLE_SENSOR_CSV_TEMPLATE);
                        setCsvMapping(null);
                        setDatasetTitle('Industrial Sensor Stream');
                        setErrors([]);
                      }}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      Load Sensor Telemetry Sample
                    </button>
                  </div>
                </div>
                <textarea
                  id="csv-raw-textarea"
                  rows={8}
                  value={csvText}
                  onChange={(e) => {
                    setMultiFileMode(false);
                    setMultiFileResult(null);
                    if (
                      getCsvHeaders(e.target.value).join('\u0000') !==
                      getCsvHeaders(csvText).join('\u0000')
                    ) {
                      setCsvMapping(null);
                    }
                    setCsvText(e.target.value);
                  }}
                  className="w-full px-3 py-2.5 font-mono text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
              </div>

              {csvPreview && csvPreview.headers.length > 0 && (
                <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Map CSV columns</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Column headings can be named anything. Choose which columns represent the entity, time/cycle, and target or sensor value; other fields are optional.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(
                      [
                        ['entity', 'Entity ID *'],
                        ['day', 'Timestamp / Cycle *'],
                        ['spend', 'Target / Value *'],
                      ] as const
                    ).map(([key, label]) => {
                      const selected =
                        csvMapping ?? inferDefaultCsvMapping(csvPreview.headers);
                      return (
                        <label key={key} className="text-[11px] font-medium text-slate-600">
                          {label}
                          <select
                            value={selected[key] ?? ''}
                            onChange={(event) =>
                              setCsvMapping({
                                ...selected,
                                [key]: Number(event.target.value),
                              })
                            }
                            className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                          >
                            {csvPreview.headers.map((header, index) => (
                              <option key={`${index}-${header}`} value={index}>
                                {header || `Column ${index + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-[11px] font-medium text-slate-600">
                      Map optional model fields
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {(
                        [
                          ['actionId', 'Action ID'],
                          ['actionLabel', 'Action label'],
                          ['channel', 'Channel'],
                          ['engagement', 'Engagement'],
                          ['reward', 'Reward'],
                          ['propensity', 'Propensity'],
                        ] as const
                      ).map(([key, label]) => {
                        const selected =
                          csvMapping ?? inferDefaultCsvMapping(csvPreview.headers);
                        return (
                          <label key={key} className="text-[11px] font-medium text-slate-600">
                            {label}
                            <select
                              value={selected[key] ?? ''}
                              onChange={(event) =>
                                setCsvMapping({
                                  ...selected,
                                  [key]:
                                    event.target.value === ''
                                      ? undefined
                                      : Number(event.target.value),
                                })
                              }
                              className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              <option value="">-- Unmapped --</option>
                              {csvPreview.headers.map((header, index) => (
                                <option key={`${index}-${header}`} value={index}>
                                  {header || `Column ${index + 1}`}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                </div>
              )}
            </>
          ) : !multiFileMode ? (
            <div className="space-y-4">
              {/* MAT Upload + Sample Controls */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-800">
                      MATLAB Workspace Binary (.mat)
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Supports Level 4 and Level 5 (uncompressed & zlib-compressed
                      -v7) numeric matrices, vectors, char/cell arrays, and structs.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleLoadSampleMat}
                      className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50 inline-flex items-center gap-1.5"
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                      <span>Load Sample .mat</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadSampleMat}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                      <span>Download Template</span>
                    </button>
                  </div>
                </div>

                <label
                  htmlFor="mat-file-upload"
                  className="w-full px-3 py-2.5 text-xs font-medium text-slate-700 bg-white border border-dashed border-slate-300 rounded-md hover:border-blue-400 hover:bg-blue-50/30 cursor-pointer flex items-center justify-center gap-2 transition-colors"
                >
                  <FileUp className="w-4 h-4 text-slate-500" />
                  <span>
                    {isParsingMat
                      ? 'Parsing MATLAB binary...'
                      : matFileName
                      ? `Loaded: ${matFileName} (click to replace)`
                      : 'Choose local .mat file(s)'}
                  </span>
                  <input
                    id="mat-file-upload"
                    type="file"
                    accept=".csv,.mat,text/csv"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {parsedMat && (
                <>
                  {/* Workspace Variable Inventory */}
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <Database className="w-3.5 h-3.5 text-slate-500" />
                        <span>
                          Detected Workspace Variables ({parsedMat.variables.length})
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 uppercase">
                        {parsedMat.format === 'level5' ? 'MAT Level 5' : 'MAT Level 4'}
                      </span>
                    </div>
                    <div className="p-2.5 flex flex-wrap gap-2 max-h-28 overflow-y-auto bg-white">
                      {parsedMat.variables.map((v) => (
                        <div
                          key={v.name}
                          className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-xs flex items-center gap-2"
                        >
                          <span className="font-mono font-medium text-slate-800">
                            {v.name}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-slate-500">
                            {v.summaryText}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {parsedMat.warnings.length > 0 && (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 space-y-1">
                      {parsedMat.warnings.map((w, idx) => (
                        <div key={idx}>{w}</div>
                      ))}
                    </div>
                  )}

                  {/* Variable / Column Mapping */}
                  <div className="p-4 border border-slate-200 rounded-md space-y-3 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-slate-800">
                        Schema Field Mapping
                      </span>
                      <div className="inline-flex p-0.5 bg-slate-100 border border-slate-200 rounded-md text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleSourceTypeChange('variables')}
                          className={`px-2.5 py-1 rounded font-medium ${
                            matMapping.sourceType === 'variables'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600'
                          }`}
                        >
                          Workspace Vectors
                        </button>
                        <button
                          type="button"
                          disabled={structVars.length === 0}
                          onClick={() => handleSourceTypeChange('struct')}
                          className={`px-2.5 py-1 rounded font-medium disabled:opacity-40 ${
                            matMapping.sourceType === 'struct'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600'
                          }`}
                        >
                          Struct Fields
                        </button>
                        <button
                          type="button"
                          disabled={matrixVars.length === 0}
                          onClick={() => handleSourceTypeChange('matrix')}
                          className={`px-2.5 py-1 rounded font-medium disabled:opacity-40 ${
                            matMapping.sourceType === 'matrix'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600'
                          }`}
                        >
                          2D Matrix
                        </button>
                      </div>
                    </div>

                    {matMapping.sourceType === 'struct' && (
                      <div>
                        <label
                          htmlFor="mat-struct-select"
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          Source Struct Variable
                        </label>
                        <select
                          id="mat-struct-select"
                          value={matMapping.structVarName ?? ''}
                          onChange={(e) =>
                            setMatMapping((prev) => ({
                              ...prev,
                              structVarName: e.target.value,
                            }))
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded font-mono"
                        >
                          {structVars.map((sv) => (
                            <option key={sv.name} value={sv.name}>
                              {sv.name} ({sv.summaryText})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {matMapping.sourceType === 'matrix' ? (
                      <div className="space-y-3">
                        <div>
                          <label
                            htmlFor="mat-matrix-select"
                            className="block text-[11px] font-medium text-slate-600 mb-1"
                          >
                            Source 2D Numeric Matrix
                          </label>
                          <select
                            id="mat-matrix-select"
                            value={matMapping.matrixVarName ?? ''}
                            onChange={(e) =>
                              setMatMapping((prev) => ({
                                ...prev,
                                matrixVarName: e.target.value,
                              }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded font-mono"
                          >
                            {matrixVars.map((mv) => (
                              <option key={mv.name} value={mv.name}>
                                {mv.name} ({mv.summaryText})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {(
                            [
                              ['entityCol', 'Entity ID *'],
                              ['dayCol', 'Timestamp Day *'],
                              ['spendCol', 'Spend Amount *'],
                              ['actionIdCol', 'Action ID'],
                              ['engagementCol', 'Engagement'],
                              ['rewardCol', 'Reward'],
                              ['propensityCol', 'Propensity'],
                            ] as const
                          ).map(([key, label]) => (
                            <div key={key}>
                              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                {label}
                              </label>
                              <select
                                value={
                                  matMapping[key] !== undefined
                                    ? String(matMapping[key])
                                    : ''
                                }
                                onChange={(e) => {
                                  const val =
                                    e.target.value === ''
                                      ? undefined
                                      : Number(e.target.value);
                                  setMatMapping((prev) => ({
                                    ...prev,
                                    [key]: val,
                                  }));
                                }}
                                className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded font-mono"
                              >
                                {!label.endsWith('*') && (
                                  <option value="">-- Unmapped --</option>
                                )}
                                {Array.from(
                                  { length: selectedMatrixCols },
                                  (_, idx) => (
                                    <option key={idx} value={idx}>
                                      Column {idx + 1}
                                    </option>
                                  )
                                )}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {(
                          [
                            ['entityVar', 'Entity ID *'],
                            ['dayVar', 'Timestamp Day *'],
                            ['spendVar', 'Spend Amount *'],
                            ['actionIdVar', 'Action ID'],
                            ['actionLabelVar', 'Action Label'],
                            ['channelVar', 'Channel'],
                            ['engagementVar', 'Engagement'],
                            ['rewardVar', 'Reward'],
                            ['propensityVar', 'Propensity'],
                          ] as const
                        ).map(([key, label]) => (
                          <div key={key}>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              {label}
                            </label>
                            <select
                              value={matMapping[key] ?? ''}
                              onChange={(e) =>
                                setMatMapping((prev) => ({
                                  ...prev,
                                  [key]: e.target.value || undefined,
                                }))
                              }
                              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded font-mono"
                            >
                              <option value="">-- Unmapped --</option>
                              {fieldOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Materialized Preview */}
                  {matPreview && (
                    <div className="border border-slate-200 rounded-md overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800">
                          <CheckCircle2
                            className={`w-3.5 h-3.5 ${
                              matPreview.events.length > 0
                                ? 'text-emerald-600'
                                : 'text-amber-600'
                            }`}
                          />
                          <span className="font-mono tabular-nums">
                            {matPreview.events.length.toLocaleString()} events
                            ready across{' '}
                            {new Set(
                              matPreview.events.map((e) => e.entityId)
                            ).size.toLocaleString()}{' '}
                            entities
                          </span>
                        </div>
                        {matPreview.errors.length > 0 && (
                          <span className="text-[11px] font-mono text-amber-700">
                            {matPreview.errors.length} skipped rows
                          </span>
                        )}
                      </div>
                      {matPreview.events.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px] font-mono tabular-nums">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="px-3 py-1.5 font-medium">
                                  entity_id
                                </th>
                                <th className="px-3 py-1.5 font-medium">day</th>
                                <th className="px-3 py-1.5 font-medium">
                                  spend
                                </th>
                                <th className="px-3 py-1.5 font-medium">
                                  action
                                </th>
                                <th className="px-3 py-1.5 font-medium">
                                  engagement
                                </th>
                                <th className="px-3 py-1.5 font-medium">
                                  reward
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                              {matPreview.events.slice(0, 4).map((ev) => (
                                <tr key={ev.eventId}>
                                  <td className="px-3 py-1.5">{ev.entityId}</td>
                                  <td className="px-3 py-1.5">
                                    {ev.timestampDay}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {ev.spendAmount.toFixed(2)}
                                  </td>
                                  <td className="px-3 py-1.5">{ev.actionId}</td>
                                  <td className="px-3 py-1.5">
                                    {ev.engagementScore.toFixed(3)}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {ev.reward.toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}

          {multiFileMode && (
            <div
              role={isParsingFiles ? 'status' : 'region'}
              aria-label="Multiple file import"
              className={`rounded-md border p-3 text-xs ${
                errors.length > 0
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-blue-200 bg-blue-50 text-blue-900'
              }`}
            >
              {isParsingFiles ? (
                <div>Reading and merging selected files...</div>
              ) : multiFileResult ? (
                <>
                  <div className="font-semibold">
                    {multiFileResult.fileNames.length} files ready ·{' '}
                    {multiFileResult.events.length.toLocaleString()} events ·{' '}
                    {new Set(multiFileResult.events.map((event) => event.entityId)).size.toLocaleString()}{' '}
                    entities
                  </div>
                  <p className="mt-1 text-[11px]">
                    Each CSV or MAT file was mapped from its headers or variable names.
                    The selected files will be combined into one dataset.
                  </p>
                  <ul className="mt-2 list-inside list-disc text-[11px]">
                    {multiFileResult.fileNames.slice(0, 5).map((name, index) => (
                      <li key={`${index}:${name}`} className="truncate">{name}</li>
                    ))}
                    {multiFileResult.fileNames.length > 5 && (
                      <li>{multiFileResult.fileNames.length - 5} more files</li>
                    )}
                  </ul>
                </>
              ) : (
                <div>Selected files could not be merged. Review the errors below and select them again.</div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-blue-800 hover:bg-blue-50">
                  <FileUp className="h-3.5 w-3.5" />
                  Choose files
                  <input
                    type="file"
                    accept=".csv,.mat,text/csv"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMultiFileMode(false);
                    setMultiFileResult(null);
                    setErrors([]);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel multiple-file import
                </button>
              </div>
            </div>
          )}

          {activeSchemaReport && (
            <div
              className={`border rounded-md overflow-hidden ${
                activeSchemaReport.overallStatus === 'ready'
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : activeSchemaReport.overallStatus === 'warn'
                  ? 'border-amber-200 bg-amber-50/40'
                  : 'border-red-200 bg-red-50/40'
              }`}
            >
              <div className="px-3.5 py-2.5 border-b border-slate-200/70 flex flex-wrap items-center justify-between gap-2 bg-white/70">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  {activeSchemaReport.overallStatus === 'ready' ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : activeSchemaReport.overallStatus === 'warn' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                  )}
                  <span>
                    {activeSchemaReport.overallStatus === 'ready'
                      ? 'Schema Validation Passed — All 3 Pipelines Ready'
                      : activeSchemaReport.overallStatus === 'warn'
                      ? 'Schema Validation Warning — Missing Non-Core Fields'
                      : 'Schema Validation Blocked — Missing Critical Fields'}
                  </span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-600">
                  {activeSchemaReport.detectedFields.length}/9 fields ·{' '}
                  {activeSchemaReport.totalRowsParsed.toLocaleString()} rows ·{' '}
                  {activeSchemaReport.entityCount.toLocaleString()} entities
                </span>
              </div>

              <div className="p-3 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {activeSchemaReport.pipelines.map((p) => (
                    <div
                      key={p.paradigm}
                      className="p-2.5 bg-white border border-slate-200 rounded text-xs"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-semibold text-slate-800">
                          {p.paradigm}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            p.status === 'ready'
                              ? 'text-emerald-700'
                              : p.status === 'warn'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {p.status === 'ready' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : p.status === 'warn' ? (
                            <AlertTriangle className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          <span>
                            {p.status === 'ready'
                              ? 'Ready'
                              : p.status === 'warn'
                              ? 'Warning'
                              : 'Blocked'}
                          </span>
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                        {p.summary}
                      </p>
                      {(p.missingCritical.length > 0 ||
                        p.missingRecommended.length > 0) && (
                        <div className="mt-1.5 text-[10px] font-mono text-slate-500">
                          Missing:{' '}
                          {[...p.missingCritical, ...p.missingRecommended].join(
                            ', '
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {activeSchemaReport.warnings.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-slate-700 pl-1">
                    {activeSchemaReport.warnings.slice(0, 4).map((w, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-amber-600 font-bold leading-4">
                          •
                        </span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                {errors.slice(0, 4).map((err, idx) => (
                  <div key={idx}>{err}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={
              isParsingFiles ||
              (multiFileMode
                ? !multiFileResult
                : format === 'mat' &&
                  (!parsedMat || !matPreview || matPreview.events.length === 0))
            }
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isParsingFiles
              ? 'Reading Files...'
              : multiFileResult
              ? `Import ${multiFileResult.fileNames.length} Files`
              : 'Materialize Datasets'}
          </button>
        </div>
      </div>
    </div>
  );
};
