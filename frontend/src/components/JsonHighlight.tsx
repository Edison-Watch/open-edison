import { useEffect, useMemo, useRef } from 'react'
import hljs from 'highlight.js/lib/core'
import jsonLang from 'highlight.js/lib/languages/json'
// Load hljs styles; background will be overridden inline for theme compatibility
import 'highlight.js/styles/github.css'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('json', jsonLang)

export default function JsonHighlight({ json }: { json: string }) {
  const codeRef = useRef<HTMLElement | null>(null)
  const safe = useMemo(() => {
    try {
      // Ensure valid JSON string; if not valid, just show raw text
      const maybe = typeof json === 'string' ? json : JSON.stringify(json)
      return maybe
    } catch {
      return String(json)
    }
  }, [json])

  useEffect(() => {
    const el = codeRef.current
    if (!el) return
    try { hljs.highlightElement(el) } catch { /* ignore */ }
  }, [safe])

  return (
    <pre className="m-0 p-0 text-xs" style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <code ref={codeRef} className="language-json whitespace-pre-wrap break-all block max-w-full" style={{ background: 'transparent', color: 'inherit' }}>{safe}</code>
    </pre>
  )
}


