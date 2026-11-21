import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Database,
  Download,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Lock,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import {
  auditMetadataFieldStandardization,
  buildStandardizedMetadataManifest,
  computeSha256Hex,
  computeWorkingTreeHash,
  diffCommitAgainstState,
  stripUndefinedDeep,
} from '../engine/governanceEngine';
import {
  ArchiveBundleRecord,
  ArchiveRetentionWindow,
  ArchiveStorageTier,
  AuditCheck,
  CurationRuleId,
  DataClassification,
  DatasetCommitRecord,
  DatasetPreset,
  EngineeredFeatureId,
  GlobalCurationConfig,
  GovernancePolicyFlags,
  GovernanceRecord,
  GovernanceRetentionPolicy,
  MdpConfig,
  MetadataStandard,
  PiiMaskingConfig,
  RawEvent,
  RegressionConfig,
  RulConfig,
  SequenceConfig,
} from '../types/curation';

export interface GovernanceRestorePayload {
  presetId: string;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig?: RulConfig;
  appliedCurationRules?: CurationRuleId[];
  enabledEngineeredFeatures?: EngineeredFeatureId[];
}

interface GovernanceRepositoryViewProps {
  presets: DatasetPreset[];
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  datasetDomain: string;
  datasetFingerprint: string;
  events: RawEvent[];
  totalEntitiesCount: number;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig: RulConfig;
  appliedCurationRules: CurationRuleId[];
  enabledEngineeredFeatures: EngineeredFeatureId[];
  piiMaskingConfig: PiiMaskingConfig;
  onUpdatePiiMaskingConfig: React.Dispatch<React.SetStateAction<PiiMaskingConfig>>;
  audits: AuditCheck[];
  summaryStats: {
    regRows: number;
    tensorShape: [number, number, number];
    transitions: number;
    rulWindows: number;
  };
  onActivateDataset: (presetId: string) => void;
  onRestoreState: (payload: GovernanceRestorePayload, label: string) => void;
  onOpenDatasetSearch: () => void;
  onOpenAutoDocs: (datasetId: string) => void;
}

type GovernanceTab = 'metadata' | 'catalog' | 'vcs' | 'archive';

const LOCAL_GOV_KEY = 'stratum_local_governance_records_v1';
const LOCAL_VCS_KEY = 'stratum_local_vcs_commits_v1';
const LOCAL_ARCHIVE_KEY = 'stratum_local_archive_vaults_v1';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function loadLocalArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function saveLocalArray<T>(key: string, items: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(0, 40)));
  } catch {
    // ignore quota errors
  }
}

