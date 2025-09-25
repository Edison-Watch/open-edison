// Minimal service worker for actionable notifications

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Receive messages from pages to show notifications with actions
self.addEventListener('message', (event) => {
    try {
        const data = event.data || {};
        if (data && data.type === 'SHOW_MCP_BLOCK_NOTIFICATION') {
            const title = data.title || 'Action required';
            const body = data.body || 'Approve or deny the request';
            const payload = data.data || {};
            event.waitUntil(
                self.registration.showNotification(title, {
                    body,
                    requireInteraction: true,
                    data: payload,
                    actions: [
                        { action: 'approve', title: 'Approve' },
                        { action: 'deny', title: 'Deny' }
                    ]
                })
            );
        }
    } catch (e) {
        // swallow
    }
});

async function fetchWithAuth(path, init, payload) {
    try {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, (init && init.headers) || {})
        // Try to use apiKey passed in payload, else try to read from an active client via postMessage
        let apiKey = payload && payload.apiKey ? String(payload.apiKey) : ''
        if (!apiKey) {
            try {
                const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
                const first = clientsList && clientsList[0]
                if (first) {
                    // Request api key from the page; page should respond with { type: 'OE_API_KEY', apiKey }
                    const channel = new MessageChannel()
                    const apiKeyPromise = new Promise((resolve) => {
                        channel.port1.onmessage = (ev) => {
                            try { resolve((ev.data && ev.data.apiKey) || '') } catch { resolve('') }
                        }
                    })
                    first.postMessage({ type: 'OE_GET_API_KEY' }, [channel.port2])
                    apiKey = String(await Promise.race([apiKeyPromise, new Promise((r) => setTimeout(() => r(''), 300))]))
                }
            } catch { /* ignore */ }
        }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        return await fetch(path, Object.assign({}, init, { headers }))
    } catch (e) {
        return await fetch(path, init)
    }
}

// Handle action button clicks and generic clicks
self.addEventListener('notificationclick', (event) => {
    try {
        const payload = (event.notification && event.notification.data) || {};
        const action = event.action;
        event.notification.close();

        if (action === 'approve') {
            const body = {
                session_id: payload.sessionId,
                kind: payload.kind,
                name: payload.name,
                command: 'approve'
            };
            event.waitUntil(
                fetchWithAuth('/api/approve_or_deny', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }, payload).catch(() => { })
            );
            return;
        }

        if (action === 'deny') {
            const body = {
                session_id: payload.sessionId,
                kind: payload.kind,
                name: payload.name,
                command: 'deny'
            };
            event.waitUntil(
                fetchWithAuth('/api/approve_or_deny', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }, payload).catch(() => { })
            );
            return;
        }

        // Generic click: focus existing dashboard tab; if not found, open one with URL params so it can enqueue the pending approval
        event.waitUntil((async () => {
            try {
                const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
                const base = self.location && self.location.origin ? self.location.origin : '';
                const targetPrefix = base + '/dashboard';
                const existing = allClients.find(c => c.url && c.url.startsWith(targetPrefix));
                if (existing) {
                    try { existing.postMessage({ type: 'MCP_ENQUEUE_PENDING', data: payload }); } catch (e) { /* ignore */ }
                    await existing.focus();
                    return;
                }
            } catch (e) { /* ignore */ }
            try {
                const params = new URLSearchParams();
                if (payload.sessionId) params.set('pa_s', payload.sessionId);
                if (payload.kind) params.set('pa_k', payload.kind);
                if (payload.name) params.set('pa_n', payload.name);
                const url = '/dashboard/?' + params.toString();
                await self.clients.openWindow(url);
            } catch (e) { /* ignore */ }
        })());
    } catch (e) {
        // swallow
    }
});


