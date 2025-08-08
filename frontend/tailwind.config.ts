import type { Config } from 'tailwindcss'

export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                'app-bg': 'var(--bg)',
                'app-card': 'var(--card)',
                'app-border': 'var(--border)',
                'app-text': 'var(--text)',
                'app-muted': 'var(--muted)',
                'app-accent': 'var(--accent)'
            },
        },
    },
    plugins: [require('@tailwindcss/typography')],
} satisfies Config


