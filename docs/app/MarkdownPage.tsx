import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate } from 'react-router-dom'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface MarkdownPageProps {
    path: string
}

// Map of all markdown files using Vite's glob import
// @ts-ignore - Vite's import.meta.glob is not in the standard TypeScript types
const markdownModules: Record<string, () => Promise<string>> = import.meta.glob([
    '../**/*.md',
    '../**/*.mdx'
], { as: 'raw', eager: false })

export default function MarkdownPage({ path }: MarkdownPageProps) {
    const [content, setContent] = useState<string>('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const navigate = useNavigate()

    useEffect(() => {
        setLoading(true)
        setError(null)

        async function loadMarkdown() {
            // Split path into directory and filename
            const pathParts = path.split('/')
            const fileName = pathParts[pathParts.length - 1]
            const dirPath = pathParts.slice(0, -1).join('/')

            // Convert only the filename part to use underscores
            const fileNameWithUnderscores = fileName.replace(/-/g, '_')
            const pathWithFileUnderscores = dirPath ? `${dirPath}/${fileNameWithUnderscores}` : fileNameWithUnderscores

            // Try different path variations
            const possiblePaths = [
                `..${path}.md`,
                `..${path}.mdx`,
                `..${pathWithFileUnderscores}.md`,
                `..${pathWithFileUnderscores}.mdx`,
                `..${path}/index.md`,
                `..${path}/index.mdx`,
            ]

            for (const tryPath of possiblePaths) {
                const moduleKey = Object.keys(markdownModules).find(key =>
                    key === tryPath || key.endsWith(tryPath.replace('..', ''))
                )

                if (moduleKey) {
                    try {
                        const module = await markdownModules[moduleKey]()
                        let text = module as string

                        // Remove frontmatter if present
                        text = text.replace(/^---\n[\s\S]*?\n---\n/, '')

                        // Remove import statements that won't work in browser
                        text = text.replace(/^import .* from .*$/gm, '')

                        // Convert JSX-style Callout components to markdown blockquotes
                        text = text.replace(/<Callout type="info">\s*([\s\S]*?)\s*<\/Callout>/g, (_, content) => {
                            return `> ℹ️ **Info**\n> \n> ${content.trim().replace(/\n/g, '\n> ')}\n`
                        })
                        text = text.replace(/<Callout type="warning">\s*([\s\S]*?)\s*<\/Callout>/g, (_, content) => {
                            return `> ⚠️ **Warning**\n> \n> ${content.trim().replace(/\n/g, '\n> ')}\n`
                        })
                        text = text.replace(/<Callout type="error">\s*([\s\S]*?)\s*<\/Callout>/g, (_, content) => {
                            return `> ❌ **Error**\n> \n> ${content.trim().replace(/\n/g, '\n> ')}\n`
                        })
                        text = text.replace(/<Callout>\s*([\s\S]*?)\s*<\/Callout>/g, (_, content) => {
                            return `> ${content.trim().replace(/\n/g, '\n> ')}\n`
                        })

                        // Remove Card/Cards components - they're just containers
                        text = text.replace(/<Cards[^>]*>/g, '')
                        text = text.replace(/<\/Cards>/g, '')
                        text = text.replace(/<Card[^>]*>[\s\S]*?<\/Card>/g, '')

                        setContent(text)
                        setLoading(false)
                        return
                    } catch (err) {
                        console.error(`Failed to load ${moduleKey}:`, err)
                    }
                }
            }

            setError(`Documentation page not found: ${path}`)
            setLoading(false)
        }

        loadMarkdown()
    }, [path])

    if (loading) {
        return (
            <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
                <div className="container mx-auto px-4 py-8">
                    <div className="max-w-4xl mx-auto">
                        <button
                            onClick={() => navigate('/')}
                            className="hover:underline mb-4 inline-block"
                            style={{ color: 'var(--accent)' }}
                        >
                            ← Back to Home
                        </button>
                        <p>Loading documentation...</p>
                    </div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
                <div className="container mx-auto px-4 py-8">
                    <div className="max-w-4xl mx-auto">
                        <button
                            onClick={() => navigate('/')}
                            className="hover:underline mb-4 inline-block"
                            style={{ color: 'var(--accent)' }}
                        >
                            ← Back to Home
                        </button>
                        <div
                            className="rounded-lg p-6 mb-6"
                            style={{
                                backgroundColor: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderLeft: '4px solid var(--danger)'
                            }}
                        >
                            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--danger)' }}>Page Not Found</h1>
                            <p style={{ color: 'var(--text)' }}>{error}</p>
                        </div>
                        <div className="prose dark:prose-invert max-w-none">
                            <h2>Available Documentation</h2>
                            <ul>
                                <li><a href="/core/configuration">Configuration Guide</a></li>
                                <li><a href="/core/project-structure">Project Structure</a></li>
                                <li><a href="/core/proxy-usage">MCP Proxy Usage</a></li>
                                <li><a href="/quick-reference/api-reference">API Reference</a></li>
                                <li><a href="/quick-reference/config-quick-start">Config Quick Start</a></li>
                                <li><a href="/development/development-guide">Development Guide</a></li>
                                <li><a href="/development/contributing">Contributing</a></li>
                                <li><a href="/development/testing">Testing</a></li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
            <div className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                    <button
                        onClick={() => navigate('/')}
                        className="hover:underline mb-6 inline-block"
                        style={{ color: 'var(--accent)' }}
                    >
                        ← Back to Home
                    </button>
                    <div className="prose dark:prose-invert max-w-none">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                // Handle code blocks with syntax highlighting
                                code({ node, className, children, ...props }: any) {
                                    const match = /language-(\w+)/.exec(className || '')
                                    const codeString = String(children).replace(/\n$/, '')
                                    const isInline = !className

                                    return !isInline && match ? (
                                        <SyntaxHighlighter
                                            style={vscDarkPlus as any}
                                            language={match[1]}
                                            PreTag="div"
                                        >
                                            {codeString}
                                        </SyntaxHighlighter>
                                    ) : (
                                        <code className={className} {...props}>
                                            {children}
                                        </code>
                                    )
                                },
                                // Handle internal links - convert to React Router links
                                a: ({ node, href, children, ...props }) => {
                                    // Check if it's an internal link
                                    if (href && (href.startsWith('/') || href.startsWith('../'))) {
                                        // Convert relative paths to absolute
                                        let to = href
                                        if (href.startsWith('../')) {
                                            to = href.replace(/\.\.\//g, '/')
                                        }
                                        // Remove .md or .mdx extensions
                                        to = to.replace(/\.(md|mdx)$/, '')

                                        return (
                                            <a
                                                href={to}
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    navigate(to)
                                                }}
                                                className="hover:underline cursor-pointer"
                                                style={{ color: 'var(--accent)' }}
                                            >
                                                {children}
                                            </a>
                                        )
                                    }
                                    // External links
                                    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }} {...props}>{children}</a>
                                },
                            }}
                        >
                            {content}
                        </ReactMarkdown>
                    </div>
                </div>
            </div>
        </div>
    )
}
