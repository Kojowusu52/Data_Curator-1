import { CANONICAL_AND_MATERIALIZED_FIELDS } from './datasetSearchEngine';
import { ENGINEERED_FEATURE_CATALOG } from './featureEngineeringEngine';
import {
  CurationRuleId,
  DatasetCommitRecord,
  EngineeredFeatureId,
  GlobalCurationConfig,
  GovernanceRecord,
  MdpConfig,
  MetadataStandard,
  PiiMaskingConfig,
  RegressionConfig,
  RulConfig,
  SequenceConfig,
} from '../types/curation';

export interface MetadataFieldAudit {
  columnName: string;
  tableName: string;
  paradigm: string;
  dataType: string;
  isoElementTag: string;
  piiSensitive: boolean;
  maskingActive: boolean;
  snakeCaseValid: boolean;
  hasDescription: boolean;
  status: 'compliant' | 'attention';
  description: string;
}

export interface ConfigDiffEntry {
  section: string;
  parameter: string;
  beforeValue: string;
  afterValue: string;
  changed: boolean;
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function deterministicHexFallback(input: string, length = 64): string {
  const seeds = [0x811c9dc5, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0x45d9f3b];
  let hex = '';
  for (let s = 0; s < seeds.length; s++) {
    let h = seeds[s] >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    hex += h.toString(16).padStart(8, '0');
  }
  return hex.slice(0, length);
}

export async function computeSha256Hex(payload: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const encoded = new TextEncoder().encode(payload);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // fallback below
  }
  return deterministicHexFallback(payload, 64);
}

export function computeWorkingTreeHash(input: {
  datasetId: string;
  datasetFingerprint: string;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig: RulConfig;
  appliedCurationRules: CurationRuleId[];
  enabledEngineeredFeatures: EngineeredFeatureId[];
}): string {
  const canonical = JSON.stringify({
    datasetId: input.datasetId,
    datasetFingerprint: input.datasetFingerprint,
    globalConfig: input.globalConfig,
    regConfig: input.regConfig,
    seqConfig: input.seqConfig,
    mdpConfig: input.mdpConfig,
    rulConfig: input.rulConfig,
    appliedCurationRules: [...input.appliedCurationRules].sort(),
    enabledEngineeredFeatures: [...input.enabledEngineeredFeatures].sort(),
  });
  return deterministicHexFallback(canonical, 10);
}

export function auditMetadataFieldStandardization(
  piiMaskingConfig: PiiMaskingConfig,
  enabledEngineeredFeatures: EngineeredFeatureId[]
): {
  fields: MetadataFieldAudit[];
  compliantCount: number;
  attentionCount: number;
  compliancePct: number;
} {
  const snakeCaseRegex = /^[a-z][a-z0-9_]*$/;
  const maskingEnabled = Boolean(piiMaskingConfig.enabled);

  const baseFields: MetadataFieldAudit[] = CANONICAL_AND_MATERIALIZED_FIELDS.map((f) => {
    const snakeCaseValid = snakeCaseRegex.test(f.columnName);
    const hasDescription = f.description.trim().length >= 10;
    const piiProtected = !f.piiSensitive || maskingEnabled;
    const status = snakeCaseValid && hasDescription && piiProtected ? 'compliant' : 'attention';

    return {
      columnName: f.columnName,
      tableName: f.tableName,
      paradigm: f.paradigm,
      dataType: f.dataType,
      isoElementTag: `ISO-11179:${f.tableName}.${f.columnName}`,
      piiSensitive: f.piiSensitive,
      maskingActive: f.piiSensitive ? maskingEnabled : false,
      snakeCaseValid,
      hasDescription,
      status,
      description: f.description,
    };
  });

  const engFields: MetadataFieldAudit[] = ENGINEERED_FEATURE_CATALOG.filter((ef) =>
    enabledEngineeredFeatures.includes(ef.id)
  ).map((ef) => {
    const snakeCaseValid = snakeCaseRegex.test(ef.columnName);
    return {
      columnName: ef.columnName,
      tableName: 'engineered_features',
      paradigm: 'Feature Engineering',
      dataType: 'float',
      isoElementTag: `ISO-11179:engineered_features.${ef.columnName}`,
      piiSensitive: false,
      maskingActive: false,
      snakeCaseValid,
      hasDescription: true,
      status: snakeCaseValid ? 'compliant' : 'attention',
      description: `${ef.label} (${ef.formula}) — ${ef.targetUseCase}`,
    };
  });

  const fields = [...baseFields, ...engFields];
  const compliantCount = fields.filter((f) => f.status === 'compliant').length;
  const attentionCount = fields.length - compliantCount;
  const compliancePct =
    fields.length > 0 ? Math.round((compliantCount / fields.length) * 1000) / 10 : 100;

  return {
    fields,
    compliantCount,
    attentionCount,
    compliancePct,
  };
}

