import React from 'react'

export type PanelAction = { id: 'expand' | 'csv' | 'image'; label?: string; onClick?: () => void }

export type PanelProps = {
    title: string
    subtitle?: string
    unit?: string
    actions?: PanelAction[]
    heightRem?: number
    children: React.ReactNode
}

export function Panel({ title, subtitle, unit, actions, heightRem = 14, children }: PanelProps) {
    return (
        <div className="card" style={{ minHeight: `${heightRem}rem`, height: `${heightRem}rem`, minWidth: 0, overflow: 'hidden' }}>
            <div className="flex items-center justify-between mb-2">
                <div className="min-w-0">
                    <div className="text-xs text-app-muted truncate">
                        {title}{unit ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-app-border/60 align-middle">{unit}</span> : null}
                    </div>
                    {subtitle ? <div className="text-[10px] text-app-muted/80 truncate">{subtitle}</div> : null}
                </div>
                {actions && actions.length > 0 ? (
                    <div className="flex items-center gap-1">
                        {actions.map((a) => (
                            <button key={a.id} className="badge" onClick={a.onClick} title={a.label || a.id}>
                                {a.label || a.id}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
            <div className="w-full h-[calc(100%-1.75rem)]">
                {children}
            </div>
        </div>
    )
}

export default Panel


