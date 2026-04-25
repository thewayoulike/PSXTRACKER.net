// src/services/driveStorage.ts
const CLIENT_ID = '738261170592-ohspqfpa3bd4ieefqffe4aj7p2p8qetd.apps.googleusercontent.com';
const STORAGE_TOKEN_KEY = 'psx_drive_access_token';
const STORAGE_USER_KEY = 'psx_drive_user_profile';
const STORAGE_EXPIRY_KEY = 'psx_drive_token_expiry';
const SCOPES = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.readonly openid';

let tokenClient: any = null;
let accessToken: string | null = null;
let tokenExpiryTime: number = 0;
let refreshTokenResolver: ((token: string) => void) | null = null;

export interface DriveUser { name: string; email: string; picture: string; }

const loadGoogleScript = () => {
    if (document.getElementById('google-gsi-script')) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true; script.defer = true; script.id = 'google-gsi-script';
    document.body.appendChild(script);
};

export const initDriveAuth = (onUserLoggedIn: (user: DriveUser) => void) => {
    loadGoogleScript();
    const checkInterval = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
            clearInterval(checkInterval);
            tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID, scope: SCOPES,
                callback: async (tokenResponse: any) => {
                    if (tokenResponse?.access_token) {
                        accessToken = tokenResponse.access_token;
                        tokenExpiryTime = Date.now() + (tokenResponse.expires_in || 3599) * 1000;
                        localStorage.setItem(STORAGE_TOKEN_KEY, accessToken!);
                        localStorage.setItem(STORAGE_EXPIRY_KEY, tokenExpiryTime.toString());
                        if (refreshTokenResolver) { refreshTokenResolver(accessToken!); refreshTokenResolver = null; }
                        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
                        if (response.ok) {
                            const user = await response.json();
                            const userData = { name: user.name, email: user.email, picture: user.picture };
                            localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(userData));
                            onUserLoggedIn(userData);
                        }
                    }
                },
            });
        }
    }, 500);
};

export const signInWithDrive = () => tokenClient?.requestAccessToken({ prompt: '' });
export const signOutDrive = () => { localStorage.clear(); window.location.reload(); };

export const getValidToken = async (): Promise<string | null> => {
    const now = Date.now();
    if (accessToken && tokenExpiryTime > now + 60000) return accessToken;
    if (!tokenClient) return null;
    return new Promise((resolve) => { refreshTokenResolver = resolve; tokenClient.requestAccessToken({ prompt: '' }); });
};

// --- VPS LOGIC ---
export const saveToDrive = async (data: any) => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return;
    try {
        const user = JSON.parse(userStr);
        await fetch(`/api/save/${encodeURIComponent(user.email)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (e) { console.error("Save failed", e); }
};

export const loadFromDrive = async () => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return [];
    try {
        const user = JSON.parse(userStr);
        const response = await fetch(`/api/load/${encodeURIComponent(user.email)}`);
        if (response.ok) return await response.json();
    } catch (e) { console.error("Load failed", e); }
    return [];
};

// --- GMAIL FOR OCR (Fixes Build Crash) ---
export const searchGmailMessages = async (query: string) => {
    const token = await getValidToken();
    if (!token) return [];
    try {
        const q = `${query} has:attachment`;
        const listResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=5`, { headers: { Authorization: `Bearer ${token}` } });
        const listData = await listResp.json();
        if (!listData.messages) return [];
        return await Promise.all(listData.messages.map(async (msg: any) => {
            const detailResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
            const d = await detailResp.json();
            const subject = d.payload.headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
            const attachments: any[] = [];
            const findAtt = (partList: any[]) => { partList.forEach((p: any) => { if (p.body?.attachmentId) attachments.push({ id: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType, messageId: msg.id, size: p.body.size }); if (p.parts) findAtt(p.parts); }); };
            if (d.payload.parts) findAtt(d.payload.parts);
            return { id: msg.id, subject, from: 'Google OCR', date: parseInt(d.internalDate), attachments };
        }));
    } catch (e) { return []; }
};

export const downloadGmailAttachment = async (messageId: string, attachmentId: string, filename: string, mimeType: string): Promise<File | null> => {
    const token = await getValidToken();
    if (!token) return null;
    try {
        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (data.data) {
            const byteCharacters = atob(data.data.replace(/-/g, '+').replace(/_/g, '/'));
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
            return new File([new Uint8Array(byteNumbers)], filename, { type: mimeType });
        }
    } catch (e) { console.error(e); }
    return null;
};

export const getGoogleSheetId = async () => null;
export const syncTransactionsToSheet = async () => {};
export const hasValidSession = () => !!localStorage.getItem(STORAGE_EXPIRY_KEY) && Date.now() < parseInt(localStorage.getItem(STORAGE_EXPIRY_KEY) || '0') - 60000;
export const deleteUserData = async (email: string) => true;
