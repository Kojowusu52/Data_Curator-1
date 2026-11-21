import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Send,
  Plus,
  Trash2,
  MessageSquare,
  RotateCcw,
  LogIn,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import {
  AuditCheck,
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
} from '../types/curation';

export type AssistantRole = 'curation_architect' | 'regression_analyst' | 'rl_specialist';
export type AssistantModel = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';

interface ChatMessageItem {
  messageId: string;
  sender: 'user' | 'assistant';
  text: string;
  model?: string;
}

interface ChatSessionItem {
  sessionId: string;
  ownerId: string;
  title: string;
  role: AssistantRole;
  model: AssistantModel;
}

interface GeminiChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  datasetName: string;
  datasetDomain: string;
  totalEntities: number;
  totalEvents: number;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  audits: AuditCheck[];
}

const ROLE_OPTIONS: { id: AssistantRole; label: string; description: string }[] = [
  {
    id: 'curation_architect',
    label: 'Curation Architect',
    description: 'Cohort splitting, schema parity, and leak-free window design.',
  },
  {
    id: 'regression_analyst',
    label: 'Regression Analyst',
    description: 'Pearson correlation matrix, VIF collinearity, and LTV targets.',
  },
  {
    id: 'rl_specialist',
    label: 'Sequence & RL Specialist',
    description: 'Tensor padding, CQL OOD support, and MDP reward shaping.',
  },
];

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export const GeminiChatDrawer: React.FC<GeminiChatDrawerProps> = ({
  isOpen,
  onClose,
  datasetName,
  datasetDomain,
  totalEntities,
  totalEvents,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  regResult,
  seqResult,
  mdpResult,
  audits,
}) => {
  const { user, authReady, profileSynced, signInWithGoogle, isSigningIn } = useAuth();

  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [localMessages, setLocalMessages] = useState<ChatMessageItem[]>([]);

  const [role, setRole] = useState<AssistantRole>('curation_architect');
  const [model, setModel] = useState<AssistantModel>('gemini-4-hydrogen');
  const [inputText, setInputText] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const workspaceContext = useMemo(
    () => ({
      datasetName,
      datasetDomain,
      totalEntities,
      totalEvents,
      globalConfig,
      regSummary: {
        obsCutoffDay: regConfig.obsCutoffDay,
        horizonDays: regConfig.horizonDays,
        winsorizePercentile: regConfig.winsorizePercentile,
        batchSize: regConfig.batchSize,
        batchCount: regResult.batchCount,
        materializedRows: regResult.rows.length,
        meanTargetWinsorized: regResult.meanTargetWinsorized,
        zeroTargetRate: regResult.zeroTargetRate,
        baselineR2Estimate: regResult.baselineR2Estimate,
      },
      seqSummary: {
        tensorShape: seqResult.tensorShape,
        padding: seqConfig.padding,
        truncation: seqConfig.truncation,
        normalization: seqConfig.normalization,
        batchSize: seqConfig.batchSize,
        batchCount: seqResult.batchCount,
        paddingSparsity: seqResult.paddingSparsity,
        meanActualLength: seqResult.meanActualLength,
      },
      mdpSummary: {
        gamma: mdpConfig.gamma,
        terminalInactivityGapDays: mdpConfig.terminalInactivityGapDays,
        rewardScale: mdpConfig.rewardScale,
        transitions: mdpResult.transitions.length,
        meanInitialReturn: mdpResult.meanInitialReturn,
        lowSupportOodRate: mdpResult.lowSupportOodRate,
      },
      highCollinearityPairs: regResult.featureMatrix.highCollinearityPairs,
      audits: audits.map((a) => ({
        name: a.name,
        paradigm: a.paradigm,
        status: a.status,
        metricValue: a.metricValue,
      })),
    }),
    [
      datasetName,
      datasetDomain,
      totalEntities,
      totalEvents,
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
      regResult,
      seqResult,
      mdpResult,
      audits,
    ]
  );

  // Sync user's saved chat sessions from Firestore when signed in
  useEffect(() => {
    if (!isOpen || !authReady || !user || !profileSynced) {
      setSessions([]);
      return;
    }

    const colPath = `users/${user.uid}/chatSessions`;
    const q = query(
      collection(db, 'users', user.uid, 'chatSessions'),
      where('ownerId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as ChatSessionItem);
        setSessions(list);
        if (list.length > 0 && (!activeSessionId || !list.some((s) => s.sessionId === activeSessionId))) {
          setActiveSessionId(list[0].sessionId);
          setRole(list[0].role);
          setModel(list[0].model);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, colPath);
      }
    );

    return () => unsub();
  }, [isOpen, authReady, user, profileSynced]);

  // Sync messages for the active Firestore session
  useEffect(() => {
    if (!isOpen || !user || !profileSynced || !activeSessionId) {
      setMessages([]);
      return;
    }

    const colPath = `users/${user.uid}/chatSessions/${activeSessionId}/messages`;
    const q = query(
      collection(db, 'users', user.uid, 'chatSessions', activeSessionId, 'messages'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as ChatMessageItem);
        setMessages(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, colPath);
      }
    );

    return () => unsub();
  }, [isOpen, user, profileSynced, activeSessionId]);

  const displayedMessages = user ? messages : localMessages;

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayedMessages.length, streamingText]);

  if (!isOpen) return null;

  const ensureFirestoreSession = async (firstPrompt: string): Promise<string> => {
    if (!user) throw new Error('User not signed in');
    if (activeSessionId) return activeSessionId;

    const sessionId = makeSafeId('chat');
    const title = (firstPrompt.trim().slice(0, 60) || 'Stratum Curation Thread').slice(0, 120);
    const sessionPath = `users/${user.uid}/chatSessions/${sessionId}`;

    try {
      await setDoc(doc(db, 'users', user.uid, 'chatSessions', sessionId), {
        sessionId,
        ownerId: user.uid,
        title,
        role,
        model,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setActiveSessionId(sessionId);
      return sessionId;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, sessionPath);
    }
  };

  const handleRoleChange = async (nextRole: AssistantRole) => {
    setRole(nextRole);
    if (user && profileSynced && activeSessionId) {
      const sessionPath = `users/${user.uid}/chatSessions/${activeSessionId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'chatSessions', activeSessionId), {
          role: nextRole,
          model,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, sessionPath);
      }
    }
  };

  const handleModelChange = async (nextModel: AssistantModel) => {
    setModel(nextModel);
    if (user && profileSynced && activeSessionId) {
      const sessionPath = `users/${user.uid}/chatSessions/${activeSessionId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'chatSessions', activeSessionId), {
          role,
          model: nextModel,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, sessionPath);
      }
    }
  };

  const handleNewThread = () => {
    setActiveSessionId(null);
    setMessages([]);
    setLocalMessages([]);
    setErrorMsg(null);
    setStreamingText('');
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!user) return;
    const sessionPath = `users/${user.uid}/chatSessions/${sessionId}`;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'chatSessions', sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, sessionPath);
    }
  };

  const sendMessage = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setErrorMsg(null);
    setInputText('');
    setStreamingText('');

    const historySnapshot = displayedMessages.map((m) => ({
      sender: m.sender,
      text: m.text,
    }));

    let targetSessionId: string | null = null;
    if (user && profileSynced) {
      try {
        targetSessionId = await ensureFirestoreSession(trimmed);
        const userMsgId = makeSafeId('msg');
        const msgPath = `users/${user.uid}/chatSessions/${targetSessionId}/messages/${userMsgId}`;
        try {
          await setDoc(
            doc(db, 'users', user.uid, 'chatSessions', targetSessionId, 'messages', userMsgId),
            {
              messageId: userMsgId,
              sessionId: targetSessionId,
              ownerId: user.uid,
              sender: 'user',
              text: trimmed.slice(0, 16000),
              createdAt: serverTimestamp(),
            }
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, msgPath);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to persist message.');
        setIsSending(false);
        return;
      }
    } else {
      const userItem: ChatMessageItem = {
        messageId: makeSafeId('msg'),
        sender: 'user',
        text: trimmed,
      };
      setLocalMessages((prev) => [...prev, userItem]);
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: historySnapshot,
          role,
          model,
          workspaceContext,
        }),
      });

      if (!response.ok || !response.body) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || `Server error (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          const parsed = JSON.parse(jsonStr) as {
            text?: string;
            done?: boolean;
            error?: string;
          };
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.text) {
            accumulated += parsed.text;
            setStreamingText(accumulated);
          }
        }
      }

      const finalAnswer = accumulated.trim() || 'No response generated.';
      setStreamingText('');

      if (user && profileSynced && targetSessionId) {
        const botMsgId = makeSafeId('msg');
        const botMsgPath = `users/${user.uid}/chatSessions/${targetSessionId}/messages/${botMsgId}`;
        try {
          await setDoc(
            doc(db, 'users', user.uid, 'chatSessions', targetSessionId, 'messages', botMsgId),
            {
              messageId: botMsgId,
              sessionId: targetSessionId,
              ownerId: user.uid,
              sender: 'assistant',
              text: finalAnswer.slice(0, 16000),
              model,
              createdAt: serverTimestamp(),
            }
          );
          await updateDoc(doc(db, 'users', user.uid, 'chatSessions', targetSessionId), {
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, botMsgPath);
        }
      } else {
        setLocalMessages((prev) => [
          ...prev,
          {
            messageId: makeSafeId('msg'),
            sender: 'assistant',
            text: finalAnswer,
            model,
          },
        ]);
      }
    } catch (err) {
      setStreamingText('');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reach assistant.');
    } finally {
      setIsSending(false);
    }
  };

  const starterPrompts = [
    'Analyze multicollinearity in the regression Pearson correlation matrix.',
    'Check if our T_obs cutoff or zero-inflation needs tuning.',
    'Explain how to lower the CQL low-support OOD rate.',
  ];

  const activeRoleMeta = ROLE_OPTIONS.find((r) => r.id === role) ?? ROLE_OPTIONS[0];

  return (
    <aside
      aria-label="Gemini Curation Assistant"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[440px] bg-white border-l border-slate-200 shadow-xl flex flex-col"
    >
      {/* Header */}
      <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-blue-700 shrink-0" />
          <span className="font-display text-sm font-semibold text-slate-900 truncate">
            Curation Assistant
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleNewThread}
            title="Start new thread"
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded inline-flex items-center gap-1 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant drawer"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Role & Model Configuration */}
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 space-y-2.5 shrink-0">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="chat-role-select" className="block text-[11px] font-semibold text-slate-500 mb-1">
              System Role
            </label>
            <select
              id="chat-role-select"
              value={role}
              onChange={(e) => handleRoleChange(e.target.value as AssistantRole)}
              className="w-full px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="chat-model-select" className="block text-[11px] font-semibold text-slate-500 mb-1">
              Model Tier
            </label>
            <select
              id="chat-model-select"
              value={model}
              onChange={(e) => handleModelChange(e.target.value as AssistantModel)}
              className="w-full px-2.5 py-1.5 text-xs font-mono font-medium text-slate-800 bg-white border border-slate-200 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="gemini-4-hydrogen">gemini-4-hydrogen (General)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Fast)</option>
            </select>
          </div>
        </div>
        <div className="text-[11px] text-slate-500">{activeRoleMeta.description}</div>

        {/* Saved Threads Switcher when signed in */}
        {user ? (
          sessions.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <select
                aria-label="Saved conversation threads"
                value={activeSessionId ?? ''}
                onChange={(e) => {
                  const found = sessions.find((s) => s.sessionId === e.target.value);
                  if (found) {
                    setActiveSessionId(found.sessionId);
                    setRole(found.role);
                    setModel(found.model);
                  }
                }}
                className="flex-1 px-2.5 py-1 text-[11px] bg-white border border-slate-200 rounded text-slate-700 truncate"
              >
                {!activeSessionId && <option value="">New unsaved thread...</option>}
                {sessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {s.title}
                  </option>
                ))}
              </select>
              {activeSessionId && (
                <button
                  type="button"
                  onClick={() => handleDeleteSession(activeSessionId)}
                  aria-label="Delete active thread"
                  className="p-1 text-slate-400 hover:text-red-600 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )
        ) : (
          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
            <span>Sign in to persist threads to Firestore</span>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={isSigningIn}
              className="text-blue-700 font-medium hover:underline inline-flex items-center gap-1"
            >
              <LogIn className="w-3 h-3" />
              <span>Sign in</span>
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Conversation Thread */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {displayedMessages.length === 0 && !streamingText ? (
          <div className="space-y-4 py-4">
            <div className="text-xs text-slate-600 leading-relaxed">
              Ask about <span className="font-semibold text-slate-900">{datasetName}</span> across regression multicollinearity, sequence padding, or CQL MDP transitions.
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-500">Suggested Prompts</div>
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {displayedMessages.map((msg) => (
              <div
                key={msg.messageId}
                className={`flex flex-col ${
                  msg.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="text-[10px] font-medium text-slate-400 mb-1">
                  {msg.sender === 'user' ? 'You' : msg.model || model}
                </div>
                <div
                  className={`max-w-[90%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-800'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {streamingText && (
              <div className="flex flex-col items-start">
                <div className="text-[10px] font-medium text-slate-400 mb-1">{model}</div>
                <div className="max-w-[90%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap bg-slate-50 border border-slate-200 text-slate-800">
                  {streamingText}
                </div>
              </div>
            )}

            {isSending && !streamingText && (
              <div className="text-xs text-slate-500 italic">Thinking...</div>
            )}
          </>
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="px-5 py-2.5 bg-red-50 border-t border-red-200 text-xs text-red-700 flex items-center justify-between gap-2">
          <span className="truncate">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-700 hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Message Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(inputText);
        }}
        className="p-4 border-t border-slate-200 bg-white shrink-0"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(inputText);
              }
            }}
            placeholder={`Ask ${activeRoleMeta.label}...`}
            className="flex-1 resize-none px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          />
          <button
            type="submit"
            disabled={isSending || !inputText.trim()}
            aria-label="Send message"
            className="px-3.5 py-2.5 bg-blue-700 text-white rounded-md hover:bg-blue-800 transition-colors disabled:opacity-50 inline-flex items-center justify-center shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        {!user && localMessages.length > 0 && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setLocalMessages([])}
              className="text-[11px] text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear local thread</span>
            </button>
          </div>
        )}
      </form>
    </aside>
  );
};
