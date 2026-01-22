
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${checked ? 'bg-blue-500' : 'bg-app-border'}`}
      onClick={() => {
        console.log(`🔄 Toggle clicked: current=${checked}, new=${!checked}`)
        onChange(!checked)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  )
}

export function ThemeToggle({ theme, onChange }: { theme: 'light' | 'dark' | 'blue'; onChange: (theme: 'light' | 'dark') => void }) {
  const isDark = theme === 'dark' || theme === 'blue'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle theme"
      className="relative inline-flex h-8 w-16 items-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
      style={{
        backgroundColor: isDark ? 'var(--accent)' : '#FFB84D',
      }}
      onClick={() => onChange(isDark ? 'light' : 'dark')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChange(isDark ? 'light' : 'dark')
        }
      }}
    >
      {/* Slider */}
      <span
        className={`inline-flex h-6 w-6 transform items-center justify-center rounded-full shadow-md transition-transform duration-200 ${isDark ? 'translate-x-9' : 'translate-x-1'}`}
        style={{ backgroundColor: 'var(--card)' }}
      >
        {isDark ? (
          // Moon icon
          <svg className="h-4 w-4" style={{ color: 'var(--accent)' }} fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        ) : (
          // Sun icon
          <svg className="h-4 w-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        )}
      </span>
    </button>
  )
}


