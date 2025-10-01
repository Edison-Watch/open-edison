// Custom components that look like Fumadocs but work with Vite
function Callout({ children, type = 'info' }: { children: React.ReactNode, type?: string }) {
    const styles = {
        info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100',
        warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-900 dark:text-yellow-100',
        error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100',
    }

    return (
        <div className={`border-l-4 p-4 rounded-r-lg ${styles[type as keyof typeof styles] || styles.info}`}>
            <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                    {type === 'info' && <span className="text-blue-500">ℹ️</span>}
                    {type === 'warning' && <span className="text-yellow-500">⚠️</span>}
                    {type === 'error' && <span className="text-red-500">❌</span>}
                </div>
                <div>{children}</div>
            </div>
        </div>
    )
}

function Card({ title, children, href }: { title: string, children: React.ReactNode, href?: string }) {
    const content = (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 h-full hover:shadow-lg transition-shadow">
            <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-gray-100">{title}</h3>
            <p className="text-gray-600 dark:text-gray-400">{children}</p>
        </div>
    )

    if (href) {
        return (
            <a href={href} className="block">
                {content}
            </a>
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
        <div className="min-h-screen bg-white dark:bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            <div className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-4xl font-bold mb-6 text-center">Open Edison Documentation</h1>

                    <Callout>
                        Welcome to the Open Edison documentation! This is a comprehensive guide for the single-user MCP proxy server.
                    </Callout>

                    <Cards className="mb-8">
                        <Card title="🚀 Getting Started" href="#getting-started">
                            Learn how to set up and configure Open Edison for your projects.
                        </Card>
                        <Card title="📚 API Reference" href="#api-reference">
                            Complete API documentation for integrating with Open Edison.
                        </Card>
                        <Card title="🔧 Configuration" href="#configuration">
                            Detailed configuration options and examples.
                        </Card>
                        <Card title="🔍 Troubleshooting" href="#troubleshooting">
                            Common issues and their solutions.
                        </Card>
                    </Cards>

                    <div className="prose prose-lg max-w-none dark:prose-invert">
                        <section id="getting-started">
                            <h2 className="text-2xl font-bold mb-4">Getting Started</h2>
                            <p className="mb-4">
                                Open Edison is designed for simplicity. No database setup required - everything is configured through a single JSON file.
                            </p>

                            <h3 className="text-xl font-semibold mb-3">Quick Start</h3>
                            <ol className="list-decimal list-inside mb-4 space-y-2">
                                <li>Download or clone the Open Edison repository</li>
                                <li>Configure your <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-sm">config.json</code> file</li>
                                <li>Run <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-sm">make run</code> or <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-sm">python main.py</code></li>
                                <li>Access your dashboard at <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-sm">http://localhost:3000</code></li>
                            </ol>
                        </section>

                        <section id="configuration">
                            <h2 className="text-2xl font-bold mb-4">Configuration</h2>
                            <p className="mb-4">
                                Open Edison uses a simple JSON-based configuration system. See the{' '}
                                <a href="/core/configuration" className="text-blue-600 dark:text-blue-400 hover:underline">
                                    Configuration Guide
                                </a>{' '}
                                for detailed options.
                            </p>
                        </section>

                        <section id="api-reference">
                            <h2 className="text-2xl font-bold mb-4">API Reference</h2>
                            <p className="mb-4">
                                The REST API allows you to manage MCP servers, view logs, and monitor your proxy. See the{' '}
                                <a href="/quick-reference/api-reference" className="text-blue-600 dark:text-blue-400 hover:underline">
                                    API Reference
                                </a>{' '}
                                for complete documentation.
                            </p>
                        </section>

                        <section id="troubleshooting">
                            <h2 className="text-2xl font-bold mb-4">Troubleshooting</h2>
                            <p className="mb-4">
                                Common issues and solutions can be found in our troubleshooting guide. If you need help, check the{' '}
                                <a href="/development/contributing" className="text-blue-600 dark:text-blue-400 hover:underline">
                                    Contributing Guide
                                </a>{' '}
                                or open an issue on GitHub.
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    )
}
