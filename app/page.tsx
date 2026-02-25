'use client';

import {useEffect, useMemo, useState} from 'react';
import type {ChangeEvent, ReactNode} from 'react';
import {BarChart3, LoaderCircle, ShieldAlert, Sparkles, WandSparkles} from 'lucide-react';

import styles from './page.module.css';
import {TrendChart} from '@/components/TrendChart';
import type {AnalysisResponse, HistoryPoint, LinguisticReport} from '@/lib/types';

const HISTORY_KEY = 'linguistic-seo-coach.history.v2';

type InputMode = 'Transcript' | 'Drive';

export default function HomePage() {
  const [mode, setMode] = useState<InputMode>('Transcript');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptSourceName, setTranscriptSourceName] = useState('transcript.txt');

  const [folderName, setFolderName] = useState('Meet Recordings');
  const [parentFolderId, setParentFolderId] = useState('');
  const [folderIdOverride, setFolderIdOverride] = useState('');

  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as HistoryPoint[];
      if (Array.isArray(parsed)) {
        setHistory(parsed.slice(0, 40));
      }
    } catch {
      window.localStorage.removeItem(HISTORY_KEY);
    }
  }, []);

  const latestScore = result?.report.leadershipClarityScore ?? history[0]?.score ?? 0;
  const averageScore = history.length
    ? Math.round(history.reduce((acc, point) => acc + point.score, 0) / history.length)
    : latestScore;

  const groupedWords = useMemo(() => {
    const groups = new Map<string, LinguisticReport['wordsToPractice']>();
    const items = result?.report.wordsToPractice || [];
    for (const item of items) {
      const key = item.category || 'Phonetic Accuracy';
      const current = groups.get(key) || [];
      current.push(item);
      groups.set(key, current);
    }
    return [...groups.entries()];
  }, [result]);

  async function onAnalyze(): Promise<void> {
    setError('');
    setLoading(true);

    try {
      const response =
        mode === 'Transcript' ? await callTranscriptAnalysis() : await callDriveAnalysis();

      setResult(response);
      prependHistory({
        analyzedAt: new Date().toISOString(),
        mode,
        sourceName: response.source.name,
        score: response.report.leadershipClarityScore,
        wordsCount: response.report.wordsToPractice.length,
        compositionCount: response.report.professionalComposition.length,
        seoCount: response.report.seoContext.length,
      });
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
    } finally {
      setLoading(false);
    }
  }

  async function callTranscriptAnalysis(): Promise<AnalysisResponse> {
    const payload = {
      transcriptText,
      sourceName: transcriptSourceName,
    };

    const response = await fetch('/api/analyze-transcript', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as AnalysisResponse & {
      error?: {message?: string; details?: string};
    };

    if (!response.ok) {
      throw new Error(data.error?.details || data.error?.message || 'Transcript analysis failed.');
    }

    return data;
  }

  async function callDriveAnalysis(): Promise<AnalysisResponse> {
    const payload = {
      folderName,
      parentFolderId,
      folderIdOverride,
    };

    const response = await fetch('/api/analyze-drive-latest', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as AnalysisResponse & {
      error?: {message?: string; details?: string};
    };

    if (!response.ok) {
      throw new Error(data.error?.details || data.error?.message || 'Drive analysis failed.');
    }

    return data;
  }

  function prependHistory(point: HistoryPoint): void {
    setHistory((previous) => {
      const next = [point, ...previous].slice(0, 40);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearHistory(): void {
    setHistory([]);
    window.localStorage.removeItem(HISTORY_KEY);
  }

  async function onTranscriptUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const content = await file.text();
    setTranscriptText(content);
    setTranscriptSourceName(file.name);
  }

  return (
    <main className="main-shell">
      <div className="ambient-orb a" />
      <div className="ambient-orb b" />

      <div className={styles.page}>
        <section className={`${styles.hero} animated-entrance`}>
          <div className={styles.heroTop}>
            <div>
              <p className={styles.kicker}>Linguistic SEO Coach</p>
              <h1 className={styles.title}>Executive fluency feedback for client-facing SEO teams.</h1>
              <p className={styles.subtitle}>
                Analyze transcripts or pull the latest Drive recording. Get a Leadership Clarity Score,
                pronunciation coaching, executive rewrites, and SEO-term clarity feedback in one pass.
              </p>
            </div>
            <div className={styles.heroMeta}>
              <MetricCard label="Latest Score" value={`${latestScore}/100`} />
              <MetricCard label="Avg Score" value={`${averageScore}/100`} />
              <MetricCard label="Sessions" value={`${history.length}`} />
            </div>
          </div>
        </section>

        <section className={styles.layout}>
          <div className={`${styles.panel} animated-entrance delay-1`}>
            <div className={styles.controlInner}>
              <h2 className={styles.panelTitle}>Input</h2>
              <p className={styles.panelText}>
                Choose transcript mode for fast review, or Drive mode to fetch the newest meeting recording.
              </p>

              <div className={styles.toggleWrap}>
                <button
                  type="button"
                  onClick={() => setMode('Transcript')}
                  className={`${styles.toggle} ${mode === 'Transcript' ? styles.toggleActive : ''}`}
                >
                  Transcript
                </button>
                <button
                  type="button"
                  onClick={() => setMode('Drive')}
                  className={`${styles.toggle} ${mode === 'Drive' ? styles.toggleActive : ''}`}
                >
                  Google Drive
                </button>
              </div>

              {mode === 'Transcript' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.label}>Transcript File (optional)</span>
                    <input
                      className={styles.fileInput}
                      type="file"
                      accept=".txt,.md,.srt,.vtt"
                      onChange={onTranscriptUpload}
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label}>Transcript Source Name</span>
                    <input
                      className={styles.input}
                      value={transcriptSourceName}
                      onChange={(event) => setTranscriptSourceName(event.target.value)}
                      placeholder="q1-client-review.txt"
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label}>Transcript Text</span>
                    <textarea
                      className={styles.textarea}
                      placeholder="Paste transcript text here..."
                      value={transcriptText}
                      onChange={(event) => setTranscriptText(event.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className={styles.field}>
                    <span className={styles.label}>Meet Recordings Folder Name</span>
                    <input
                      className={styles.input}
                      value={folderName}
                      onChange={(event) => setFolderName(event.target.value)}
                      placeholder="Meet Recordings"
                    />
                  </label>

                  <div className={styles.row2}>
                    <label className={styles.field}>
                      <span className={styles.label}>Parent Folder ID (optional)</span>
                      <input
                        className={styles.input}
                        value={parentFolderId}
                        onChange={(event) => setParentFolderId(event.target.value)}
                        placeholder="1AbC..."
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Folder ID Override (optional)</span>
                      <input
                        className={styles.input}
                        value={folderIdOverride}
                        onChange={(event) => setFolderIdOverride(event.target.value)}
                        placeholder="1XyZ..."
                      />
                    </label>
                  </div>
                </>
              )}

              <button className={styles.primaryButton} disabled={loading} onClick={onAnalyze} type="button">
                {loading ? (
                  <>
                    <LoaderCircle size={16} style={{marginRight: 8, verticalAlign: 'text-bottom'}} />
                    Analyzing...
                  </>
                ) : mode === 'Transcript' ? (
                  'Analyze Transcript'
                ) : (
                  'Analyze Latest Drive Recording'
                )}
              </button>

              {error ? (
                <div className={styles.errorBox}>
                  <ShieldAlert size={16} style={{marginRight: 6, verticalAlign: 'text-bottom'}} />
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <div className={`${styles.panel} animated-entrance delay-2`}>
            <div className={styles.resultInner}>
              <h2 className={styles.panelTitle}>Latest Analysis</h2>

              {!result ? (
                <div className={styles.emptyState}>
                  <div>
                    <WandSparkles size={28} style={{color: '#1a8a79', marginBottom: 8}} />
                    <p style={{margin: 0, fontWeight: 700}}>No analysis yet</p>
                    <p style={{margin: '0.35rem 0 0'}}>Run transcript or Drive analysis to populate this panel.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.summaryCard}>
                    <p className={styles.summaryHeading}>Source</p>
                    <p className={styles.summaryText}>
                      {result.source.name} | {formatDateTime(result.source.modifiedTime)}
                    </p>
                    <div className={styles.chipRow} style={{marginTop: 8}}>
                      <span className={styles.chip}>{result.source.mimeType}</span>
                      <span className={styles.chip}>{result.report.modelUsed}</span>
                    </div>
                  </div>

                  <div className={styles.scoreWrap}>
                    <div className={styles.scoreMeta}>
                      <span>Leadership Clarity Score</span>
                      <span>{result.report.leadershipClarityScore}/100</span>
                    </div>
                    <div className={styles.scoreTrack}>
                      <div
                        className={styles.scoreValue}
                        style={{width: `${Math.max(0, Math.min(100, result.report.leadershipClarityScore))}%`}}
                      />
                    </div>
                  </div>

                  <div className={styles.summaryCard}>
                    <p className={styles.summaryHeading}>Executive Summary</p>
                    <p className={styles.summaryText}>{result.report.executiveSummary || 'No summary available.'}</p>
                  </div>

                  <div className={styles.grid2}>
                    <ResultCard title="Words to Practice" icon={<Sparkles size={14} />}>
                      {groupedWords.length === 0 ? (
                        <div className={styles.listItem}>No words flagged.</div>
                      ) : (
                        groupedWords.map(([category, items]) => (
                          <div key={category} style={{marginBottom: 8}}>
                            <div className={styles.sectionHead}>{category}</div>
                            <ul className={styles.list}>
                              {items.map((item) => (
                                <li className={styles.listItem} key={`${category}-${item.term}-${item.risk}`}>
                                  <div className={styles.term}>{item.term}</div>
                                  <p className={styles.metaLine}>Risk: {item.risk}</p>
                                  <p className={styles.metaLine}>Tip: {item.phoneticTip}</p>
                                  <p className={styles.metaLine}>Practice: {item.practiceSentence}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))
                      )}
                    </ResultCard>

                    <ResultCard title="Professional Composition" icon={<Sparkles size={14} />}>
                      <ul className={styles.list}>
                        {result.report.professionalComposition.length === 0 ? (
                          <li className={styles.listItem}>No composition issues found.</li>
                        ) : (
                          result.report.professionalComposition.map((item, index) => (
                            <li className={styles.listItem} key={`${item.executiveRewrite}-${index}`}>
                              <div className={styles.term}>{item.executiveRewrite || 'Rewrite suggestion'}</div>
                              <p className={styles.metaLine}>Issue: {item.originalIssue}</p>
                              <p className={styles.metaLine}>Why: {item.reason}</p>
                            </li>
                          ))
                        )}
                      </ul>
                    </ResultCard>
                  </div>

                  <div className={styles.grid2}>
                    <ResultCard title="SEO Context Clarity" icon={<BarChart3 size={14} />}>
                      <ul className={styles.list}>
                        {result.report.seoContext.length === 0 ? (
                          <li className={styles.listItem}>No SEO context findings.</li>
                        ) : (
                          result.report.seoContext.map((item) => (
                            <li className={styles.listItem} key={`${item.term}-${item.clarityScore}`}>
                              <div className={styles.term}>
                                {item.term} | Clarity {item.clarityScore}/5
                              </div>
                              <p className={styles.metaLine}>Feedback: {item.feedback}</p>
                              <p className={styles.metaLine}>Client version: {item.clientFriendlyVersion}</p>
                            </li>
                          ))
                        )}
                      </ul>
                    </ResultCard>

                    <ResultCard title="Next Actions" icon={<WandSparkles size={14} />}>
                      <ul className={styles.list}>
                        {result.report.nextActions.length === 0 ? (
                          <li className={styles.listItem}>No next actions returned.</li>
                        ) : (
                          result.report.nextActions.map((action, index) => (
                            <li className={styles.listItem} key={`${action}-${index}`}>
                              <div className={styles.term}>{action}</div>
                            </li>
                          ))
                        )}
                      </ul>
                    </ResultCard>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section className={`${styles.historyPanel} animated-entrance delay-3`}>
          <div className={styles.historyHeader}>
            <div>
              <h2 className={styles.panelTitle}>Trend</h2>
              <p className={styles.panelText}>Stored locally in your browser for quick coaching progress tracking.</p>
            </div>
            <button type="button" className={styles.smallButton} onClick={clearHistory}>
              Clear History
            </button>
          </div>

          {history.length ? (
            <>
              <TrendChart points={[...history].reverse()} />

              <div className={styles.historyTable}>
                <div className={styles.tableHead}>
                  <span>Date</span>
                  <span>Source</span>
                  <span>Score</span>
                  <span className={styles.hideMobile}>Words</span>
                  <span className={styles.hideMobile}>SEO</span>
                </div>
                {history.slice(0, 10).map((item) => (
                  <div className={styles.tableRow} key={`${item.analyzedAt}-${item.sourceName}`}>
                    <span>{formatDateTime(item.analyzedAt, true)}</span>
                    <span className={styles.sourceName} title={item.sourceName}>
                      {item.mode}: {item.sourceName}
                    </span>
                    <span>{item.score}</span>
                    <span className={styles.hideMobile}>{item.wordsCount}</span>
                    <span className={styles.hideMobile}>{item.seoCount}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <div>
                <BarChart3 size={28} style={{color: '#1a8a79', marginBottom: 8}} />
                <p style={{margin: 0, fontWeight: 700}}>No history yet</p>
                <p style={{margin: '0.35rem 0 0'}}>Run your first analysis to see improvement trends.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricCard({label, value}: {label: string; value: string}) {
  return (
    <div className={styles.metricCard}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
    </div>
  );
}

function ResultCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.sectionCard}>
      <div className={styles.sectionHead}>
        <span style={{display: 'inline-flex', gap: 6, alignItems: 'center'}}>
          {icon}
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

function formatDateTime(input: string, short = false): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  return date.toLocaleString(undefined, {
    month: short ? 'short' : 'long',
    day: 'numeric',
    year: short ? undefined : 'numeric',
    hour: short ? undefined : '2-digit',
    minute: short ? undefined : '2-digit',
  });
}
