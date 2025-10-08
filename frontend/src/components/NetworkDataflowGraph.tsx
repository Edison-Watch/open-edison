import React, { useMemo, useState, useRef, useEffect } from 'react'
import type { FlowData } from '../hooks'

type NodeType = 'source' | 'firewall' | 'provider' | 'external'

type NodeDatum = {
    id: string
    label: string
    type: NodeType
    x: number
    y: number
    width?: number
    height?: number
    health: 'healthy' | 'warning' | 'critical'
    meta: Record<string, string | number>
    flows?: FlowData[]
}

type EdgeDatum = {
    id: string
    from: string
    to: string
    volumePerHour: number
    bytesPerHour: number
    protocol: string
    isAIProvider: boolean
    providerId?: string
    flows: FlowData[]
}

const PROTOCOL_COLORS: Record<string, string> = {
    'HTTPS': '#22c55e',
    'HTTP': '#3b82f6',
    'DNS': '#8b5cf6',
    'TCP': '#6b7280',
    'UDP': '#6b7280',
}

function nodeFill(n: NodeDatum): string {
    if (n.type === 'firewall') return '#2b1b3d'  // Dark purple for firewall
    if (n.health === 'critical') return '#3a0d0d'
    if (n.health === 'warning') return '#382e0b'
    return 'var(--card)'  // Use CSS variable for subtle background
}

function volumeToWidth(volumePerHour: number): number {
    // Map volume (0..1000+) to stroke width (1..8)
    const v = Math.min(1000, Math.max(0, volumePerHour))
    return 1 + (v / 1000) * 7
}