export function buildStandardizedMetadataManifest(params: {
  standard: MetadataStandard;
  record: Pick<
    GovernanceRecord,
    | 'datasetId'
    | 'datasetName'
    | 'steward'
    | 'domain'
    | 'classification'
    | 'retentionPolicy'
    | 'license'
    | 'description'
    | 'keywords'
    | 'policyFlags'
    | 'complianceScore'
  >;
  datasetFingerprint: string;
  eventCount: number;
  entityCount: number;
  fields: MetadataFieldAudit[];
}) {
  const { standard, record, datasetFingerprint, eventCount, entityCount, fields } = params;

  if (standard === 'ML-Croissant') {
    return {
      '@context': {
        '@vocab': 'https://schema.org/',
        cr: 'http://mlcommons.org/croissant/',
      },
      '@type': 'Dataset',
      name: record.datasetName,
      identifier: record.datasetId,
      version: datasetFingerprint,
      description: record.description,
      license: record.license,
      keywords: record.keywords ?? [],
      creator: {
        '@type': 'Organization',
        name: record.steward,
      },
      'cr:citeAs': `Stratum ML Curation Dataset (${record.datasetId}, fp=${datasetFingerprint})`,
      governance: {
        classification: record.classification,
        retentionPolicy: record.retentionPolicy,
        complianceScore: record.complianceScore,
        policyFlags: record.policyFlags,
      },
      statistics: {
        entityCount,
        eventCount,
      },
      recordSet: [
        {
          '@type': 'cr:RecordSet',
          name: 'canonical_and_materialized_schema',
          field: fields.map((f) => ({
            '@type': 'cr:Field',
            name: `${f.tableName}.${f.columnName}`,
            dataType: f.dataType === 'float' ? 'sc:Float' : f.dataType === 'integer' ? 'sc:Integer' : 'sc:Text',
            description: f.description,
            piiSensitive: f.piiSensitive,
          })),
        },
      ],
    };
  }

  if (standard === 'DCAT-3') {
    return {
      '@context': 'https://www.w3.org/ns/dcat.jsonld',
      type: 'dcat:Dataset',
      'dct:identifier': record.datasetId,
      'dct:title': record.datasetName,
      'dct:description': record.description,
      'dct:publisher': record.steward,
      'dct:license': record.license,
      'dcat:theme': record.domain,
      'dcat:keyword': record.keywords ?? [],
      'dcat:version': datasetFingerprint,
      'odrl:hasPolicy': {
        classification: record.classification,
        retentionPolicy: record.retentionPolicy,
        policyFlags: record.policyFlags,
      },
      distributionSummary: {
        entityCount,
        eventCount,
        standardizedColumns: fields.length,
        complianceScore: record.complianceScore,
      },
      schemaDictionary: fields.map((f) => ({
        table: f.tableName,
        column: f.columnName,
        type: f.dataType,
        piiSensitive: f.piiSensitive,
        description: f.description,
      })),
    };
  }

  // ISO-11179 Metadata Registry Format
  return {
    standard: 'ISO/IEC 11179-3 Metadata Registry',
    administeredItem: {
      identifier: record.datasetId,
      name: record.datasetName,
      fingerprint: datasetFingerprint,
      registrationAuthority: record.steward,
      administrativeStatus: 'Recorded',
      classification: record.classification,
      retentionPolicy: record.retentionPolicy,
      license: record.license,
      definition: record.description,
      keywords: record.keywords ?? [],
      governanceCompliancePct: record.complianceScore,
      policyEnforcement: record.policyFlags,
      entityCount,
      eventCount,
    },
    dataElements: fields.map((f) => ({
      dataElementId: f.isoElementTag,
      columnName: f.columnName,
      objectClass: f.tableName,
      valueDomain: f.dataType,
      piiProtected: f.piiSensitive ? f.maskingActive : true,
      definition: f.description,
    })),
  };
}

