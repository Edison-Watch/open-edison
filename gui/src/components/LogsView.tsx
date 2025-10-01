import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';

interface LogEntry {
  timestamp: string;
  message: string;
  type: string;
}

interface LogsViewProps {
  logs: LogEntry[];
  autoScrollDefault?: boolean;
}

const LEVEL_HIERARCHY: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4
};

const getLogLevel = (message: string): string => {
  const levelMatch = message.match(/(DEBUG|INFO|WARNING|ERROR|CRITICAL)/i);
  if (levelMatch) {
    return levelMatch[1].toLowerCase();
  }
  return 'info';
};

const LogsView = ({ logs, autoScrollDefault = true }: LogsViewProps) => {
  const [showStdout, setShowStdout] = useState(true);
  const [showStderr, setShowStderr] = useState(true);
  const [verboseLogs, setVerboseLogs] = useState(false);
  const [logLevel, setLogLevel] = useState<'debug' | 'info' | 'warning' | 'error'>('warning');
  const [showDate, setShowDate] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [autoScroll, setAutoScroll] = useState(autoScrollDefault);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  const shouldShowLogLevel = useCallback((message: string): boolean => {
    const messageLevel = getLogLevel(message);
    const selectedLevel = LEVEL_HIERARCHY[logLevel] ?? 1;
    const messageLevelNum = LEVEL_HIERARCHY[messageLevel] ?? 1;
    return messageLevelNum >= selectedLevel;
  }, [logLevel]);

  const processedLogs = useMemo(() => {
    return logs.reduce<{ timestamp: string; message: string }[]>((acc, log) => {
      const streamMatch = (log.type === 'stdout' && showStdout) || (log.type === 'stderr' && showStderr);
      if (!streamMatch) return acc;

      if (!shouldShowLogLevel(log.message)) return acc;

      let message = log.message;
      if (!verboseLogs && message.includes(' - ')) {
        const lastDashIndex = message.lastIndexOf(' - ');
        if (lastDashIndex !== -1) {
          message = message.substring(lastDashIndex + 3);
        }
      }

      if (showStream) {
        const streamType = log.type === 'stderr' ? 'Err' : 'Out';
        message = `[${streamType}] ${message}`;
      }

      acc.push({ timestamp: showDate ? log.timestamp : '', message });
      return acc;
    }, []);
  }, [logs, showStdout, showStderr, verboseLogs, showDate, showStream, shouldShowLogLevel]);

  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [processedLogs, autoScroll]);

  const renderedLogText = processedLogs.length === 0
    ? 'Server logs will appear here...'
    : processedLogs
        .map(entry => (entry.timestamp ? `[${entry.timestamp}] ${entry.message}` : entry.message))
        .join('\n');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--card-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>Server Logs</h2>
            <div style={{
              background: 'var(--status-badge-bg)',
              padding: '0.25rem 0.75rem',
              borderRadius: '12px',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontWeight: 500
            }}>
              {processedLogs.length} entries
            </div>
          </div>
        </div>

        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={showStdout}
                onChange={(e) => setShowStdout(e.target.checked)}
              />
              Show stdout
            </label>
            <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={showStderr}
                onChange={(e) => setShowStderr(e.target.checked)}
              />
              Show stderr
            </label>
            <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={verboseLogs}
                onChange={(e) => setVerboseLogs(e.target.checked)}
              />
              Verbose logs
            </label>
            <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={showDate}
                onChange={(e) => setShowDate(e.target.checked)}
              />
              Show date
            </label>
            <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', color: '#7f8c8d', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={showStream}
                onChange={(e) => setShowStream(e.target.checked)}
              />
              Show stream
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', color: '#7f8c8d' }}>Level:</label>
              <select
                value={logLevel}
                onChange={(e) => setLogLevel(e.target.value as typeof logLevel)}
                style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #bdc3c7',
                  fontSize: '0.875rem',
                  background: 'white'
                }}
              >
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', color: '#7f8c8d' }}>Autoscroll:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="radio"
                  name="autoscroll"
                  checked={autoScroll}
                  onChange={() => setAutoScroll(true)}
                />
                On
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', color: '#7f8c8d' }}>
                <input
                  type="radio"
                  name="autoscroll"
                  checked={!autoScroll}
                  onChange={() => setAutoScroll(false)}
                />
                Off
              </label>
            </div>
          </div>

          <div
            ref={logsContainerRef}
            style={{
              background: '#2c3e50',
              color: '#ecf0f1',
              padding: '1rem',
              borderRadius: '6px',
              fontFamily: "'Monaco', 'Menlo', monospace",
              fontSize: '0.875rem',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              flex: 1
            }}
          >
            {renderedLogText}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogsView;