function formatRatePerHour(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k/h`
    return `${n}/h`
}

function formatBytesPerHour(bytes: number): string {
    if (bytes === 0) return '0 B/h'
    const k = 1024
    const sizes = ['B/h', 'KB/h', 'MB/h', 'GB/h']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function getNodeSize(n: NodeDatum): { w: number; h: number } {
    const base = { w: 100, h: 40 }
    if (n.type === 'firewall') return { w: 120, h: 50 }
    return { w: n.width || base.w, h: n.height || base.h }
}

function buildNetworkGraph(flows: FlowData[], cardWidth: number, cardHeight: number, showAIOnly: boolean = false): { nodes: NodeDatum[]; edges: EdgeDatum[] } {
    // Base dimensions match actual card dimensions
    const BASE_W = cardWidth
    const BASE_H = cardHeight

    // Filter flows based on criteria
    const filteredFlows = flows.filter(flow => {
        // Filter for AI-only mode
        if (showAIOnly && flow.is_ai_provider !== 1) {
            return false
        }

        // Filter out localhost nodes (IPv4 and IPv6)
        const isLocalhostSrc = flow.src_ip === '127.0.0.1' || flow.src_ip === '::1' || flow.src_ip.startsWith('127.') || flow.src_ip.startsWith('::1')
        const isLocalhostDst = flow.dst_ip === '127.0.0.1' || flow.dst_ip === '::1' || flow.dst_ip.startsWith('127.') || flow.dst_ip.startsWith('::1')

        if (isLocalhostSrc || isLocalhostDst) {
            return false
        }

        return true
    })

    // Group flows by source and destination
    const sourceGroups = new Map<string, FlowData[]>()
    const providerGroups = new Map<string, FlowData[]>()
    const externalGroups = new Map<string, FlowData[]>()

    filteredFlows.forEach(flow => {
        const srcKey = flow.src_ip
        const dstKey = flow.dst_ip

        // Group by source IP (collect all ports)
        if (!sourceGroups.has(srcKey)) {
            sourceGroups.set(srcKey, [])
        }
        sourceGroups.get(srcKey)!.push(flow)

        // Group by destination (AI providers or external)
        if (flow.is_ai_provider === 1 && flow.provider_id) {
            if (!providerGroups.has(flow.provider_id)) {
                providerGroups.set(flow.provider_id, [])
            }
            providerGroups.get(flow.provider_id)!.push(flow)
        } else if (flow.is_ai_provider === 0) {
            if (!externalGroups.has(dstKey)) {
                externalGroups.set(dstKey, [])
            }
            externalGroups.get(dstKey)!.push(flow)
        }
    })

    const nodes: NodeDatum[] = []
    const edges: EdgeDatum[] = []

    // Add Edison Firewall (central node) - STATIC POSITION
    const firewallNode: NodeDatum = {
        id: 'firewall',
        label: 'Edison Firewall',
        type: 'firewall',
        x: BASE_W / 2 - 60, // Account for node width (120px) to truly center
        y: BASE_H / 2 - 25, // Account for node height (50px) to truly center
        health: 'healthy',
        meta: { flows: flows.length, aiFlows: flows.filter(f => f.is_ai_provider === 1).length },
        flows: flows
    }

    // Debug firewall positioning
    // console.log('Firewall debug:', {
    //     BASE_W, BASE_H,
    //     firewallX: firewallNode.x,
    //     firewallY: firewallNode.y,
    //     centerX: BASE_W / 2,
    //     centerY: BASE_H / 2,
    //     nodeWidth: 120,
    //     nodeHeight: 50,
    //     expectedCenterX: BASE_W / 2 - 60,
    //     expectedCenterY: BASE_H / 2 - 25,
    //     cardDimensions: { width: cardWidth, height: cardHeight }
    // })

    nodes.push(firewallNode)

    // Add source nodes (left side) - SYMMETRIC GRID LAYOUT
    const sourceEntries = Array.from(sourceGroups.entries())
    const colsPerRow = 3
    const nodeSpacing = Math.min(80, BASE_W * 0.1) // Reduced spacing, more spring-like
    const centerX = BASE_W / 2
    const leftStartX = centerX - (BASE_W * 0.25) // Closer to center for tighter layout
    const leftStartY = BASE_H * 0.15 // More margin from top

    // Debug node sizing and layout calculations
    // console.log('Node sizing debug:', {
    //     firewallSize: getNodeSize(firewallNode),
    //     sourceSize: sourceEntries.length > 0 ? getNodeSize({ type: 'source' } as NodeDatum) : null
    // })

    // console.log('Layout debug:', {
    //     nodeSpacing,
    //     leftStartX,
    //     leftStartY,
    //     rightStartX: centerX + (BASE_W * 0.25),
    //     rightStartY: BASE_H * 0.15,
    //     centerX,
    //     leftTargetZone: centerX - (BASE_W * 0.25),
    //     rightTargetZone: centerX + (BASE_W * 0.25)
    // })

    sourceEntries.forEach(([srcKey, sourceFlows], index) => {
        const row = Math.floor(index / colsPerRow)
        const col = index % colsPerRow
        const x = leftStartX + col * nodeSpacing
        const y = leftStartY + row * nodeSpacing

        const totalBytes = sourceFlows.reduce((acc, f) => acc + f.bidirectional_bytes, 0)
        const totalFlows = sourceFlows.length
        const aiFlows = sourceFlows.filter(f => f.is_ai_provider === 1).length

        // Collect unique source ports
        const sourcePorts = new Set(sourceFlows.map(f => f.src_port))
        const portCount = sourcePorts.size
        const portList = Array.from(sourcePorts).sort((a, b) => a - b)

        const sourceNode: NodeDatum = {
            id: `source-${srcKey}`,
            label: srcKey,
            type: 'source',
            x,
            y,
            health: aiFlows > 0 ? 'warning' : 'healthy',
            meta: {
                flows: totalFlows,
                bytes: totalBytes,
                aiFlows,
                ports: portCount,
                portList: portList.slice(0, 5).join(', ') + (portList.length > 5 ? ` +${portList.length - 5}` : '')
            },
            flows: sourceFlows
        }
        nodes.push(sourceNode)

        // Add edge from source to firewall
        const volumePerHour = totalFlows * 10
        const bytesPerHour = totalBytes * 10

        edges.push({
            id: `edge-${srcKey}-firewall`,
            from: `source-${srcKey}`,
            to: 'firewall',
            volumePerHour,
            bytesPerHour,
            protocol: 'MIXED',
            isAIProvider: false,
            flows: sourceFlows
        })
    })

    // Add AI provider nodes (right side) - SYMMETRIC GRID LAYOUT
    const providerEntries = Array.from(providerGroups.entries())
    const rightStartX = centerX + (BASE_W * 0.25) // Closer to center for tighter layout
    const rightStartY = BASE_H * 0.15 // More margin from top

    // Debug provider sizing
    // console.log('Provider sizing debug:', {
    //     providerSize: providerEntries.length > 0 ? getNodeSize({ type: 'provider' } as NodeDatum) : null,
    //     providerCount: providerEntries.length
    // })

    providerEntries.forEach(([providerId, providerFlows], index) => {
        const row = Math.floor(index / colsPerRow)
        const col = index % colsPerRow
        const x = rightStartX + col * nodeSpacing
        const y = rightStartY + row * nodeSpacing

        const totalBytes = providerFlows.reduce((acc, f) => acc + f.bidirectional_bytes, 0)
        const totalFlows = providerFlows.length
        const apiRequests = providerFlows.filter(f => f.is_api_request === 1).length

        // Collect unique destination ports
        const destPorts = new Set(providerFlows.map(f => f.dst_port))
        const portCount = destPorts.size
        const portList = Array.from(destPorts).sort((a, b) => a - b)

        const providerNode: NodeDatum = {
            id: `provider-${providerId}`,
            label: providerId.toUpperCase(),
            type: 'provider',
            x,
            y,
            health: 'healthy',
            meta: {
                flows: totalFlows,
                bytes: totalBytes,
                apiRequests,
                ports: portCount,
                portList: portList.slice(0, 5).join(', ') + (portList.length > 5 ? ` +${portList.length - 5}` : '')
            },
            flows: providerFlows
        }
        nodes.push(providerNode)

        // Add edge from firewall to provider
        const volumePerHour = totalFlows * 10
        const bytesPerHour = totalBytes * 10

        edges.push({
            id: `edge-firewall-${providerId}`,
            from: 'firewall',
            to: `provider-${providerId}`,
            volumePerHour,
            bytesPerHour,
            protocol: 'HTTPS',
            isAIProvider: true,
            providerId,
            flows: providerFlows
        })
    })

    // Add external service nodes (right side, below providers) - STATIC GRID LAYOUT
    const externalEntries = Array.from(externalGroups.entries())
    const externalStartY = rightStartY + Math.ceil(providerEntries.length / colsPerRow) * nodeSpacing + BASE_H * 0.05

    externalEntries.forEach(([dstKey, externalFlows], index) => {
        const row = Math.floor(index / colsPerRow)
        const col = index % colsPerRow
        const x = rightStartX + col * nodeSpacing
        const y = externalStartY + row * nodeSpacing

        const totalBytes = externalFlows.reduce((acc, f) => acc + f.bidirectional_bytes, 0)
        const totalFlows = externalFlows.length

        // Collect unique destination ports
        const destPorts = new Set(externalFlows.map(f => f.dst_port))
        const portCount = destPorts.size
        const portList = Array.from(destPorts).sort((a, b) => a - b)

        const externalNode: NodeDatum = {
            id: `external-${dstKey}`,
            label: dstKey,
            type: 'external',
            x,
            y,
            health: 'healthy',
            meta: {
                flows: totalFlows,
                bytes: totalBytes,
                ports: portCount,
                portList: portList.slice(0, 5).join(', ') + (portList.length > 5 ? ` +${portList.length - 5}` : '')
            },
            flows: externalFlows
        }
        nodes.push(externalNode)

        // Add edge from firewall to external
        const volumePerHour = totalFlows * 10
        const bytesPerHour = totalBytes * 10

        edges.push({
            id: `edge-firewall-${dstKey}`,
            from: 'firewall',
            to: `external-${dstKey}`,
            volumePerHour,
            bytesPerHour,
            protocol: externalFlows[0]?.protocol || 'TCP',
            isAIProvider: false,
            flows: externalFlows
        })
    })

    return { nodes, edges }
}

function Rounded({ x, y, w, h, fill, stroke }: { x: number; y: number; w: number; h: number; fill: string; stroke: string }) {
    return <rect x={x} y={y} width={w} height={h} rx={12} ry={12} fill={fill} stroke={stroke} />
}

function Hexagon({ x, y, w, h, fill, stroke }: { x: number; y: number; w: number; h: number; fill: string; stroke: string }) {
    const cx = x + w / 2
    const cy = y + h / 2
    const dx = w / 2
    const points = [
        [cx - dx * 0.6, y],
        [cx + dx * 0.6, y],
        [x + w, cy],
        [cx + dx * 0.6, y + h],
        [cx - dx * 0.6, y + h],
        [x, cy],
    ]
        .map((p) => p.join(','))
        .join(' ')
    return <polygon points={points} fill={fill} stroke={stroke} />
}

export function NetworkDataflowGraph({ flows, onSelectedFlowsChange }: { flows: FlowData[]; onSelectedFlowsChange?: (flowIds: Set<string>) => void }): React.JSX.Element {
    const [hoverNode, setHoverNode] = useState<string | null>(null)
    const [hoverEdge, setHoverEdge] = useState<string | null>(null)
    const [selectedNode, setSelectedNode] = useState<string | null>(null)
    const [showAIOnly, setShowAIOnly] = useState(true) // Default to AI-only mode
    const [running, setRunning] = useState(true)
    const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const BASE_W = 1000
    const BASE_H = 600
    const [dims, setDims] = useState<{ w: number; h: number }>({ w: BASE_W, h: BASE_H })

    const { nodes, edges } = useMemo(() => buildNetworkGraph(flows, dims.w, dims.h, showAIOnly), [flows, dims.w, dims.h, showAIOnly])

    // Call callback when selectedNode changes
    useEffect(() => {
        if (onSelectedFlowsChange && selectedNode) {
            const selectedNodeObj = nodes.find(node => node.id === selectedNode)
            if (selectedNodeObj && selectedNodeObj.flows) {
                const flowIds = new Set(selectedNodeObj.flows.map(flow =>
                    `${flow.src_ip}:${flow.src_port}-${flow.dst_ip}:${flow.dst_port}-${flow.timestamp}`
                ))
                onSelectedFlowsChange(flowIds)
            }
        } else if (onSelectedFlowsChange && !selectedNode) {
            // Clear selection
            onSelectedFlowsChange(new Set())
        }
    }, [selectedNode, nodes, onSelectedFlowsChange])

    type SimNode = { id: string; x: number; y: number; vx: number; vy: number; mass: number; isFixed?: boolean }
    const simRef = useRef<Map<string, SimNode> | null>(null)
    const svgBoundsRef = useRef<{ w: number; h: number }>({ w: BASE_W, h: BASE_H })
    const [, forceUpdate] = useState({})

    // Resize handling
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const ro = new (window as any).ResizeObserver((entries: any[]) => {
            for (const entry of entries) {
                const rect = entry.contentRect as DOMRectReadOnly
                const w = Math.max(800, Math.round(rect.width))
                const targetRatio = BASE_H / BASE_W
                const maxH = Math.max(400, Math.round(window.innerHeight * 0.6))
                const h = Math.max(400, Math.min(maxH, Math.round(w * targetRatio)))
                setDims({ w, h })
            }
        })
        ro.observe(el)
        const rect = el.getBoundingClientRect()
        const w = Math.max(800, Math.round(rect.width))
        const targetRatio = BASE_H / BASE_W
        const maxH = Math.max(400, Math.round(window.innerHeight * 0.6))
        const h = Math.max(400, Math.min(maxH, Math.round(w * targetRatio)))
        setDims({ w, h })
        return () => ro.disconnect()
    }, [])

    // Initialize simulation nodes from static nodes
    useEffect(() => {
        const m = new Map<string, SimNode>()
        const scaleX = Math.max(0.001, dims.w / BASE_W)
        const scaleY = Math.max(0.001, dims.h / BASE_H)

        // Only initialize if simulation doesn't exist or nodes have changed
        const existingSim = simRef.current
        const existingNodeIds = existingSim ? Array.from(existingSim.keys()) : []
        const newNodeIds = nodes.map(n => n.id)

        // Check if we need to reinitialize
        const needsReinit = !existingSim ||
            existingNodeIds.length !== newNodeIds.length ||
            !existingNodeIds.every(id => newNodeIds.includes(id)) ||
            // Also reinitialize if firewall position changed
            (existingSim && existingSim.has('firewall') && nodes.find(n => n.id === 'firewall') &&
                (existingSim.get('firewall')!.x !== nodes.find(n => n.id === 'firewall')!.x ||
                    existingSim.get('firewall')!.y !== nodes.find(n => n.id === 'firewall')!.y))

        if (needsReinit) {
            for (const n of nodes) {
                const { w, h } = getNodeSize(n)
                const isFixed = n.type === 'firewall' // Only firewall is fixed

                if (isFixed) {
                    // Fixed nodes use exact original position without scaling or jitter
                    m.set(n.id, {
                        id: n.id,
                        x: n.x,
                        y: n.y,
                        vx: 0,
                        vy: 0,
                        mass: Math.max(1, (w * h) / 3000),
                        isFixed
                    })
                } else {
                    // Non-fixed nodes get scaling and jitter
                    const jitterX = (Math.random() - 0.5) * 10
                    const jitterY = (Math.random() - 0.5) * 10
                    m.set(n.id, {
                        id: n.id,
                        x: n.x * scaleX + jitterX,
                        y: n.y * scaleY + jitterY,
                        vx: 0,
                        vy: 0,
                        mass: Math.max(1, (w * h) / 3000),
                        isFixed
                    })
                }
            }
            simRef.current = m
        }
    }, [nodes.length, dims.w, dims.h]) // Depend on node count and dimensions

    // Simple force-directed layout (springs + repulsion + centering) - LIKE DATAFLOWGRAPH
    useEffect(() => {
        let raf = 0
        let last = performance.now()
        const run = () => {
            raf = requestAnimationFrame(run)
            if (!running) return
            const now = performance.now()
            const dtMs = Math.min(16, now - last) // Slower timescale (60fps instead of 30fps)
            last = now
            const dt = (dtMs / 1000) * 0.5 // Slower timescale multiplier
            const sim = simRef.current
            if (!sim) return

            // Physics params - Gentler and smoother like DataflowGraph
            const kRepelN = 600 // Increased repulsion to prevent overlap
            const kSpring = 0.65 // Bendy springs - moderate spring constant
            const springRestBase = 60 // Even shorter rest length for tighter clustering
            const damping = 0.75 // Lower damping for molasses-like sluggish movement
            const centerPull = 0.08 // Much gentler centering force
            const { w: viewW, h: viewH } = svgBoundsRef.current
            const cx = viewW / 2
            const cy = viewH / 2
            const scaleX = Math.max(0.001, viewW / BASE_W)
            const scaleY = Math.max(0.001, viewH / BASE_H)

            // Accumulate forces
            // Start with repulsion between all node pairs (O(n^2) ok for small n)
            const nodesArr = Array.from(sim.values())
            for (let i = 0; i < nodesArr.length; i++) {
                const a = nodesArr[i]!
                if (a.isFixed) continue // Skip physics for fixed nodes (firewall)
                let fxAccumN = 0
                let fyAccumN = 0
                for (let j = 0; j < nodesArr.length; j++) {
                    if (i === j) continue
                    const b = nodesArr[j]!
                    // Work in normalized space to account for aspect ratio
                    const axN = a.x / scaleX
                    const ayN = a.y / scaleY
                    const bxN = b.x / scaleX
                    const byN = b.y / scaleY
                    const dxN = axN - bxN
                    const dyN = ayN - byN
                    const distSqN = Math.max(64, dxN * dxN + dyN * dyN)
                    const invDistN = 1 / Math.sqrt(distSqN)
                    const forceN = (kRepelN * kRepelN) / distSqN
                    fxAccumN += forceN * dxN * invDistN
                    fyAccumN += forceN * dyN * invDistN
                }
                // Centering force
                fxAccumN += ((cx - a.x) / scaleX) * centerPull
                fyAccumN += ((cy - a.y) / scaleY) * centerPull
                // Convert normalized force to actual coordinate space
                const fx = fxAccumN * scaleX
                const fy = fyAccumN * scaleY
                // Apply to velocity (semi-implicit Euler)
                a.vx = (a.vx + (fx / a.mass) * dt) * damping
                a.vy = (a.vy + (fy / a.mass) * dt) * damping
            }

            // Spring forces along edges
            for (const e of edges) {
                const from = sim.get(e.from)
                const to = sim.get(e.to)
                if (!from || !to) continue
                // Compute spring in normalized space
                const fxN0 = from.x / scaleX
                const fyN0 = from.y / scaleY
                const txN0 = to.x / scaleX
                const tyN0 = to.y / scaleY
                const dxN = txN0 - fxN0
                const dyN = tyN0 - fyN0
                const distN = Math.max(1, Math.hypot(dxN, dyN))
                const dirXN = dxN / distN
                const dirYN = dyN / distN
                const restN = springRestBase + (e.isAIProvider ? 10 : 0)
                const stretchN = distN - restN
                const forceN = kSpring * stretchN
                const fx = forceN * dirXN * scaleX
                const fy = forceN * dirYN * scaleY
                // Apply equal/opposite
                if (!from.isFixed) {
                    from.vx += (fx / from.mass) * dt
                    from.vy += (fy / from.mass) * dt
                }
                if (!to.isFixed) {
                    to.vx -= (fx / to.mass) * dt
                    to.vy -= (fy / to.mass) * dt
                }
            }

            // Integrate positions and constrain to viewport with proper node size margins
            const margin = 40 // Increased margin to account for node sizes
            for (const n of sim.values()) {
                if (n.isFixed) continue // Skip position updates for fixed nodes

                n.x += n.vx
                n.y += n.vy

                // Apply soft dragging forces based on node type
                const node = nodes.find(node => node.id === n.id)
                if (node) {
                    const firewallX = viewW / 2 // Center line
                    const leftTargetZone = firewallX - (viewW * 0.35) // Target zone for left side (further from center)
                    const rightTargetZone = firewallX + (viewW * 0.35) // Target zone for right side (further from center)

                    if (node.type === 'source') {
                        // Very gentle force pulling sources to left side
                        const leftForce = (leftTargetZone - n.x) * 0.008
                        n.vx += leftForce
                    } else if (node.type === 'provider' || node.type === 'external') {
                        // Very gentle force pulling providers/external to right side
                        const rightForce = (rightTargetZone - n.x) * 0.008
                        n.vx += rightForce
                    }
                }

                // Get node size to properly constrain bounds
                const nodeObj = nodes.find(node => node.id === n.id)
                if (nodeObj) {
                    const { w, h } = getNodeSize(nodeObj)
                    const halfW = w / 2
                    const halfH = h / 2

                    // Keep within bounds accounting for node size
                    n.x = Math.max(margin + halfW, Math.min(viewW - margin - halfW, n.x))
                    n.y = Math.max(margin + halfH, Math.min(viewH - margin - halfH, n.y))
                } else {
                    // Fallback bounds
                    n.x = Math.max(margin, Math.min(viewW - margin, n.x))
                    n.y = Math.max(margin, Math.min(viewH - margin, n.y))
                }
            }

            // Trigger re-render
            forceUpdate({})
        }
        raf = requestAnimationFrame(run)
        return () => cancelAnimationFrame(raf)
    }, [edges, running])

    // Mouse event handlers for dragging - LIKE DATAFLOWGRAPH
    useEffect(() => {
        function onMove(ev: MouseEvent) {
            if (!drag) return
            const sim = simRef.current
            if (!sim) return

            const rect = containerRef.current?.getBoundingClientRect()
            if (!rect) return

            const p = {
                x: ev.clientX - rect.left,
                y: ev.clientY - rect.top
            }

            const node = sim.get(drag.id)
            if (!node) return

            node.x = p.x - drag.dx
            node.y = p.y - drag.dy
            node.vx = 0
            node.vy = 0

            // Apply soft constraints during dragging
            const nodeObj = nodes.find(n => n.id === drag.id)
            if (nodeObj) {
                const margin = 20

                // Soft vertical bounds only
                if (node.y < margin) {
                    node.y = margin
                } else if (node.y > dims.h - margin) {
                    node.y = dims.h - margin
                }

                // No horizontal restrictions during dragging - let physics handle it
            }

            forceUpdate({})
        }

        function onUp() {
            setDrag(null)
        }

        if (drag) {
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
        }

        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    }, [drag, nodes, dims.w, dims.h])

    // For AI-only mode, show AI provider edges AND edges from sources that contacted AI providers
    const visibleEdges = edges.filter(e => {
        if (!showAIOnly) return true
        if (e.isAIProvider) return true

        // Also show edges from sources to firewall if the source contacted AI providers
        if (e.from !== 'firewall' && e.to === 'firewall') {
            const sourceNode = nodes.find(n => n.id === e.from)
            if (sourceNode && sourceNode.flows) {
                return sourceNode.flows.some(flow => flow.is_ai_provider === 1)
            }
        }

        return false
    })

    // For AI-only mode, show firewall, AI providers, AND sources that contacted AI providers
    const visibleNodes = nodes.filter(n => {
        if (!showAIOnly) return true
        if (n.type === 'firewall' || n.type === 'provider') return true

        // For source nodes, check if they have any flows to AI providers
        if (n.type === 'source' && n.flows) {
            return n.flows.some(flow => flow.is_ai_provider === 1)
        }

        return false
    })

    function edgeOpacity(e: EdgeDatum): number {
        // Priority: selectedNode > hoverNode > hoverEdge > default
        const activeNode = selectedNode || hoverNode

        if (activeNode) {
            // Find nodes that share actual flows with the active node (not graph traversal)
            const activeNodeObj = nodes.find(node => node.id === activeNode)
            if (!activeNodeObj) return 1

            // Don't apply special highlighting if the firewall node is hovered (only allow selection)
            if (activeNodeObj.type === 'firewall' && hoverNode === activeNode && !selectedNode) {
                return 1 // No special highlighting for firewall hover
            }

            const connectedNodes = new Set<string>()
            connectedNodes.add(activeNode) // Always include self

            // Find nodes that share actual flows with the active node
            const isActiveOnLeft = activeNodeObj.type === 'source'

            nodes.forEach(node => {
                if (node.id === activeNode) return // Skip self

                // Only consider nodes on the opposite side of the firewall
                const isCurrentOnLeft = node.type === 'source'
                const isOppositeSide = isActiveOnLeft !== isCurrentOnLeft

                if (!isOppositeSide) return // Skip nodes on the same side

                // Check if this node shares any flows with the active node
                const sharedFlows = node.flows?.filter(nodeFlow =>
                    activeNodeObj.flows?.some(activeFlow =>
                        // Same flow: same source and destination IPs and ports
                        nodeFlow.src_ip === activeFlow.src_ip &&
                        nodeFlow.dst_ip === activeFlow.dst_ip &&
                        nodeFlow.src_port === activeFlow.src_port &&
                        nodeFlow.dst_port === activeFlow.dst_port
                    )
                ) || []

                if (sharedFlows.length > 0) {
                    connectedNodes.add(node.id)
                }
            })

            // Highlight edges connected to any node in the connected set
            const isConnectedToActive = connectedNodes.has(e.from) || connectedNodes.has(e.to)
            if (!isConnectedToActive) return 0.05 // Very dim for unconnected edges
            return 1 // Full opacity for connected edges
        }
        if (hoverEdge && hoverEdge !== e.id) return 0.2
        return 1
    }

    function nodeOpacity(n: NodeDatum): number {
        // Priority: selectedNode > hoverNode > hoverEdge > default
        const activeNode = selectedNode || hoverNode

        if (activeNode) {
            // Find nodes that share actual flows with the active node (not graph traversal)
            const activeNodeObj = nodes.find(node => node.id === activeNode)
            if (!activeNodeObj) return 1

            // Don't apply special highlighting if the firewall node is hovered (only allow selection)
            if (activeNodeObj.type === 'firewall' && hoverNode === activeNode && !selectedNode) {
                return 1 // No special highlighting for firewall hover
            }

            const connectedNodes = new Set<string>()
            connectedNodes.add(activeNode) // Always include self

            // Find nodes that share actual flows with the active node
            const isActiveOnLeft = activeNodeObj.type === 'source'

            nodes.forEach(node => {
                if (node.id === activeNode) return // Skip self

                // Only consider nodes on the opposite side of the firewall
                const isCurrentOnLeft = node.type === 'source'
                const isOppositeSide = isActiveOnLeft !== isCurrentOnLeft

                if (!isOppositeSide) return // Skip nodes on the same side

                // Check if this node shares any flows with the active node
                const sharedFlows = node.flows?.filter(nodeFlow =>
                    activeNodeObj.flows?.some(activeFlow =>
                        // Same flow: same source and destination IPs and ports
                        nodeFlow.src_ip === activeFlow.src_ip &&
                        nodeFlow.dst_ip === activeFlow.dst_ip &&
                        nodeFlow.src_port === activeFlow.src_port &&
                        nodeFlow.dst_port === activeFlow.dst_port
                    )
                ) || []

                if (sharedFlows.length > 0) {
                    connectedNodes.add(node.id)
                }
            })

            // Only shadow nodes on the opposite side of the firewall that are NOT connected
            const isCurrentOnLeft = n.type === 'source'
            const isOppositeSide = isActiveOnLeft !== isCurrentOnLeft

            // Only shadow if: opposite side AND not connected AND not the active node itself
            if (isOppositeSide && !connectedNodes.has(n.id) && n.id !== activeNode) {
                return 0.1 // Shadow unconnected nodes on opposite side
            }

            return 1 // Full opacity for connected nodes, same-side nodes, and active node
        }
        if (hoverEdge) {
            const he = edges.find((x) => x.id === hoverEdge)
            if (he && !(he.from === n.id || he.to === n.id)) return 0.2
        }
        return 1
    }

    function labelForEdge(e: EdgeDatum): string {
        return `${e.protocol} • ${formatRatePerHour(e.volumePerHour)} • ${formatBytesPerHour(e.bytesPerHour)}`
    }

    const viewW = dims.w
    const viewH = dims.h

    useEffect(() => {
        svgBoundsRef.current = { w: viewW, h: viewH }

        // Debug rendering dimensions
        // console.log('Rendering debug:', {
        //     viewW, viewH,
        //     dims,
        //     BASE_W, BASE_H,
        //     scaleX: viewW / BASE_W,
        //     scaleY: viewH / BASE_H,
        //     svgViewBox: `0 0 ${viewW} ${viewH}`,
        //     cardContainer: containerRef.current?.getBoundingClientRect(),
        //     svgElement: containerRef.current?.querySelector('svg')?.getBoundingClientRect()
        // })
    }, [viewW, viewH])

    return (
        <div className="card">
            <div className="text-sm opacity-80 mb-2">Network Dataflow Graph</div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={showAIOnly}
                            onChange={(e) => setShowAIOnly(e.target.checked)}
                        />
                        Show AI providers only
                    </label>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <button className="text-sm" onClick={() => setRunning((r) => !r)}>
                        {running ? 'Stabilize' : 'Resume'}
                    </button>
                    <button className="text-sm" onClick={() => {
                        // reset positions - simple like original DataflowGraph
                        const sim = simRef.current
                        if (!sim) return
                        const scaleX = Math.max(0.001, dims.w / BASE_W)
                        const scaleY = Math.max(0.001, dims.h / BASE_H)
                        for (const n of nodes) {
                            const s = sim.get(n.id)
                            if (!s || s.isFixed) continue // Skip fixed nodes (firewall)
                            s.x = n.x * scaleX
                            s.y = n.y * scaleY
                            s.vx = 0
                            s.vy = 0
                        }
                        forceUpdate({})
                        setRunning(true)
                    }}>
                        Reset
                    </button>
                </div>
            </div>
            <div className="border border-app-border rounded h-[800px] w-full" style={{ position: 'relative' }} ref={containerRef}>
                <svg width="100%" height={viewH} viewBox={`0 0 ${viewW} ${viewH}`} preserveAspectRatio="xMidYMid meet">
                    <defs>
                        {Object.entries(PROTOCOL_COLORS).map(([protocol, color]) => (
                            <marker
                                key={`arrow-${protocol}`}
                                id={`arrow-${protocol}`}
                                markerWidth="10"
                                markerHeight="10"
                                refX="10"
                                refY="3"
                                orient="auto"
                                markerUnits="strokeWidth"
                            >
                                <path d="M0,0 L0,6 L9,3 z" fill={color} />
                            </marker>
                        ))}
                    </defs>

                    {/* Edges */}
                    {visibleEdges.map((e) => {
                        const from = nodes.find((n) => n.id === e.from)!
                        const to = nodes.find((n) => n.id === e.to)!
                        const fromSim = simRef.current?.get(from.id)
                        const toSim = simRef.current?.get(to.id)
                        const { w: fw, h: fh } = getNodeSize(from)
                        const { w: tw, h: th } = getNodeSize(to)
                        const x1 = (fromSim?.x ?? from.x) + fw / 2
                        const y1 = (fromSim?.y ?? from.y) + fh / 2
                        const x2 = (toSim?.x ?? to.x) + tw / 2
                        const y2 = (toSim?.y ?? to.y) + th / 2
                        const midX = (x1 + x2) / 2
                        const midY = (y1 + y2) / 2
                        const stroke = PROTOCOL_COLORS[e.protocol] || '#6b7280'
                        const markerEnd = `url(#arrow-${e.protocol})`
                        const sw = volumeToWidth(e.volumePerHour)
                        const op = edgeOpacity(e)
                        return (
                            <g key={e.id} opacity={op} onMouseEnter={() => setHoverEdge(e.id)} onMouseLeave={() => setHoverEdge(null)}>
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} markerEnd={markerEnd} />
                                <text x={midX} y={midY - 8} textAnchor="middle" fill="#a0a7b4" fontSize={10} style={{ userSelect: 'none' }}>
                                    {labelForEdge(e)}
                                </text>
                                <g transform={`translate(${midX}, ${midY + 8})`}>
                                    <rect x={-30} y={-10} width={60} height={16} rx={8} ry={8} fill={stroke} />
                                    <text x={0} y={2} textAnchor="middle" fontSize={10} fill="white" style={{ userSelect: 'none' }}>
                                        {e.isAIProvider ? 'AI' : 'EXT'}
                                    </text>
                                </g>
                            </g>
                        )
                    })}

                    {/* Nodes */}
                    {visibleNodes.map((n) => {
                        const { w, h } = getNodeSize(n)
                        const fill = nodeFill(n)
                        const stroke = 'var(--border)'
                        const op = nodeOpacity(n)
                        const sim = simRef.current?.get(n.id)
                        const nx = (sim?.x ?? n.x)
                        const ny = (sim?.y ?? n.y)

                        // Debug node rendering for firewall
                        // if (n.id === 'firewall') {
                        //     console.log('Firewall rendering debug:', {
                        //         nodeId: n.id,
                        //         originalX: n.x,
                        //         originalY: n.y,
                        //         simX: sim?.x,
                        //         simY: sim?.y,
                        //         renderedX: nx,
                        //         renderedY: ny,
                        //         nodeSize: { w, h },
                        //         centerX: nx + w / 2,
                        //         centerY: ny + h / 2,
                        //         viewW, viewH,
                        //         isFixed: sim?.isFixed
                        //     })
                        // }

                        return (
                            <g key={n.id} opacity={op}
                                onMouseEnter={() => setHoverNode(n.id)}
                                onMouseLeave={() => setHoverNode(null)}
                                onClick={() => setSelectedNode(n.id)}
                                onMouseDown={(e) => {
                                    const sim = simRef.current?.get(n.id)
                                    if (!sim || sim.isFixed) return // Don't drag fixed nodes (firewall)

                                    // Set as selected when starting to drag
                                    setSelectedNode(n.id)

                                    const rect = containerRef.current?.getBoundingClientRect()
                                    if (!rect) return

                                    const p = {
                                        x: e.clientX - rect.left,
                                        y: e.clientY - rect.top
                                    }

                                    setDrag({
                                        id: n.id,
                                        dx: p.x - sim.x,
                                        dy: p.y - sim.y
                                    })
                                }}
                                style={{ cursor: drag?.id === n.id ? 'grabbing' : 'pointer' }}>
                                {n.type === 'firewall' ? (
                                    <Hexagon x={nx} y={ny} w={w} h={h} fill={fill} stroke={stroke} />
                                ) : (
                                    <Rounded x={nx} y={ny} w={w} h={h} fill={fill} stroke={stroke} />
                                )}
                                <text x={nx + w / 2} y={ny + h / 2 + 4} textAnchor="middle" fill="#e6e6e6" fontSize={12} style={{ userSelect: 'none' }}>
                                    {n.label}
                                </text>
                                {/* Badges */}
                                <g transform={`translate(${nx + 12}, ${ny + 10})`}>
                                    <rect x={0} y={-10} width={80} height={18} rx={9} ry={9} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.06)" />
                                    <text x={40} y={3} textAnchor="middle" fill="#a0a7b4" fontSize={10} style={{ userSelect: 'none' }}>
                                        {n.meta.flows} flows{n.meta.ports ? ` • ${n.meta.ports} ports` : ''}
                                    </text>
                                </g>
                                <title>
                                    {`${n.label}\n${Object.entries(n.meta).map(([k, v]) => `${k}: ${String(v)}`).join('\n')}`}
                                </title>
                            </g>
                        )
                    })}
                </svg>

                {/* Legend */}
                <div className="card" style={{ position: 'absolute', left: 12, bottom: 12, width: 300, padding: 12 }}>
                    <div className="text-sm opacity-80 mb-2">Legend</div>
                    <div className="text-xs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="flex items-center gap-2"><span className="badge">Source</span><span className="opacity-80">computers</span></div>
                        <div className="flex items-center gap-2"><span className="badge">Firewall</span><span className="opacity-80">Edison</span></div>
                        <div className="flex items-center gap-2"><span className="badge">AI Provider</span><span className="opacity-80">LLM services</span></div>
                        <div className="flex items-center gap-2"><span className="badge">External</span><span className="opacity-80">services</span></div>
                        <div className="flex items-center gap-2"><span className="pill" style={{ background: PROTOCOL_COLORS.HTTPS, color: 'white' }}>HTTPS</span><span className="opacity-80">secure</span></div>
                        <div className="flex items-center gap-2"><span className="pill" style={{ background: PROTOCOL_COLORS.HTTP, color: 'white' }}>HTTP</span><span className="opacity-80">insecure</span></div>
                    </div>
                </div>

                {/* Details drawer */}
                {selectedNode ? (() => {
                    const n = nodes.find((x) => x.id === selectedNode)!
                    return (
                        <div className="card" style={{ position: 'absolute', right: 12, top: 12, width: 320, padding: 12 }}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-sm"><strong>{n.label}</strong></div>
                                <button className="text-sm" onClick={() => setSelectedNode(null)}>Close</button>
                            </div>
                            <div className="text-xs opacity-80 mb-2">Type: {n.type} • Health: {n.health}</div>
                            <div className="space-y-1 text-sm">
                                {Object.entries(n.meta).map(([k, v]) => (
                                    <div key={k} className="flex items-center justify-between">
                                        <span className="opacity-70">{k}</span>
                                        <span>{String(v)}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="text-xs opacity-70 mt-3">Connected flows:</div>
                            <div className="space-y-1 mt-1 text-xs">
                                {edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => (
                                    <div key={e.id} className="flex items-center justify-between">
                                        <span>{e.from === n.id ? '→' : '←'} {e.from === n.id ? e.to : e.from}</span>
                                        <span className="badge" style={{ background: PROTOCOL_COLORS[e.protocol] || '#6b7280', color: 'white' }}>
                                            {e.protocol}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                })() : null}
            </div>
        </div>
    )
}