export function diffCommitAgainstState(
  base: DatasetCommitRecord,
  target: {
    datasetId: string;
    datasetName: string;
    datasetFingerprint: string;
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
    rulConfig: RulConfig;
    appliedCurationRules: CurationRuleId[];
    enabledEngineeredFeatures: EngineeredFeatureId[];
  }
): ConfigDiffEntry[] {
  const rows: ConfigDiffEntry[] = [
    {
      section: 'Dataset',
      parameter: 'Source / Fingerprint',
      beforeValue: `${base.datasetName} (${base.datasetFingerprint})`,
      afterValue: `${target.datasetName} (${target.datasetFingerprint})`,
      changed:
        base.datasetId !== target.datasetId ||
        base.datasetFingerprint !== target.datasetFingerprint,
    },
    {
      section: 'Global Split',
      parameter: 'Train / Val / Test & Salt',
      beforeValue: `${Math.round(base.globalConfig.trainRatio * 100)}/${Math.round(
        base.globalConfig.valRatio * 100
      )}/${Math.round(base.globalConfig.testRatio * 100)} (${base.globalConfig.seedSalt})`,
      afterValue: `${Math.round(target.globalConfig.trainRatio * 100)}/${Math.round(
        target.globalConfig.valRatio * 100
      )}/${Math.round(target.globalConfig.testRatio * 100)} (${target.globalConfig.seedSalt})`,
      changed:
        Math.abs(base.globalConfig.trainRatio - target.globalConfig.trainRatio) > 1e-4 ||
        Math.abs(base.globalConfig.valRatio - target.globalConfig.valRatio) > 1e-4 ||
        base.globalConfig.seedSalt !== target.globalConfig.seedSalt,
    },
    {
      section: 'Regression',
      parameter: 'T_obs / Horizon / Winsorize / Norm',
      beforeValue: `${base.regConfig.obsCutoffDay}d / ${base.regConfig.horizonDays}d / P${base.regConfig.winsorizePercentile} / ${base.regConfig.featureNormalization}`,
      afterValue: `${target.regConfig.obsCutoffDay}d / ${target.regConfig.horizonDays}d / P${target.regConfig.winsorizePercentile} / ${target.regConfig.featureNormalization}`,
      changed:
        base.regConfig.obsCutoffDay !== target.regConfig.obsCutoffDay ||
        base.regConfig.horizonDays !== target.regConfig.horizonDays ||
        base.regConfig.winsorizePercentile !== target.regConfig.winsorizePercentile ||
        base.regConfig.featureNormalization !== target.regConfig.featureNormalization,
    },
    {
      section: 'Sequence',
      parameter: 'Arch / MaxLen / dModel / Norm',
      beforeValue: `${base.seqConfig.transformerArch ?? 'transformer_encoder'} / L=${base.seqConfig.maxSeqLen} / d=${base.seqConfig.dModel ?? 128} / ${base.seqConfig.normalization}`,
      afterValue: `${target.seqConfig.transformerArch ?? 'transformer_encoder'} / L=${target.seqConfig.maxSeqLen} / d=${target.seqConfig.dModel ?? 128} / ${target.seqConfig.normalization}`,
      changed:
        (base.seqConfig.transformerArch ?? 'transformer_encoder') !==
          (target.seqConfig.transformerArch ?? 'transformer_encoder') ||
        base.seqConfig.maxSeqLen !== target.seqConfig.maxSeqLen ||
        (base.seqConfig.dModel ?? 128) !== (target.seqConfig.dModel ?? 128) ||
        base.seqConfig.normalization !== target.seqConfig.normalization,
    },
    {
      section: 'Offline RL',
      parameter: 'Gamma / Terminal Gap / Scale',
      beforeValue: `γ=${base.mdpConfig.gamma} / gap=${base.mdpConfig.terminalInactivityGapDays}d / ${base.mdpConfig.rewardScale}`,
      afterValue: `γ=${target.mdpConfig.gamma} / gap=${target.mdpConfig.terminalInactivityGapDays}d / ${target.mdpConfig.rewardScale}`,
      changed:
        Math.abs(base.mdpConfig.gamma - target.mdpConfig.gamma) > 1e-4 ||
        base.mdpConfig.terminalInactivityGapDays !== target.mdpConfig.terminalInactivityGapDays ||
        base.mdpConfig.rewardScale !== target.mdpConfig.rewardScale,
    },
    {
      section: 'Time-Series & RUL',
      parameter: 'RUL Cap / Window / Stride',
      beforeValue: base.rulConfig
        ? `cap=${base.rulConfig.rulCap} / W=${base.rulConfig.windowLength} / s=${base.rulConfig.stride}`
        : 'Default (125 / 8 / 1)',
      afterValue: `cap=${target.rulConfig.rulCap} / W=${target.rulConfig.windowLength} / s=${target.rulConfig.stride}`,
      changed:
        (base.rulConfig?.rulCap ?? 125) !== target.rulConfig.rulCap ||
        (base.rulConfig?.windowLength ?? 8) !== target.rulConfig.windowLength ||
        (base.rulConfig?.stride ?? 1) !== target.rulConfig.stride,
    },
    {
      section: 'Curation Rules',
      parameter: 'Active Event Rules',
      beforeValue: (base.appliedCurationRules ?? []).join(', ') || 'None',
      afterValue: target.appliedCurationRules.join(', ') || 'None',
      changed:
        [...(base.appliedCurationRules ?? [])].sort().join('|') !==
        [...target.appliedCurationRules].sort().join('|'),
    },
    {
      section: 'Feature Engineering',
      parameter: 'Enabled Derived Features',
      beforeValue: (base.enabledEngineeredFeatures ?? []).join(', ') || 'None',
      afterValue: target.enabledEngineeredFeatures.join(', ') || 'None',
      changed:
        [...(base.enabledEngineeredFeatures ?? [])].sort().join('|') !==
        [...target.enabledEngineeredFeatures].sort().join('|'),
    },
  ];
  return rows;
}
