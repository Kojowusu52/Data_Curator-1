import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  Download,
  Database,
  Eye,
  X,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import {
  AuditCheck,
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  PiiMaskingConfig,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
} from '../types/curation';
import {
  buildSampleSqlSelectQuery,
  exportSequenceDatasetBundle,
  previewPiiMasking,
  REGRESSION_FEATURE_CATALOG,
} from '../engine/curationEngine';
import { SqlQueryVerifierPanel } from './SqlQueryVerifierPanel';
import { ExportFeatureImportancePanel } from './ExportFeatureImportancePanel';

interface ExportAuditViewProps {
  datasetName: string;
  audits: AuditCheck[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  piiMaskingConfig: PiiMaskingConfig;
  onUpdatePiiMaskingConfig: (next: PiiMaskingConfig) => void;
  onDownloadRegressionCsv: () => void;
  onDownloadRegressionSql: () => void;
  onDownloadSequenceJson: () => void;
  onDownloadMdpJson: () => void;
}

type CodeTarget = 'regression' | 'sequence' | 'offline_rl' | 'sql';

export const ExportAuditView: React.FC<ExportAuditViewProps> = ({
  datasetName,
  audits,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  regResult,
  seqResult,
  mdpResult,
  piiMaskingConfig,
  onUpdatePiiMaskingConfig,
  onDownloadRegressionCsv,
  onDownloadRegressionSql,
  onDownloadSequenceJson,
  onDownloadMdpJson,
}) => {
  const [codeTab, setCodeTab] = useState<CodeTarget>('regression');
  const [copied, setCopied] = useState(false);
  const [isSqlModalOpen, setIsSqlModalOpen] = useState(false);
  const [sqlPreviewMode, setSqlPreviewMode] = useState<'select' | 'ddl'>('select');
  const [modalCopied, setModalCopied] = useState(false);

  const selectedSet = new Set(regConfig.selectedFeatures ?? []);
  const activeRegFeatures = REGRESSION_FEATURE_CATALOG.filter((f) => selectedSet.has(f.key));
  const exportFeatures =
    activeRegFeatures.length > 0 ? activeRegFeatures : REGRESSION_FEATURE_CATALOG;
  const featureListLiteral = exportFeatures.map((f) => `"${f.csvColumn}"`).join(', ');

  const sqlVerification = useMemo(
    () => buildSampleSqlSelectQuery(regConfig, regResult, datasetName, piiMaskingConfig),
    [regConfig, regResult, datasetName, piiMaskingConfig]
  );

  const piiSamples = useMemo(() => {
    const sampleIds = [
      ...regResult.rows.slice(0, 3).map((r) => r.entityId),
      ...seqResult.samples.slice(0, 3).map((s) => s.entityId),
      ...mdpResult.transitions.slice(0, 3).map((t) => t.entityId),
    ];
    return previewPiiMasking(sampleIds, piiMaskingConfig);
  }, [regResult.rows, seqResult.samples, mdpResult.transitions, piiMaskingConfig]);

  const codeSnippets: Record<CodeTarget, string> = {
    regression: `# Stratum Materialized Pipeline — Traditional Regression (LTV)
# Source: ${datasetName} | Split Hash Salt: "${globalConfig.seedSalt}"
import pandas as pd
import numpy as np
from sklearn.linear_model import Ridge

df = pd.read_csv("stratum_regression_ltv.csv")
features = [${featureListLiteral}]

# Cutoff T_obs=${regConfig.obsCutoffDay}d, Horizon H=${regConfig.horizonDays}d, Winsorization=P${regConfig.winsorizePercentile}, Scaling=${regConfig.featureNormalization}, BatchSize=${regConfig.batchSize} (${regResult.batchCount} chunks)
train_df = df[df["split"] == "train"]
val_df   = df[df["split"] == "val"]
test_df  = df[df["split"] == "test"]

# Iterate pre-chunked mini-batches or read with chunksize=${regConfig.batchSize}
for batch_id, batch_df in train_df.groupby("batch_id"):
    pass

model = Ridge(alpha=1.0).fit(train_df[features], train_df["target_ltv_winsorized"])
print(f"Val R^2: {model.score(val_df[features], val_df['target_ltv_winsorized']):.4f}")`,

    sequence: (() => {
      const tEval = seqResult.transformerEval;
      const isCausal = tEval.architecture === 'causal_gpt';
      const isTft = tEval.architecture === 'temporal_fusion';
      return `# Stratum Materialized Pipeline — ${tEval.architectureLabel} (PyTorch Transformer)
# Source: ${datasetName} | Shape: [${seqResult.tensorShape.join(', ')}] | Params: ~${tEval.estimatedParams.toLocaleString()} | Batches: ${seqResult.batchCount}
import json
import torch
import torch.nn as nn
from torch.utils.data import TensorDataset, DataLoader

with open("stratum_sequence_tensors.json") as f:
    payload = json.load(f)

# Padding=${seqConfig.padding}, Truncation=${seqConfig.truncation}, Scaler=${seqConfig.normalization}, PosEnc=${tEval.positionalEncoding}, Pool=${tEval.poolingMode}
X = torch.tensor(payload["X"], dtype=torch.float32)             # [B, ${seqConfig.maxSeqLen}, 4]
mask = torch.tensor(payload["mask"], dtype=torch.bool)          # [B, ${seqConfig.maxSeqLen}]
delta_t = torch.tensor(payload["deltaDays"], dtype=torch.float32)
y = torch.tensor(payload["y_ltv"], dtype=torch.float32)         # [B]
splits = payload["splits"]

train_idx = [i for i, s in enumerate(splits) if s == "train"]
train_loader = DataLoader(TensorDataset(X[train_idx], mask[train_idx], delta_t[train_idx], y[train_idx]), batch_size=${seqConfig.batchSize}, shuffle=True)

class StratumTransformerLTV(nn.Module):
    def __init__(self, in_dim=4, d_model=${tEval.dModel}, nhead=${tEval.numHeads}, num_layers=${tEval.numLayers}, max_len=${seqConfig.maxSeqLen}, dropout=${tEval.dropoutRate}):
        super().__init__()
        self.proj = nn.Linear(in_dim, d_model)
        self.pos_emb = nn.Parameter(torch.randn(1, max_len, d_model) * 0.02)${
          isTft ? '\n        self.vsn_gate = nn.Sequential(nn.Linear(d_model, d_model), nn.Sigmoid())' : ''
        }
        layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=d_model * 4,
            dropout=dropout, batch_first=True, norm_first=True
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=num_layers)
        self.attn_pool = nn.Linear(d_model, 1)
        self.head = nn.Sequential(nn.Linear(d_model, 32), nn.GELU(), nn.Linear(32, 1))

    def forward(self, x, valid_mask):
        h = self.proj(x) + self.pos_emb[:, :x.size(1)]${
          isTft ? '\n        h = h * self.vsn_gate(h)' : ''
        }${
          isCausal
            ? '\n        L = x.size(1)\n        causal_mask = torch.triu(torch.ones(L, L, device=x.device, dtype=torch.bool), diagonal=1)\n        h = self.encoder(h, mask=causal_mask, src_key_padding_mask=~valid_mask)'
            : '\n        h = self.encoder(h, src_key_padding_mask=~valid_mask)'
        }
        scores = self.attn_pool(h).squeeze(-1).masked_fill(~valid_mask, -1e9)
        alpha = torch.softmax(scores, dim=-1).unsqueeze(-1)
        pooled = (h * alpha).sum(dim=1)
        return self.head(pooled).squeeze(-1)

model = StratumTransformerLTV()`;
    })(),

    offline_rl: `# Stratum Materialized Pipeline — Offline RL (CQL / MDP)
# Source: ${datasetName} | Transitions: ${mdpResult.transitions.length} | Gamma: ${mdpConfig.gamma}
import json
import numpy as np
import d3rlpy

with open("stratum_offline_rl_mdp.json") as f:
    mdp = json.load(f)

train_tr = [t for t in mdp["transitions"] if t["split"] == "train"]
observations = np.array([[t["state"]["recencyDays"], t["state"]["frequencyCount"],
                          t["state"]["cumSpend"], t["state"]["engagementScore"]] for t in train_tr], dtype=np.float32)
actions = np.array([t["actionId"] for t in train_tr], dtype=np.int64)
rewards = np.array([t["rewardScaled"] for t in train_tr], dtype=np.float32)  # scale=${mdpConfig.rewardScale}
terminals = np.array([t["done"] for t in train_tr], dtype=np.float32)

dataset = d3rlpy.dataset.MDPDataset(observations=observations, actions=actions, rewards=rewards, terminals=terminals)
cql = d3rlpy.algos.DiscreteCQLConfig(alpha=1.0, gamma=${mdpConfig.gamma}).create(device="cpu")`,

    sql: sqlVerification.selectQuery,
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeSnippets[codeTab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleCopyModalSql = async () => {
    const text =
      sqlPreviewMode === 'select'
        ? sqlVerification.selectQuery
        : sqlVerification.ddlPreview;
    try {
      await navigator.clipboard.writeText(text);
      setModalCopied(true);
      setTimeout(() => setModalCopied(false), 1800);
    } catch {
      setModalCopied(false);
    }
  };

  const handleDownloadTransformerJsonl = () => {
    const bundle = exportSequenceDatasetBundle(seqResult, seqConfig, piiMaskingConfig);
    const lines: string[] = [];
    for (const b of bundle.batches) {
      for (let i = 0; i < b.size; i++) {
        lines.push(
          JSON.stringify({
            entity_id: b.entityIds[i],
            split: b.split,
            batch_id: b.batchId,
            features: bundle.schema.features,
            attention_mask: b.mask[i],
            delta_days: b.deltaDays[i],
            target_ltv: b.y_ltv[i],
            input_tensor: b.X[i],
          })
        );
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stratum_transformer_sequences.jsonl';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Full Audit Checklist */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h1 className="text-lg font-bold text-slate-900">
            Cross-Paradigm Validation &amp; Artifact Export
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated integrity checks verifying zero entity split leakage, temporal boundary isolation, and CQL support coverage.
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {audits.map((chk) => (
            <div
              key={chk.id}
              className="px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                {chk.status === 'pass' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                )}
                {chk.status === 'warn' && (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                {chk.status === 'fail' && (
                  <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {chk.name}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      · {chk.paradigm}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 max-w-3xl leading-relaxed">
                    {chk.detail}
                  </p>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                  {chk.metricValue}
                </div>
                <div
                  className={`text-[11px] font-medium mt-0.5 ${
                    chk.status === 'pass'
                      ? 'text-emerald-700'
                      : chk.status === 'warn'
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}
                >
                  {chk.status === 'pass'
                    ? 'Passed'
                    : chk.status === 'warn'
                    ? 'Review Recommended'
                    : 'Failed'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Downloadable Materialized Artifacts */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Materialized Dataset Artifacts
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Download curated outputs directly from your active workspace parameters with deterministic entity splits embedded.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {piiMaskingConfig.enabled ? (
              <span className="inline-flex items-center gap-1.5 font-mono font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded">
                <ShieldCheck className="w-3.5 h-3.5" />
                PII Masking Active ({piiMaskingConfig.mode})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-mono text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded">
                <Shield className="w-3.5 h-3.5" />
                Raw entity_id Export
              </span>
            )}
          </div>
        </div>

        {/* PII Masking Utility Bar */}
        <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {piiMaskingConfig.enabled ? (
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <Shield className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Export PII Masking &amp; De-Identification
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Optionally hash or redact <code className="font-mono text-slate-800">entity_id</code>, event/transition IDs, and embedded emails, phones, SSNs, or IPs across all CSV, JSON, MDP, and PostgreSQL exports.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={piiMaskingConfig.enabled}
                aria-label="Enable PII Masking for Exports"
                onClick={() =>
                  onUpdatePiiMaskingConfig({
                    ...piiMaskingConfig,
                    enabled: !piiMaskingConfig.enabled,
                  })
                }
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  piiMaskingConfig.enabled
                    ? 'bg-blue-700 border-blue-700'
                    : 'bg-slate-200 border-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                    piiMaskingConfig.enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <span className="text-xs font-medium text-slate-800 whitespace-nowrap">
                {piiMaskingConfig.enabled ? 'Mask PII Enabled' : 'Mask PII Off'}
              </span>
            </div>
          </div>

          {piiMaskingConfig.enabled && (
            <div className="pt-3 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
              <div className="lg:col-span-5 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">
                  Strategy:
                </span>
                <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-md">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdatePiiMaskingConfig({ ...piiMaskingConfig, mode: 'hash' })
                    }
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      piiMaskingConfig.mode === 'hash'
                        ? 'bg-blue-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Salted Hash (FNV-64)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdatePiiMaskingConfig({ ...piiMaskingConfig, mode: 'redact' })
                    }
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      piiMaskingConfig.mode === 'redact'
                        ? 'bg-blue-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Redact ([REDACTED])
                  </button>
                </div>
              </div>

              {piiMaskingConfig.mode === 'hash' && (
                <div className="lg:col-span-3 flex items-center gap-2">
                  <label
                    htmlFor="pii-hash-salt"
                    className="text-[11px] font-semibold text-slate-600 whitespace-nowrap"
                  >
                    Salt:
                  </label>
                  <input
                    id="pii-hash-salt"
                    type="text"
                    value={piiMaskingConfig.salt}
                    onChange={(e) =>
                      onUpdatePiiMaskingConfig({
                        ...piiMaskingConfig,
                        salt: e.target.value,
                      })
                    }
                    placeholder="stratum-pii-v1"
                    className="w-full px-2.5 py-1 text-xs font-mono bg-white border border-slate-200 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  />
                </div>
              )}

              <div
                className={`${
                  piiMaskingConfig.mode === 'hash' ? 'lg:col-span-4' : 'lg:col-span-7'
                } text-[11px] font-mono text-slate-600 bg-white border border-slate-200 rounded px-3 py-1.5 truncate`}
                title={piiSamples
                  .map((s) => `${s.original} -> ${s.masked}`)
                  .join(' | ')}
              >
                <span className="text-slate-400 mr-1.5">Preview:</span>
                {piiSamples.length > 0
                  ? piiSamples
                      .slice(0, 2)
                      .map((s) => `${s.original} → ${s.masked}`)
                      .join(' · ')
                  : 'No entities loaded'}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-col justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                01. Regression LTV Table
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
                {regResult.rows.length} rows · {7 + exportFeatures.length} cols · {regResult.batchCount} batches (bs={regConfig.batchSize}) · CSV
              </div>
            </div>
            <button
              type="button"
              onClick={onDownloadRegressionCsv}
              className="mt-4 w-full py-2 px-3 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV</span>
            </button>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-col justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                02. Transformer-Ready Tensors
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
                [{seqResult.tensorShape.join(', ')}] · {seqResult.batchCount} batches (bs={seqConfig.batchSize}) · JSON / JSONL
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onDownloadSequenceJson}
                className="py-2 px-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors inline-flex items-center justify-center gap-1"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Tensor .json</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadTransformerJsonl}
                className="py-2 px-2.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors inline-flex items-center justify-center gap-1"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>HF .jsonl</span>
              </button>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-col justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                03. Offline RL MDP Replay
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
                {mdpResult.transitions.length} transitions · γ={mdpConfig.gamma} · JSON
              </div>
            </div>
            <button
              type="button"
              onClick={onDownloadMdpJson}
              className="mt-4 w-full py-2 px-3 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download JSON</span>
            </button>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900">
                  04. PostgreSQL Script Dump
                </div>
                <Database className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
                {regResult.rows.length} rows · {sqlVerification.columns.length} cols · DDL + UPSERT · SQL
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsSqlModalOpen(true)}
                className="py-2 px-2.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors inline-flex items-center justify-center gap-1"
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>Verify SQL</span>
              </button>
              <button
                type="button"
                onClick={onDownloadRegressionSql}
                className="py-2 px-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors inline-flex items-center justify-center gap-1"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Dump .sql</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Exported Dataset Feature Importance Summary Table */}
      <ExportFeatureImportancePanel
        datasetName={datasetName}
        regConfig={regConfig}
        regResult={regResult}
      />

      {/* Interactive SQL Schema & Execution Plan Verifier */}
      <SqlQueryVerifierPanel
        generatedSql={sqlVerification.selectQuery}
        datasetName={datasetName}
        regConfig={regConfig}
        regResult={regResult}
        piiMaskingConfig={piiMaskingConfig}
        columns={sqlVerification.columns}
      />

      {/* Dynamic Python & SQL Loader Codegen */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Generated Training Loader Reference
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Synchronized with your current cutoff, tensor padding, SQL schema, and MDP hyperparameters.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {(
                [
                  { id: 'regression', label: 'scikit-learn' },
                  { id: 'sequence', label: 'PyTorch' },
                  { id: 'offline_rl', label: 'd3rlpy CQL' },
                  { id: 'sql', label: 'PostgreSQL' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setCodeTab(t.id)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    codeTab === t.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <pre className="p-5 bg-slate-950 text-slate-100 font-mono text-xs overflow-x-auto leading-relaxed">
          <code>{codeSnippets[codeTab]}</code>
        </pre>
      </section>

      {/* SQL Schema & Sample SELECT Verification Modal */}
      {isSqlModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sql-verify-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Database className="w-4 h-4 text-blue-700 shrink-0" />
                <div>
                  <h2
                    id="sql-verify-modal-title"
                    className="text-sm font-semibold text-slate-900"
                  >
                    PostgreSQL Schema &amp; Sample SELECT Verification
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                    Table: {sqlVerification.tableName} · {regResult.rows.length} rows ·{' '}
                    {sqlVerification.columns.length} columns · T_obs={regConfig.obsCutoffDay}d · H=
                    {regConfig.horizonDays}d · bs={regConfig.batchSize}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsSqlModalOpen(false)}
                aria-label="Close SQL verification modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {/* Toggle between Sample SELECT Query and Table DDL */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                  <button
                    type="button"
                    onClick={() => setSqlPreviewMode('select')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      sqlPreviewMode === 'select'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sample SELECT Statement
                  </button>
                  <button
                    type="button"
                    onClick={() => setSqlPreviewMode('ddl')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      sqlPreviewMode === 'ddl'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    CREATE TABLE DDL ({sqlVerification.columns.length} cols)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyModalSql}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5"
                >
                  {modalCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied SQL</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy SQL</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-4 bg-slate-950 text-slate-100 font-mono text-xs rounded-md overflow-x-auto leading-relaxed">
                <code>
                  {sqlPreviewMode === 'select'
                    ? sqlVerification.selectQuery
                    : sqlVerification.ddlPreview}
                </code>
              </pre>

              {/* Column Schema Verification Matrix */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                    Materialized Column Mapping ({sqlVerification.columns.length} columns)
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500">
                    Norm: {regConfig.featureNormalization} · Split Filter: {regConfig.splitFilter} · Win: P
                    {regConfig.winsorizePercentile}
                  </span>
                </div>

                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                        <th className="py-2 px-3">Column Name</th>
                        <th className="py-2 px-3">PostgreSQL Type</th>
                        <th className="py-2 px-3">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {sqlVerification.columns.map((col) => (
                        <tr key={col.name} className="bg-white">
                          <td className="py-1.5 px-3 font-mono font-semibold text-slate-900">
                            {col.name}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-blue-700">
                            {col.pgType}
                          </td>
                          <td className="py-1.5 px-3 text-slate-600">
                            {col.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Includes transactional <code className="font-mono text-slate-700">BEGIN / COMMIT</code> and idempotent{' '}
                <code className="font-mono text-slate-700">ON CONFLICT (entity_id) DO UPDATE</code>.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsSqlModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDownloadRegressionSql();
                    setIsSqlModalOpen(false);
                  }}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Full Dump (.sql)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
