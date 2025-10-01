import React from 'react'
import { Link } from 'react-router-dom'

// Custom components that look like Fumadocs but work with Vite
function Callout({ children, type = 'info' }: { children: React.ReactNode, type?: string }) {
    const borderColors = {
        info: '#7c3aed',
        warning: '#f59e0b',
        error: '#ef4444',
    }

    return (
        <div
            className="p-4 rounded-lg mb-4"
            style={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${borderColors[type as keyof typeof borderColors] || borderColors.info}`,
            }}
        >
            <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                    {type === 'info' && <span>ℹ️</span>}
                    {type === 'warning' && <span>⚠️</span>}
                    {type === 'error' && <span>❌</span>}
                </div>
                <div>{children}</div>
            </div>
        </div>
    )
}

function Card({ title, children, href }: { title: string, children: React.ReactNode, href?: string }) {
    const content = (
        <div
            className="rounded-lg p-6 h-full transition-all cursor-pointer"
            style={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 12px rgba(0, 0, 0, 0.08)',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1), 0 8px 20px rgba(0, 0, 0, 0.12)'
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 12px rgba(0, 0, 0, 0.08)'
            }}
        >
            <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--text)' }}>{title}</h3>
            <p style={{ color: 'var(--muted)' }}>{children}</p>
        </div>
    )

    if (href) {
        return (
            <Link to={href} className="block">
                {content}
            </Link>
        )
    }

    return content
}

function Cards({ children, className }: { children: React.ReactNode, className?: string }) {
    return (
        <div className={`grid gap-6 md:grid-cols-2 ${className || ''}`}>
            {children}
        </div>
    )
}

export default function HomePage() {
    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
            <div className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-4xl font-bold mb-6 text-center" style={{ color: 'var(--text)' }}>Open Edison Documentation</h1>

                    <Callout>
                        Welcome to the Open Edison documentation! This is a comprehensive guide for the single-user MCP proxy server.
                    </Callout>

                    <Cards className="mb-8">
                        <Card title="🚀 Getting Started" href="/quick-reference/config-quick-start">
                            Learn how to set up and configure Open Edison for your projects.
                        </Card>
                        <Card title="📚 API Reference" href="/quick-reference/api-reference">
                            Complete API documentation for integrating with Open Edison.
                        </Card>
                        <Card title="🔧 Configuration" href="/core/configuration">
                            Detailed configuration options and examples.
                        </Card>
                        <Card title="🏗️ Architecture" href="/architecture/single-user-design">
                            Design decisions and technical deep-dives.
                        </Card>
                    </Cards>

                    <div className="mt-8 space-y-8">
                        <section id="getting-started" className="scroll-mt-20">
                            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>Getting Started</h2>
                            <p className="mb-4" style={{ color: 'var(--text)' }}>
                                Open Edison is designed for simplicity. No database setup required - everything is configured through a single JSON file.
                            </p>

                            <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--text)' }}>Quick Start</h3>
                            <ol className="list-decimal list-inside mb-4 space-y-2" style={{ color: 'var(--text)' }}>
                                <li>Download or clone the Open Edison repository</li>
                                <li>Configure your <code style={{ backgroundColor: 'var(--card)', color: 'var(--accent)', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.875rem', border: '1px solid var(--border)' }}>config.json</code> file</li>
                                <li>Run <code style={{ backgroundColor: 'var(--card)', color: 'var(--accent)', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.875rem', border: '1px solid var(--border)' }}>make run</code> or <code style={{ backgroundColor: 'var(--card)', color: 'var(--accent)', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.875rem', border: '1px solid var(--border)' }}>python main.py</code></li>
                                <li>Access your dashboard at <code style={{ backgroundColor: 'var(--card)', color: 'var(--accent)', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.875rem', border: '1px solid var(--border)' }}>http://localhost:3000</code></li>
                            </ol>
                        </section>

                        <section id="configuration" className="scroll-mt-20">
                            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>Configuration</h2>
                            <p className="mb-4" style={{ color: 'var(--text)' }}>
                                Open Edison uses a simple JSON-based configuration system. See the{' '}
                                <Link to="/core/configuration" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                                    Configuration Guide
                                </Link>{' '}
                                for detailed options.
                            </p>
                        </section>

                        <section id="api-reference" className="scroll-mt-20">
                            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>API Reference</h2>
                            <p className="mb-4" style={{ color: 'var(--text)' }}>
                                The REST API allows you to manage MCP servers, view logs, and monitor your proxy. See the{' '}
                                <Link to="/quick-reference/api-reference" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                                    API Reference
                                </Link>{' '}
                                for complete documentation.
                            </p>
                        </section>

                        <section id="troubleshooting" className="scroll-mt-20">
                            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text)' }}>Troubleshooting</h2>
                            <p className="mb-4" style={{ color: 'var(--text)' }}>
                                Common issues and solutions can be found in our troubleshooting guide. If you need help, check the{' '}
                                <Link to="/development/contributing" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                                    Contributing Guide
                                </Link>{' '}
                                or open an issue on GitHub.
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    )
}
