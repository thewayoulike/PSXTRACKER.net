// src/services/driveStorage.ts
// FINAL VERSION: Migrated to VPS Database & Cleaned up for Domain Hosting

// 1. Updated with your new Client ID
const CLIENT_ID = '738261170592-ohspqfpa3bd4ieefqffe4aj7p2p8qetd.apps.googleusercontent.com';

// LocalStorage Keys for Session Persistence
const STORAGE_TOKEN_KEY = 'psx_drive_access_token';
const STORAGE_USER_KEY = 'psx_drive_user_profile';
const STORAGE_EXPIRY_KEY = 'psx_drive_token_expiry';

// SCOPES: Optimized for Email/Profile and Gmail (for Email OCR)
// Removed Google Drive and Sheets permissions
const SCOPES = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.readonly openid';

let tokenClient: any = null;
let accessToken: string | null = null;
let tokenExpiryTime: number = 0;
let refreshTokenResolver: ((token: string) => void) | null = null;

export interface DriveUser {
  name: string;
  email: string;
  picture: string;
}

declare global {
  interface Window {
    google: any;
    gapi: any;
  }
}

const loadGoogleScript = () => {
    if (document.getElementById('google-gsi-script')) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.id = 'google-gsi-script';
    document.body.appendChild(script);
};

export const initDriveAuth = (onUserLoggedIn: (user: DriveUser) => void) => {
    loadGoogleScript();

    try {
        const storedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
        const storedUserStr = localStorage.getItem(STORAGE_USER_KEY);
        const storedExpiry = localStorage.getItem(STORAGE_EXPIRY_KEY);

        if (storedToken && storedUserStr && storedExpiry) {
            const expiry = parseInt(storedExpiry);
            const now = Date.now();
            
            if (!isNaN(expiry) && now < expiry - 60000) {
                accessToken = storedToken;
                tokenExpiryTime = expiry;
                const user = JSON.parse(storedUserStr);
                onUserLoggedIn(user);
            } else {
                localStorage.removeItem(STORAGE_TOKEN_KEY);
                localStorage.removeItem(STORAGE_USER_KEY);
                localStorage.removeItem(STORAGE_EXPIRY_KEY);
            }
        }
    } catch (e) {
        console.error("Error restoring session", e);
    }

    const checkInterval = setInterval(() => {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
            clearInterval(checkInterval);
            if (!CLIENT_ID) return;

            try {
                tokenClient = window.google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: SCOPES,
                    callback: async (tokenResponse: any) => {
                        if (tokenResponse && tokenResponse.access_token) {
                            accessToken = tokenResponse.access_token;
                            const expiresIn = (tokenResponse.expires_in || 3599) * 1000;
                            tokenExpiryTime = Date.now() + expiresIn;

                            localStorage.setItem(STORAGE_TOKEN_KEY, accessToken!);
                            localStorage.setItem(STORAGE_EXPIRY_KEY, tokenExpiryTime.toString());

                            if (refreshTokenResolver) {
                                refreshTokenResolver(accessToken!);
                                refreshTokenResolver = null;
                            }

                            const storedUser = localStorage.getItem(STORAGE_USER_KEY);
                            if (!storedUser || !refreshTokenResolver) {
                                try {
                                    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                                        headers: { Authorization: `Bearer ${accessToken}` }
                                    });
                                    if (response.ok) {
                                        const user = await response.json();
                                        const userData = {
                                            name: user.name,
                                            email: user.email,
                                            picture: user.picture
                                        };
                                        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(userData));
                                        onUserLoggedIn(userData);
                                    }
                                } catch (e) {
                                    console.error("Failed to fetch user info", e);
                                }
                            }
                        }
                    },
                });
            } catch (e) {
                console.error("Error initializing Google Token Client", e);
            }
        }
    }, 500);
};

export const signInWithDrive = () => {
    if (!tokenClient) {
        alert("Google Service initializing... please wait 2 seconds.");
        return;
    }
    tokenClient.requestAccessToken({ prompt: '' });
};

export const signOutDrive = () => {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_USER_KEY);
    localStorage.removeItem(STORAGE_EXPIRY_KEY);
    accessToken = null;
    window.location.reload();
};

export const getValidToken = async (): Promise<string | null> => {
    const now = Date.now();
    if (accessToken && tokenExpiryTime > now + 60000) return accessToken;
    if (!tokenClient) return null;
    return new Promise((resolve) => {
        refreshTokenResolver = resolve;
        tokenClient.requestAccessToken({ prompt: '' });
    });
};

// --- NEW VPS API DATABASE LOGIC ---

export const saveToDrive = async (data: any) => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return;
    
    try {
        const user = JSON.parse(userStr);
        await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email, data: data })
        });
        console.log("Auto-save successful (VPS Database)");
    } catch (e) {
        console.error("VPS Save failed", e);
    }
};

export const loadFromDrive = async () => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return null;
    
    try {
        const user = JSON.parse(userStr);
        const response = await fetch(`/api/load/${encodeURIComponent(user.email)}`);
        const result = await response.json();
        if (result.success) return result.data;
    } catch (e) {
        console.error("VPS Load failed", e);
    }
    return null;
};

// --- Dummy Exports (Required so App.tsx doesn't crash) ---

export const getGoogleSheetId = async () => null;
export const syncTransactionsToSheet = async () => {};

// --- Gmail Integration (Kept for your Email OCR Scanner) ---

export const searchGmailMessages = async (query: string) => {
    const token = await getValidToken();
    if (!token) return [];
    try {
        const q = `${query} has:attachment`;
        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=5`;
        const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
        const listData = await listResp.json();
        if (!listData.messages) return [];
        return await Promise.all(listData.messages.map(async (msg: any) => {
            const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
            const detailResp = await fetch(detailUrl, { headers: { Authorization: `Bearer ${token}` } });
            const d = await detailResp.json();
            const subject = d.payload.headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
            const from = d.payload.headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
            const attachments: any[] = [];
            const findAtt = (partList: any[]) => {
                partList.forEach((p: any) => {
                    if (p.body?.attachmentId) attachments.push({ id: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType, messageId: msg.id, size: p.body.size });
                    if (p.parts) findAtt(p.parts);
                });
            };
            if (d.payload.parts) findAtt(d.payload.parts);
            return { id: msg.id, subject, from, date: parseInt(d.internalDate), attachments };
        }));
    } catch (e) { return []; }
};

export const downloadGmailAttachment = async (messageId: string, attachmentId: string, filename: string, mimeType: string): Promise<File | null> => {
    const token = await getValidToken();
    if (!token) return null;
    try {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

export const hasValidSession = (): boolean => {
    const expiry = localStorage.getItem(STORAGE_EXPIRY_KEY);
    return !!expiry && Date.now() < parseInt(expiry) - 60000;
};
export const deleteUserData = async (email: string) => {
    try {
        const response = await fetch(`/api/delete/${encodeURIComponent(email)}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        return result.success;
    } catch (e) {
        console.error("Delete failed", e);
        return false;
    }
};
