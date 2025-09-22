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
                name: payload.name
            };
            event.waitUntil(
                fetch('/api/approve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).catch(() => { })
            );
            return;
        }

        if (action === 'deny') {
            // No-op; could notify page if desired
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