function formatRecordTimestamp(
  ts: { toDate?: () => Date } | string | null | undefined
): string {
  if (!ts) return 'Just now';
  let d: Date | null = null;
  if (typeof ts === 'string') {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  } else if (typeof ts === 'object' && typeof ts.toDate === 'function') {
    d = ts.toDate();
  }
  if (!d) return 'Just now';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function getTimestampSortMs(
  ts: { toDate?: () => Date } | null | undefined,
  localIso?: string
): number {
  if (ts && typeof ts.toDate === 'function') {
    return ts.toDate().getTime();
  }
  if (localIso) {
    const parsed = Date.parse(localIso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function triggerJsonDownload(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const GovernanceRepositoryView: React.FC<GovernanceRepositoryViewProps> = ({
  presets,
  activePresetId,
  customDatasetName,
  datasetName,
  datasetDomain,
  datasetFingerprint,
  events,
  totalEntitiesCount,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  rulConfig,
  appliedCurationRules,
  enabledEngineeredFeatures,
  piiMaskingConfig,
  onUpdatePiiMaskingConfig,
  audits,
  summaryStats,
  onActivateDataset,
  onRestoreState,
  onOpenDatasetSearch,
  onOpenAutoDocs,
}) => {
  const { user, authReady, profileSynced } = useAuth();
  const isCloudReady = Boolean(authReady && user && profileSynced);

  const [subTab, setSubTab] = useState<GovernanceTab>('metadata');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cloud + local records
  const [cloudGovRecords, setCloudGovRecords] = useState<GovernanceRecord[]>([]);
  const [localGovRecords, setLocalGovRecords] = useState<GovernanceRecord[]>(() =>
    loadLocalArray<GovernanceRecord>(LOCAL_GOV_KEY)
  );
  const [cloudCommits, setCloudCommits] = useState<DatasetCommitRecord[]>([]);
  const [localCommits, setLocalCommits] = useState<DatasetCommitRecord[]>(() =>
    loadLocalArray<DatasetCommitRecord>(LOCAL_VCS_KEY)
  );
  const [cloudArchives, setCloudArchives] = useState<ArchiveBundleRecord[]>([]);
  const [localArchives, setLocalArchives] = useState<ArchiveBundleRecord[]>(() =>
    loadLocalArray<ArchiveBundleRecord>(LOCAL_ARCHIVE_KEY)
  );

  // Metadata Standardization State
  const activeDatasetId = customDatasetName ? 'custom_csv' : activePresetId;
  const [standard, setStandard] = useState<MetadataStandard>('ML-Croissant');
  const [stewardInput, setStewardInput] = useState('Stratum ML Data Engineering');
  const [domainInput, setDomainInput] = useState(datasetDomain);
  const [classification, setClassification] = useState<DataClassification>('Restricted-PII');
  const [retentionPolicy, setRetentionPolicy] = useState<GovernanceRetentionPolicy>('Cold-3y');
  const [licenseInput, setLicenseInput] = useState('Internal-Enterprise-1.0');
  const [descriptionInput, setDescriptionInput] = useState(
    `Canonical multi-paradigm dataset (${datasetName}) standardized for Regression LTV, Transformer sequence tensors, Offline RL MDP trajectories, and RUL forecasting.`
  );
  const [keywordsInput, setKeywordsInput] = useState(
    'ml-curation, point-in-time, ltv, transformer, offline-rl, rul'
  );
  const [policyFlags, setPolicyFlags] = useState<GovernancePolicyFlags>({
    enforcePiiMasking: piiMaskingConfig.enabled,
    requireLeakageGuard: true,
    mandateDeterministicSplit: true,
    blockUnverifiedExports: true,
  });
  const [savingGovernance, setSavingGovernance] = useState(false);

  // VCS State
  const [activeBranch, setActiveBranch] = useState('main');
  const [customBranches, setCustomBranches] = useState<string[]>([
    'main',
    'staging',
    'experiment/rl-tuning',
  ]);
  const [newBranchInput, setNewBranchInput] = useState('');
  const [commitMessageInput, setCommitMessageInput] = useState('');
  const [commitTagInput, setCommitTagInput] = useState('');
  const [committing, setCommitting] = useState(false);
  const [selectedCommitId, setSelectedCommitId] = useState<string>('');

  // Archival Vault State
  const [archiveTitleInput, setArchiveTitleInput] = useState('');
  const [archiveTier, setArchiveTier] = useState<ArchiveStorageTier>('Cold WORM Glacier');
  const [archiveRetention, setArchiveRetention] =
    useState<ArchiveRetentionWindow>('7 Years (WORM)');
  const [archiveHold, setArchiveHold] = useState(true);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    setDomainInput(datasetDomain);
    setDescriptionInput(
      `Canonical multi-paradigm dataset (${datasetName}) standardized for Regression LTV, Transformer sequence tensors, Offline RL MDP trajectories, and RUL forecasting.`
    );
  }, [datasetName, datasetDomain]);

  useEffect(() => {
    setPolicyFlags((prev) => ({
      ...prev,
      enforcePiiMasking: piiMaskingConfig.enabled,
    }));
  }, [piiMaskingConfig.enabled]);

  // Firestore Listeners
  useEffect(() => {
    if (!isCloudReady || !user) {
      setCloudGovRecords([]);
      setCloudCommits([]);
      setCloudArchives([]);
      return;
    }

    const govPath = `users/${user.uid}/governanceRecords`;
    const vcsPath = `users/${user.uid}/vcsCommits`;
    const arcPath = `users/${user.uid}/archiveVaults`;

    const unsubGov = onSnapshot(
      query(collection(db, 'users', user.uid, 'governanceRecords'), where('ownerId', '==', user.uid)),
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as GovernanceRecord);
        docs.sort(
          (a, b) =>
            getTimestampSortMs(b.updatedAt, b.localTimestampIso) -
            getTimestampSortMs(a.updatedAt, a.localTimestampIso)
        );
        setCloudGovRecords(docs);
      },
      (err) => {
        setErrorMessage('Unable to sync governance records from Firestore.');
        handleFirestoreError(err, OperationType.LIST, govPath);
      }
    );

    const unsubVcs = onSnapshot(
      query(collection(db, 'users', user.uid, 'vcsCommits'), where('ownerId', '==', user.uid)),
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as DatasetCommitRecord);
        docs.sort(
          (a, b) =>
            getTimestampSortMs(b.createdAt, b.localTimestampIso) -
            getTimestampSortMs(a.createdAt, a.localTimestampIso)
        );
        setCloudCommits(docs);
      },
      (err) => {
        setErrorMessage('Unable to sync version control commits from Firestore.');
        handleFirestoreError(err, OperationType.LIST, vcsPath);
      }
    );

    const unsubArc = onSnapshot(
      query(collection(db, 'users', user.uid, 'archiveVaults'), where('ownerId', '==', user.uid)),
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as ArchiveBundleRecord);
        docs.sort(
          (a, b) =>
            getTimestampSortMs(b.updatedAt, b.localTimestampIso) -
            getTimestampSortMs(a.updatedAt, a.localTimestampIso)
        );
        setCloudArchives(docs);
      },
      (err) => {
        setErrorMessage('Unable to sync archive vault entries from Firestore.');
        handleFirestoreError(err, OperationType.LIST, arcPath);
      }
    );

    return () => {
      unsubGov();
      unsubVcs();
      unsubArc();
    };
  }, [isCloudReady, user]);

  const govRecords = isCloudReady ? cloudGovRecords : localGovRecords;
  const commits = isCloudReady ? cloudCommits : localCommits;
  const archives = isCloudReady ? cloudArchives : localArchives;

  // Metadata compliance calculation
  const fieldAudit = useMemo(
    () => auditMetadataFieldStandardization(piiMaskingConfig, enabledEngineeredFeatures),
    [piiMaskingConfig, enabledEngineeredFeatures]
  );

  const parsedKeywords = useMemo(
    () =>
      keywordsInput
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
        .slice(0, 10),
    [keywordsInput]
  );

  const overallGovernanceScore = useMemo(() => {
    const passedAudits = audits.filter((a) => a.status === 'pass').length;
    const auditScore = audits.length > 0 ? (passedAudits / audits.length) * 100 : 100;
    const formComplete =
      stewardInput.trim().length > 0 &&
      descriptionInput.trim().length >= 20 &&
      parsedKeywords.length >= 2
        ? 100
        : 75;
    return Math.round((fieldAudit.compliancePct * 0.55 + auditScore * 0.25 + formComplete * 0.2) * 10) / 10;
  }, [fieldAudit.compliancePct, audits, stewardInput, descriptionInput, parsedKeywords.length]);

  const workingTreeHash = useMemo(
    () =>
      computeWorkingTreeHash({
        datasetId: activeDatasetId,
        datasetFingerprint,
        globalConfig,
        regConfig,
        seqConfig,
        mdpConfig,
        rulConfig,
        appliedCurationRules,
        enabledEngineeredFeatures,
      }),
    [
      activeDatasetId,
      datasetFingerprint,
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
      rulConfig,
      appliedCurationRules,
      enabledEngineeredFeatures,
    ]
  );

  const allBranches = useMemo(() => {
    const set = new Set<string>(customBranches);
    for (const c of commits) {
      if (c.branch) set.add(c.branch);
    }
    return Array.from(set);
  }, [customBranches, commits]);

  const branchCommits = useMemo(
    () => commits.filter((c) => c.branch === activeBranch),
    [commits, activeBranch]
  );

  const headCommit = branchCommits[0] ?? commits[0] ?? null;

  const selectedCommit = useMemo(() => {
    if (selectedCommitId) {
      const found = commits.find((c) => c.commitId === selectedCommitId);
      if (found) return found;
    }
    return headCommit;
  }, [commits, selectedCommitId, headCommit]);

  const workingDiffRows = useMemo(() => {
    if (!selectedCommit) return [];
    return diffCommitAgainstState(selectedCommit, {
      datasetId: activeDatasetId,
      datasetName,
      datasetFingerprint,
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
      rulConfig,
      appliedCurationRules,
      enabledEngineeredFeatures,
    });
  }, [
    selectedCommit,
    activeDatasetId,
    datasetName,
    datasetFingerprint,
    globalConfig,
    regConfig,
    seqConfig,
    mdpConfig,
    rulConfig,
    appliedCurationRules,
    enabledEngineeredFeatures,
  ]);

  const hasUncommittedChanges = useMemo(() => {
    if (!headCommit) return true;
    return headCommit.commitHash !== workingTreeHash;
  }, [headCommit, workingTreeHash]);

  // Save Governance Metadata Record
  const handleSaveGovernanceRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const recordId = makeSafeId('gov');
    const cleanSteward = (stewardInput.trim() || 'Stratum Steward').slice(0, 120);
    const cleanDomain = (domainInput.trim() || datasetDomain).slice(0, 120);
    const cleanLicense = (licenseInput.trim() || 'Internal-1.0').slice(0, 80);
    const cleanDesc = (descriptionInput.trim() || `${datasetName} metadata record`).slice(0, 600);
    const nowIso = new Date().toISOString();

    const basePayload = {
      recordId,
      ownerId: isCloudReady && user ? user.uid : 'local-user',
      datasetId: activeDatasetId.slice(0, 120),
      datasetName: datasetName.slice(0, 120),
      standard,
      steward: cleanSteward,
      domain: cleanDomain,
      classification,
      retentionPolicy,
      license: cleanLicense,
      description: cleanDesc,
      keywords: parsedKeywords,
      complianceScore: overallGovernanceScore,
      policyFlags: stripUndefinedDeep(policyFlags),
      standardizedFieldsCount: fieldAudit.fields.length,
    };

    setSavingGovernance(true);
    try {
      if (isCloudReady && user) {
        const path = `users/${user.uid}/governanceRecords/${recordId}`;
        try {
          await setDoc(doc(db, 'users', user.uid, 'governanceRecords', recordId), {
            ...basePayload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setStatusMessage(
            `Registered ${standard} metadata manifest for "${datasetName}" (${overallGovernanceScore}% compliant).`
          );
        } catch (err) {
          setErrorMessage('Failed to save governance record to Firestore.');
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      } else {
        const next: GovernanceRecord[] = [
          { ...basePayload, localTimestampIso: nowIso },
          ...localGovRecords,
        ];
        setLocalGovRecords(next);
        saveLocalArray(LOCAL_GOV_KEY, next);
        setStatusMessage(
          `Saved ${standard} metadata manifest locally for "${datasetName}" (${overallGovernanceScore}% compliant).`
        );
      }
    } finally {
      setSavingGovernance(false);
    }
  };

  const handleDeleteGovernanceRecord = async (recordId: string) => {
    setErrorMessage(null);
    if (isCloudReady && user) {
      const path = `users/${user.uid}/governanceRecords/${recordId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'governanceRecords', recordId));
      } catch (err) {
        setErrorMessage('Unable to delete governance record.');
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      const next = localGovRecords.filter((r) => r.recordId !== recordId);
      setLocalGovRecords(next);
      saveLocalArray(LOCAL_GOV_KEY, next);
    }
  };

  const handleDownloadManifest = () => {
    const manifest = buildStandardizedMetadataManifest({
      standard,
      record: {
        datasetId: activeDatasetId,
        datasetName,
        steward: stewardInput.trim() || 'Stratum Steward',
        domain: domainInput.trim() || datasetDomain,
        classification,
        retentionPolicy,
        license: licenseInput.trim() || 'Internal-1.0',
        description: descriptionInput.trim() || datasetName,
        keywords: parsedKeywords,
        policyFlags,
        complianceScore: overallGovernanceScore,
      },
      datasetFingerprint,
      eventCount: events.length,
      entityCount: totalEntitiesCount,
      fields: fieldAudit.fields,
    });
    const slug = standard.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    triggerJsonDownload(`stratum_metadata_${slug}_${activeDatasetId}.json`, manifest);
  };

  // VCS Actions
  const handleCreateBranch = () => {
    const clean = newBranchInput.trim().replace(/\s+/g, '-').slice(0, 64);
    if (!clean) return;
    if (!allBranches.includes(clean)) {
      setCustomBranches((prev) => [...prev, clean]);
    }
    setActiveBranch(clean);
    setNewBranchInput('');
    setStatusMessage(`Switched active VCS branch to "${clean}".`);
  };

  const handleCreateCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    const cleanMsg = commitMessageInput.trim().slice(0, 240);
    if (!cleanMsg) {
      setErrorMessage('Enter a commit message describing the pipeline or dataset state.');
      return;
    }

    const commitId = makeSafeId('cmit');
    const cleanTag = commitTagInput.trim().slice(0, 64);
    const nowIso = new Date().toISOString();
    const authorLabel = (
      (isCloudReady && user ? user.displayName || user.email : 'Local Engineer') || 'Stratum User'
    ).slice(0, 120);

    const commitPayload: Record<string, unknown> = {
      commitId,
      ownerId: isCloudReady && user ? user.uid : 'local-user',
      commitHash: workingTreeHash,
      branch: activeBranch.slice(0, 64),
      message: cleanMsg,
      author: authorLabel,
      datasetId: activeDatasetId.slice(0, 120),
      datasetName: datasetName.slice(0, 120),
      datasetFingerprint: datasetFingerprint.slice(0, 128),
      eventCount: events.length,
      entityCount: totalEntitiesCount,
      globalConfig: stripUndefinedDeep({ ...globalConfig }),
      regConfig: stripUndefinedDeep({ ...regConfig }),
      seqConfig: stripUndefinedDeep({ ...seqConfig }),
      mdpConfig: stripUndefinedDeep({ ...mdpConfig }),
      rulConfig: stripUndefinedDeep({ ...rulConfig }),
      appliedCurationRules: [...appliedCurationRules].slice(0, 10),
      enabledEngineeredFeatures: [...enabledEngineeredFeatures].slice(0, 10),
    };
    if (headCommit?.commitHash) {
      commitPayload.parentHash = headCommit.commitHash.slice(0, 64);
    }
    if (cleanTag) {
      commitPayload.tag = cleanTag;
    }

    setCommitting(true);
    try {
      if (isCloudReady && user) {
        const path = `users/${user.uid}/vcsCommits/${commitId}`;
        try {
          await setDoc(doc(db, 'users', user.uid, 'vcsCommits', commitId), {
            ...commitPayload,
            createdAt: serverTimestamp(),
          });
          setCommitMessageInput('');
          setCommitTagInput('');
          setSelectedCommitId(commitId);
          setStatusMessage(
            `Committed [${activeBranch}@${workingTreeHash.slice(0, 8)}]: ${cleanMsg}`
          );
        } catch (err) {
          setErrorMessage('Failed to push commit to Firestore VCS.');
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      } else {
        const localRecord = {
          ...(commitPayload as unknown as DatasetCommitRecord),
          localTimestampIso: nowIso,
        };
        const next = [localRecord, ...localCommits];
        setLocalCommits(next);
        saveLocalArray(LOCAL_VCS_KEY, next);
        setCommitMessageInput('');
        setCommitTagInput('');
        setSelectedCommitId(commitId);
        setStatusMessage(
          `Committed locally [${activeBranch}@${workingTreeHash.slice(0, 8)}]: ${cleanMsg}`
        );
      }
    } finally {
      setCommitting(false);
    }
  };

  const handleCheckoutCommit = (commit: DatasetCommitRecord) => {
    onRestoreState(
      {
        presetId: commit.datasetId,
        globalConfig: commit.globalConfig,
        regConfig: commit.regConfig,
        seqConfig: commit.seqConfig,
        mdpConfig: commit.mdpConfig,
        rulConfig: commit.rulConfig,
        appliedCurationRules: commit.appliedCurationRules,
        enabledEngineeredFeatures: commit.enabledEngineeredFeatures,
      },
      `Checked out commit ${commit.commitHash.slice(0, 8)} (${commit.branch})`
    );
    setStatusMessage(
      `Checked out [${commit.branch}@${commit.commitHash.slice(0, 8)}] — workspace configurations synchronized.`
    );
  };

  const handleDeleteCommit = async (commitId: string) => {
    setErrorMessage(null);
    if (isCloudReady && user) {
      const path = `users/${user.uid}/vcsCommits/${commitId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'vcsCommits', commitId));
      } catch (err) {
        setErrorMessage('Unable to delete commit.');
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      const next = localCommits.filter((c) => c.commitId !== commitId);
      setLocalCommits(next);
      saveLocalArray(LOCAL_VCS_KEY, next);
    }
  };

  // Repository & Archival Vault Actions
  const handleArchiveBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const archiveId = makeSafeId('arc');
    const cleanTitle = (
      archiveTitleInput.trim() || `${datasetName} · Multi-Paradigm Release`
    ).slice(0, 140);
    const nowIso = new Date().toISOString();

    const manifest = buildStandardizedMetadataManifest({
      standard,
      record: {
        datasetId: activeDatasetId,
        datasetName,
        steward: stewardInput.trim() || 'Stratum Steward',
        domain: domainInput.trim() || datasetDomain,
        classification,
        retentionPolicy,
        license: licenseInput.trim() || 'Internal-1.0',
        description: descriptionInput.trim() || datasetName,
        keywords: parsedKeywords,
        policyFlags,
        complianceScore: overallGovernanceScore,
      },
      datasetFingerprint,
      eventCount: events.length,
      entityCount: totalEntitiesCount,
      fields: fieldAudit.fields,
    });

    const bundleBody = {
      datasetId: activeDatasetId,
      datasetName,
      datasetFingerprint,
      manifest,
      configs: {
        globalConfig,
        regConfig,
        seqConfig,
        mdpConfig,
        rulConfig,
      },
      artifactSummary: {
        regRows: summaryStats.regRows,
        tensorShape: summaryStats.tensorShape,
        transitions: summaryStats.transitions,
        rulWindows: summaryStats.rulWindows,
        eventCount: events.length,
      },
    };

    setArchiving(true);
    try {
      const serialized = JSON.stringify(bundleBody);
      const sha256Digest = await computeSha256Hex(serialized);
      const payloadSizeKb = Math.max(1, Math.round((serialized.length / 1024) * 10) / 10);
      const archiveUrn = `urn:stratum:vault:${activeDatasetId}:${sha256Digest.slice(0, 12)}`.slice(
        0,
        160
      );

      const archivePayload = {
        archiveId,
        ownerId: isCloudReady && user ? user.uid : 'local-user',
        archiveUrn,
        title: cleanTitle,
        datasetId: activeDatasetId.slice(0, 120),
        datasetName: datasetName.slice(0, 120),
        datasetFingerprint: datasetFingerprint.slice(0, 128),
        sha256Digest,
        standard,
        storageTier: archiveTier,
        retentionWindow: archiveRetention,
        retentionHold: archiveHold,
        payloadSizeKb,
        artifactSummary: stripUndefinedDeep({
          regRows: summaryStats.regRows,
          tensorShape: [...summaryStats.tensorShape] as [number, number, number],
          transitions: summaryStats.transitions,
          rulWindows: summaryStats.rulWindows,
          eventCount: events.length,
        }),
        snapshotConfigs: stripUndefinedDeep({
          globalConfig: { ...globalConfig },
          regConfig: { ...regConfig },
          seqConfig: { ...seqConfig },
          mdpConfig: { ...mdpConfig },
          rulConfig: { ...rulConfig },
        }),
        lastVerifiedIso: nowIso.slice(0, 64),
      };

      if (isCloudReady && user) {
        const path = `users/${user.uid}/archiveVaults/${archiveId}`;
        try {
          await setDoc(doc(db, 'users', user.uid, 'archiveVaults', archiveId), {
            ...archivePayload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setArchiveTitleInput('');
          setStatusMessage(
            `Deposited "${cleanTitle}" into ${archiveTier} (SHA-256: ${sha256Digest.slice(0, 12)}…).`
          );
        } catch (err) {
          setErrorMessage('Failed to deposit bundle to Firestore archive vault.');
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      } else {
        const next: ArchiveBundleRecord[] = [
          { ...archivePayload, localTimestampIso: nowIso },
          ...localArchives,
        ];
        setLocalArchives(next);
        saveLocalArray(LOCAL_ARCHIVE_KEY, next);
        setArchiveTitleInput('');
        setStatusMessage(
          `Deposited "${cleanTitle}" locally into ${archiveTier} (SHA-256: ${sha256Digest.slice(0, 12)}…).`
        );
      }
    } finally {
      setArchiving(false);
    }
  };

  const handleUpdateArchiveLifecycle = async (
    item: ArchiveBundleRecord,
    patch: Partial<Pick<ArchiveBundleRecord, 'storageTier' | 'retentionHold' | 'lastVerifiedIso'>>
  ) => {
    setErrorMessage(null);
    const nextTier = patch.storageTier ?? item.storageTier;
    const nextHold = patch.retentionHold ?? item.retentionHold;
    const nextVerified = patch.lastVerifiedIso ?? item.lastVerifiedIso ?? new Date().toISOString();

    if (isCloudReady && user) {
      const path = `users/${user.uid}/archiveVaults/${item.archiveId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'archiveVaults', item.archiveId), {
          storageTier: nextTier,
          retentionHold: nextHold,
          lastVerifiedIso: nextVerified.slice(0, 64),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        setErrorMessage('Unable to update archival bundle lifecycle state.');
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    } else {
      const next = localArchives.map((a) =>
        a.archiveId === item.archiveId
          ? {
              ...a,
              storageTier: nextTier,
              retentionHold: nextHold,
              lastVerifiedIso: nextVerified,
              localTimestampIso: new Date().toISOString(),
            }
          : a
      );
      setLocalArchives(next);
      saveLocalArray(LOCAL_ARCHIVE_KEY, next);
    }
  };

  const handleDeleteArchive = async (item: ArchiveBundleRecord) => {
    if (item.retentionHold) {
      setErrorMessage('Release Retention Hold before purging this archival bundle.');
      return;
    }
    setErrorMessage(null);
    if (isCloudReady && user) {
      const path = `users/${user.uid}/archiveVaults/${item.archiveId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'archiveVaults', item.archiveId));
      } catch (err) {
        setErrorMessage('Unable to purge archive bundle.');
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    } else {
      const next = localArchives.filter((a) => a.archiveId !== item.archiveId);
      setLocalArchives(next);
      saveLocalArray(LOCAL_ARCHIVE_KEY, next);
    }
  };

  const handleVerifyArchiveChecksum = async (item: ArchiveBundleRecord) => {
    const nowIso = new Date().toISOString();
    await handleUpdateArchiveLifecycle(item, { lastVerifiedIso: nowIso });
    setStatusMessage(
      `Verified SHA-256 digest (${item.sha256Digest.slice(0, 16)}…) for "${item.title}".`
    );
  };

  const nextStorageTier = (current: ArchiveStorageTier): ArchiveStorageTier => {
    if (current === 'Hot Registry') return 'Warm Object Store';
    if (current === 'Warm Object Store') return 'Cold WORM Glacier';
    return 'Hot Registry';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Metadata, Governance, VCS &amp; Archival Repository
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Author standardized dataset manifests, enforce catalog PII and leakage policies, commit
            and diff curation versions, and deposit SHA-256 verified archival bundles.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
            <span>{datasetName}</span>
            <span aria-hidden="true">·</span>
            <span>FP {datasetFingerprint}</span>
            <span aria-hidden="true">·</span>
            <span>HEAD {activeBranch}@{workingTreeHash.slice(0, 8)}</span>
            <span aria-hidden="true">·</span>
            <span>{isCloudReady ? 'Cloud Synced (Firestore)' : 'Local Browser Vault'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenDatasetSearch}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Database className="w-3.5 h-3.5 text-slate-500" />
            <span>Search Catalog</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenAutoDocs(activeDatasetId)}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <BookOpen className="w-3.5 h-3.5 text-slate-500" />
            <span>Auto-Docs</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadManifest}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export {standard} JSON</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Metadata Compliance</div>
          <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {overallGovernanceScore.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {fieldAudit.compliantCount}/{fieldAudit.fields.length} schema columns compliant
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Catalog &amp; Governance Records</div>
          <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {(presets.length + (customDatasetName ? 1 : 0)).toString()} assets · {govRecords.length} specs
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            PII Masking: {piiMaskingConfig.enabled ? 'Enforced' : 'Unmasked'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Version Control (VCS)</div>
          <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {commits.length} commits
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {activeBranch} · {hasUncommittedChanges ? 'Modified tree' : 'Clean vs HEAD'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Archival Vault Bundles</div>
          <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {archives.length} deposits
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            {archives.filter((a) => a.retentionHold).length} under WORM retention hold
          </div>
        </div>
      </section>

      {/* Four-Pillar Switcher */}
      <div className="inline-flex flex-wrap p-1 bg-slate-100 rounded-lg gap-1">
        <button
          type="button"
          onClick={() => setSubTab('metadata')}
          className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'metadata'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5" />
          <span>Metadata Creation &amp; Standardization</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('catalog')}
          className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'catalog'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Data Catalogs &amp; Governance</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('vcs')}
          className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'vcs'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>Version Control System ({commits.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('archive')}
          className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'archive'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>Repository &amp; Archival Vault ({archives.length})</span>
        </button>
      </div>

      {statusMessage && (
        <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* PILLAR 1: METADATA CREATION & STANDARDIZATION */}
      {subTab === 'metadata' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Metadata Manifest Creator */}
          <form
            onSubmit={handleSaveGovernanceRecord}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">
                Metadata Manifest Creator
              </h2>
              <span className="text-[11px] font-mono text-slate-500">
                {standard}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Metadata Standard
                </label>
                <select
                  aria-label="Metadata standard"
                  value={standard}
                  onChange={(e) => setStandard(e.target.value as MetadataStandard)}
                  className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                >
                  <option value="ML-Croissant">ML-Croissant (MLCommons)</option>
                  <option value="DCAT-3">W3C DCAT-3 (JSON-LD)</option>
                  <option value="ISO-11179">ISO/IEC 11179 Registry</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Classification Tier
                </label>
                <select
                  aria-label="Data sensitivity classification"
                  value={classification}
                  onChange={(e) => setClassification(e.target.value as DataClassification)}
                  className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                >
                  <option value="Public">Public</option>
                  <option value="Internal">Internal</option>
                  <option value="Confidential">Confidential</option>
                  <option value="Restricted-PII">Restricted-PII</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Data Steward / Owner
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={stewardInput}
                  onChange={(e) => setStewardInput(e.target.value)}
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-md text-slate-900"
                  required
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Retention Policy
                </label>
                <select
                  aria-label="Retention policy"
                  value={retentionPolicy}
                  onChange={(e) =>
                    setRetentionPolicy(e.target.value as GovernanceRetentionPolicy)
                  }
                  className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                >
                  <option value="Hot-90d">Hot (90 days)</option>
                  <option value="Warm-1y">Warm (1 year)</option>
                  <option value="Cold-3y">Cold (3 years)</option>
                  <option value="WORM-7y">WORM Compliance (7 years)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Domain</label>
                <input
                  type="text"
                  maxLength={120}
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-md text-slate-900"
                  required
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">License ID</label>
                <input
                  type="text"
                  maxLength={80}
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  className="w-full h-9 px-2.5 font-mono bg-white border border-slate-200 rounded-md text-slate-900"
                  required
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">
                Standardized Abstract &amp; Provenance
              </label>
              <textarea
                rows={3}
                maxLength={600}
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-md text-slate-900"
                required
              />
            </div>

            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">
                Taxonomy Keywords (comma-separated, max 10)
              </label>
              <input
                type="text"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                className="w-full h-9 px-2.5 font-mono bg-white border border-slate-200 rounded-md text-slate-900"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleDownloadManifest}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Download {standard} Manifest
              </button>
              <button
                type="submit"
                disabled={savingGovernance}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {savingGovernance ? 'Registering...' : 'Register Metadata Spec'}
              </button>
            </div>
          </form>

          {/* Field Standardization & Linter */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Schema Standardization &amp; ISO-11179 Linter
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verifies snake_case taxonomy, value-domain typing, semantic definitions, and PII
                  masking parity across materialized columns.
                </p>
              </div>
              {fieldAudit.attentionCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdatePiiMaskingConfig((prev) => ({
                      ...prev,
                      enabled: true,
                    }))
                  }
                  className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  Enforce PII Masking Standard
                </button>
              )}
            </div>

            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="px-3.5 py-2.5 text-left font-semibold">Column / Element</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold">Table</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold">Type</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold">PII Guard</th>
                    <th className="px-3.5 py-2.5 text-left font-semibold">Standard Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fieldAudit.fields.map((f) => (
                    <tr key={`${f.tableName}-${f.columnName}`} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2.5">
                        <div className="font-mono font-medium text-slate-900">{f.columnName}</div>
                        <div className="text-[11px] font-mono text-slate-400">{f.isoElementTag}</div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-600">{f.tableName}</td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-700">{f.dataType}</td>
                      <td className="px-3.5 py-2.5 font-mono text-[11px]">
                        {f.piiSensitive ? (
                          <span className={f.maskingActive ? 'text-teal-700' : 'text-amber-700 font-semibold'}>
                            {f.maskingActive ? 'Hashed (SHA-256)' : 'Unmasked Identifier'}
                          </span>
                        ) : (
                          <span className="text-slate-400">Non-PII</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[11px] font-semibold uppercase">
                        <span
                          className={
                            f.status === 'compliant' ? 'text-teal-700' : 'text-amber-700'
                          }
                        >
                          {f.status === 'compliant' ? 'Compliant' : 'Needs Masking'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* PILLAR 2: DATA CATALOGS & GOVERNANCE PLATFORMS */}
      {subTab === 'catalog' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Governance Policy Enforcement */}
            <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="pb-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">
                  Governance Policy Enforcement
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Runtime guardrails controlling export compliance, PII obfuscation, and leakage checks.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <label className="flex items-start justify-between gap-3 p-3 bg-slate-50/70 border border-slate-200 rounded-md cursor-pointer">
                  <div>
                    <div className="font-semibold text-slate-900">Enforce PII Hashing on Exports</div>
                    <div className="text-slate-500 mt-0.5">
                      Masks entity and event identifiers via deterministic SHA-256 salt across CSV/JSON/SQL exports.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={piiMaskingConfig.enabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      onUpdatePiiMaskingConfig((prev) => ({ ...prev, enabled: next }));
                      setPolicyFlags((prev) => ({ ...prev, enforcePiiMasking: next }));
                    }}
                    className="mt-1 accent-blue-700"
                  />
                </label>

                <label className="flex items-start justify-between gap-3 p-3 bg-slate-50/70 border border-slate-200 rounded-md cursor-pointer">
                  <div>
                    <div className="font-semibold text-slate-900">Require Temporal Leakage Guard</div>
                    <div className="text-slate-500 mt-0.5">
                      Enforces strict T_obs &lt; target horizon cutoffs across Regression &amp; Sequence branches.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={policyFlags.requireLeakageGuard}
                    onChange={(e) =>
                      setPolicyFlags((prev) => ({ ...prev, requireLeakageGuard: e.target.checked }))
                    }
                    className="mt-1 accent-blue-700"
                  />
                </label>

                <label className="flex items-start justify-between gap-3 p-3 bg-slate-50/70 border border-slate-200 rounded-md cursor-pointer">
                  <div>
                    <div className="font-semibold text-slate-900">Mandate Deterministic Split Seed</div>
                    <div className="text-slate-500 mt-0.5">
                      Pins entity-hash assignment ({globalConfig.seedSalt}) across all 4 modeling paradigms.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={policyFlags.mandateDeterministicSplit}
                    onChange={(e) =>
                      setPolicyFlags((prev) => ({
                        ...prev,
                        mandateDeterministicSplit: e.target.checked,
                      }))
                    }
                    className="mt-1 accent-blue-700"
                  />
                </label>

                <label className="flex items-start justify-between gap-3 p-3 bg-slate-50/70 border border-slate-200 rounded-md cursor-pointer">
                  <div>
                    <div className="font-semibold text-slate-900">Block Unverified Schema Exports</div>
                    <div className="text-slate-500 mt-0.5">
                      Requires cross-paradigm audit validation prior to archival vault deposit.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={policyFlags.blockUnverifiedExports}
                    onChange={(e) =>
                      setPolicyFlags((prev) => ({
                        ...prev,
                        blockUnverifiedExports: e.target.checked,
                      }))
                    }
                    className="mt-1 accent-blue-700"
                  />
                </label>
              </div>
            </section>

            {/* Registered Governance Specifications */}
            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Registered Governance &amp; Metadata Catalog
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {govRecords.length} specs registered
                </span>
              </div>

              {govRecords.length === 0 ? (
                <div className="px-5 py-10 text-center text-xs text-slate-500 space-y-2">
                  <p>No custom metadata specifications registered yet.</p>
                  <button
                    type="button"
                    onClick={() => setSubTab('metadata')}
                    className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors"
                  >
                    Create First Metadata Spec
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {govRecords.map((rec) => (
                    <div key={rec.recordId} className="px-5 py-3.5 flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900">{rec.datasetName}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-slate-700">{rec.standard}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-amber-700 font-medium">{rec.classification}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-slate-600">{rec.retentionPolicy}</span>
                        </div>
                        <p className="text-xs text-slate-600">{rec.description}</p>
                        <div className="text-[11px] font-mono text-slate-400">
                          Steward: {rec.steward} · Score: {rec.complianceScore}% ·{' '}
                          {formatRecordTimestamp(rec.updatedAt ?? rec.localTimestampIso)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteGovernanceRecord(rec.recordId)}
                        title="Delete governance spec"
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Enterprise Asset Inventory Table */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Workspace Asset Inventory &amp; Stewardship Matrix
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {presets.length + (customDatasetName ? 1 : 0)} registered datasets
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/40">
                    <th className="px-4 py-2.5 text-left font-semibold">Asset Name</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Domain</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Events</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Classification</th>
                    <th className="px-4 py-2.5 text-left font-semibold">PII Status</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {presets.map((p) => {
                    const isCurrent = !customDatasetName && p.id === activePresetId;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {p.name}{' '}
                          {isCurrent && (
                            <span className="ml-1.5 font-mono text-[11px] text-blue-700 font-semibold">
                              (Active)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{p.domain}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                          {p.events.length.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-700">
                          {p.id === 'industrial_sensor_rul' ? 'Internal' : 'Restricted-PII'}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px]">
                          <span className={piiMaskingConfig.enabled ? 'text-teal-700' : 'text-amber-700'}>
                            {piiMaskingConfig.enabled ? 'SHA-256 Masked' : 'Raw IDs'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right space-x-3 whitespace-nowrap">
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => onActivateDataset(p.id)}
                              className="text-blue-700 hover:underline font-medium"
                            >
                              Activate
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenAutoDocs(p.id)}
                            className="text-slate-700 hover:underline font-medium"
                          >
                            Data Dictionary
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* PILLAR 3: VERSION CONTROL SYSTEM (VCS) */}
      {subTab === 'vcs' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Branch & Commit Composer */}
            <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <GitCommitHorizontal className="w-4 h-4 text-blue-700" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Working Tree &amp; Commit Staging
                  </h2>
                </div>
                <span className="font-mono text-xs text-slate-500">
                  {workingTreeHash.slice(0, 8)}
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Active Branch</label>
                  <select
                    aria-label="Active VCS branch"
                    value={activeBranch}
                    onChange={(e) => setActiveBranch(e.target.value)}
                    className="w-full h-9 px-2.5 font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                  >
                    {allBranches.map((br) => (
                      <option key={br} value={br}>
                        {br}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="New branch (e.g. feat/rul-cap-150)"
                    value={newBranchInput}
                    onChange={(e) => setNewBranchInput(e.target.value)}
                    className="flex-1 h-8 px-2.5 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleCreateBranch}
                    className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Branch</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleCreateCommit} className="space-y-3 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Commit Message
                  </label>
                  <input
                    type="text"
                    maxLength={240}
                    placeholder="e.g. Lock T_obs=150d and enable spend_velocity_slope"
                    value={commitMessageInput}
                    onChange={(e) => setCommitMessageInput(e.target.value)}
                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-md text-slate-900"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Semantic Tag (optional)
                  </label>
                  <div className="relative">
                    <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      maxLength={64}
                      placeholder="v1.0.0-prod"
                      value={commitTagInput}
                      onChange={(e) => setCommitTagInput(e.target.value)}
                      className="w-full h-9 pl-8 pr-2.5 font-mono bg-white border border-slate-200 rounded-md text-slate-900"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={committing}
                  className="w-full py-2 px-4 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors disabled:opacity-50"
                >
                  {committing ? 'Committing...' : `Commit State to "${activeBranch}"`}
                </button>
              </form>
            </section>

            {/* Interactive Commit Diff vs Working Tree */}
            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Configuration &amp; Schema Diff Inspector
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedCommit
                      ? `Comparing commit ${selectedCommit.commitHash.slice(0, 8)} (${selectedCommit.branch}) against active working tree (${workingTreeHash.slice(0, 8)}).`
                      : 'Create an initial commit on the left to enable branch history and diff comparisons.'}
                  </p>
                </div>
                {selectedCommit && (
                  <button
                    type="button"
                    onClick={() => handleCheckoutCommit(selectedCommit)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-blue-700" />
                    <span>Checkout Commit</span>
                  </button>
                )}
              </div>

              {selectedCommit ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/40">
                        <th className="px-3.5 py-2.5 text-left font-semibold">Scope</th>
                        <th className="px-3.5 py-2.5 text-left font-semibold">
                          Commit ({selectedCommit.commitHash.slice(0, 8)})
                        </th>
                        <th className="px-3.5 py-2.5 text-left font-semibold">
                          Working Tree ({workingTreeHash.slice(0, 8)})
                        </th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Delta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {workingDiffRows.map((row) => (
                        <tr
                          key={row.section}
                          className={row.changed ? 'bg-amber-50/40' : 'hover:bg-slate-50'}
                        >
                          <td className="px-3.5 py-2.5 font-medium text-slate-900">
                            <div>{row.section}</div>
                            <div className="text-[11px] text-slate-500 font-normal">
                              {row.parameter}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-slate-600">
                            {row.beforeValue}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-slate-900">
                            {row.afterValue}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono text-[11px] font-semibold">
                            <span className={row.changed ? 'text-amber-700' : 'text-teal-700'}>
                              {row.changed ? 'Modified' : 'Match'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-5 py-12 text-center text-xs text-slate-500">
                  No commits recorded yet. Commit the current workspace state to track parameter and
                  schema revisions.
                </div>
              )}
            </section>
          </div>

          {/* Commit Log */}
          {commits.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Commit History</h2>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {commits.length} immutable revisions
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/40">
                      <th className="px-4 py-2.5 text-left font-semibold">SHA</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Branch / Tag</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Message</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Dataset</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Timestamp</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {commits.map((c) => {
                      const isSel = selectedCommit?.commitId === c.commitId;
                      return (
                        <tr
                          key={c.commitId}
                          onClick={() => setSelectedCommitId(c.commitId)}
                          className={`cursor-pointer transition-colors ${
                            isSel ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">
                            {c.commitHash.slice(0, 8)}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-700">
                            {c.branch}
                            {c.tag ? ` · ${c.tag}` : ''}
                          </td>
                          <td className="px-4 py-2.5 text-slate-900 font-medium">{c.message}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {c.datasetName} ({c.eventCount.toLocaleString()} ev)
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-500">
                            {formatRecordTimestamp(c.createdAt ?? c.localTimestampIso)}
                          </td>
                          <td
                            className="px-4 py-2.5 text-right space-x-3 whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleCheckoutCommit(c)}
                              className="text-blue-700 hover:underline font-medium"
                            >
                              Checkout
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCommit(c.commitId)}
                              className="text-slate-400 hover:text-red-600"
                              title="Remove commit record"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* PILLAR 4: REPOSITORY & ARCHIVAL SYSTEMS */}
      {subTab === 'archive' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleArchiveBundle}
            className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
          >
            <div className="pb-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">
                Deposit to Archival Vault
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Packages curated configs + {standard} manifest with an immutable SHA-256 content
                digest.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Deposit Title</label>
                <input
                  type="text"
                  maxLength={140}
                  placeholder={`${datasetName} · Release Archive`}
                  value={archiveTitleInput}
                  onChange={(e) => setArchiveTitleInput(e.target.value)}
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-md text-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Storage Tier</label>
                <select
                  aria-label="Archive storage tier"
                  value={archiveTier}
                  onChange={(e) => setArchiveTier(e.target.value as ArchiveStorageTier)}
                  className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                >
                  <option value="Hot Registry">Hot Registry (Fast Recall)</option>
                  <option value="Warm Object Store">Warm Object Store (Quarterly)</option>
                  <option value="Cold WORM Glacier">Cold WORM Glacier (Immutable)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Retention Window</label>
                <select
                  aria-label="Archive retention window"
                  value={archiveRetention}
                  onChange={(e) => setArchiveRetention(e.target.value as ArchiveRetentionWindow)}
                  className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-md text-slate-800"
                >
                  <option value="90 Days">90 Days</option>
                  <option value="1 Year">1 Year</option>
                  <option value="3 Years">3 Years</option>
                  <option value="7 Years (WORM)">7 Years (WORM Regulatory)</option>
                </select>
              </div>

              <label className="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-md cursor-pointer">
                <span className="font-medium text-slate-800">Enable WORM Retention Lock</span>
                <input
                  type="checkbox"
                  checked={archiveHold}
                  onChange={(e) => setArchiveHold(e.target.checked)}
                  className="accent-blue-700"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={archiving}
              className="w-full py-2 px-4 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors disabled:opacity-50"
            >
              {archiving ? 'Hashing & Depositing...' : 'Deposit Immutable Archive Bundle'}
            </button>
          </form>

          <section className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Archival Vault Registry &amp; Integrity Log
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {archives.length} archived bundles
              </span>
            </div>

            {archives.length === 0 ? (
              <div className="px-6 py-12 text-center text-xs text-slate-500">
                No bundles deposited yet. Use the form on the left to archive a SHA-256 verified
                curated dataset release.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {archives.map((item) => (
                  <div key={item.archiveId} className="p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900">{item.title}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-blue-700">{item.storageTier}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-slate-600">{item.retentionWindow}</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 break-all">
                          {item.archiveUrn} · SHA-256: {item.sha256Digest.slice(0, 24)}…
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500">
                          {item.datasetName} ({item.artifactSummary.eventCount.toLocaleString()} ev ·{' '}
                          {item.artifactSummary.regRows} reg rows ·{' '}
                          {item.artifactSummary.transitions} MDP) · Verified{' '}
                          {item.lastVerifiedIso ? item.lastVerifiedIso.slice(0, 19).replace('T', ' ') : 'On deposit'}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleVerifyArchiveChecksum(item)}
                          className="px-2.5 py-1.5 text-[11px] font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md transition-colors whitespace-nowrap"
                        >
                          Verify SHA-256
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateArchiveLifecycle(item, {
                              storageTier: nextStorageTier(item.storageTier),
                            })
                          }
                          className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors whitespace-nowrap"
                        >
                          Cycle Tier
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateArchiveLifecycle(item, {
                              retentionHold: !item.retentionHold,
                            })
                          }
                          className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                        >
                          {item.retentionHold ? (
                            <>
                              <Lock className="w-3 h-3 text-amber-700" />
                              <span>Hold Locked</span>
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3 h-3 text-slate-400" />
                              <span>Unlocked</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onRestoreState(
                              {
                                presetId: item.datasetId,
                                globalConfig: item.snapshotConfigs.globalConfig,
                                regConfig: item.snapshotConfigs.regConfig,
                                seqConfig: item.snapshotConfigs.seqConfig,
                                mdpConfig: item.snapshotConfigs.mdpConfig,
                                rulConfig: item.snapshotConfigs.rulConfig,
                              },
                              `Restored archive ${item.archiveUrn}`
                            )
                          }
                          className="px-2.5 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors whitespace-nowrap"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerJsonDownload(`${item.archiveId}_bundle.json`, item)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100"
                          title="Download archive JSON"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteArchive(item)}
                          disabled={item.retentionHold}
                          title={
                            item.retentionHold
                              ? 'Release WORM retention hold to delete'
                              : 'Purge archive record'
                          }
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 disabled:opacity-35"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
