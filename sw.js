// --- PUSH NOTIFICATION RECEIVER ---
self.addEventListener('push', (event) => {
    let data = { title: 'PSX Tracker', body: 'New alert triggered!' };
    
    if (event.data) {
        data = event.data.json();
    }

    const options = {
        body: data.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-64x64.png',
        vibrate: [200, 100, 200, 100, 200, 100, 200],
        requireInteraction: true // Keeps notification on screen until user dismisses it
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('/')
    );
});

