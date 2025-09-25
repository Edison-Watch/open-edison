import React from 'react'

export function Modal({ title, onClose, actions, children }: { title?: string; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white dark:bg-[#0b0f19] border border-app-border rounded-lg shadow-xl w-[min(96vw,900px)] h-[min(90vh,650px)] p-3 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold truncate">{title || 'Expand'}</div>
                    <div className="flex items-center gap-2">
                        {actions}
                        <button className="badge" onClick={onClose}>Close</button>
                    </div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                    {children}
                </div>
            </div>
        </div>
    )
}

export default Modal


