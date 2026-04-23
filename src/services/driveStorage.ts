// src/services/driveStorage.ts
// Updated to use VPS Database instead of Google Drive
// Keeps Google Login (for Identity) and Gmail Integration (for OCR)

const HARDCODED_CLIENT_ID = '76622516302-malmubqvj1ms3klfsgr5p6jaom2o7e8s.apps.googleusercontent.com';
const CLIENT_ID_KEY = 'VITE_GOOGLE_CLIENT_ID';

// LocalStorage Keys for Session Persistence
const STORAGE_TOKEN_KEY = 'psx_drive_access_token';
const STORAGE_USER_KEY = 'psx_drive_user_profile';
const STORAGE_EXPIRY_KEY = 'psx_drive_token_expiry';

// SCOPES: Removed Drive & Sheets. Kept Profile & Gmail
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

const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) { /* ignore */ }
  return undefined;
};

const RAW_ID = HARDCODED_CLIENT_ID;
const CLIENT_ID = (RAW_ID && RAW_ID.includes('.apps.googleusercontent.com')) ? RAW_ID : undefined;

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
        alert("Google Service initializing... please wait 2 seconds and try again.");
        return;
    }
    tokenClient.requestAccessToken({ prompt: '' });
};

export const signOutDrive = () => {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_USER_KEY);
    localStorage.removeItem(STORAGE_EXPIRY_KEY);
    accessToken = null;

    if (window.google && accessToken) {
        window.google.accounts.oauth2.revoke(accessToken, () => {
            window.location.reload();
        });
    } else {
        window.location.reload();
    }
};

export const getValidToken = async (): Promise<string | null> => {
    const now = Date.now();
    if (accessToken && tokenExpiryTime > now + 60000) {
        return accessToken;
    }

    if (!tokenClient) return null;
    
    return new Promise((resolve) => {
        refreshTokenResolver = resolve;
        tokenClient.requestAccessToken({ prompt: '' });
    });
};

// --- NEW: VPS Database Operations (Replaces Drive) ---

export const saveToDrive = async (data: any) => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return;
    
    try {
        const user = JSON.parse(userStr);
        const contentToSave = {
            ...data,
            lastModified: new Date().toISOString()
        };

        await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: user.email,
                data: contentToSave
            })
        });
        console.log("Data saved to VPS database.");
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
        
        if (result.success && result.data) {
            console.log("Data loaded from VPS database.");
            return result.data;
        }
    } catch (e) {
        console.error("VPS Load failed", e);
    }
    return null;
};

// --- Google Sheets Sync (Disabled/Bypassed) ---

export const getGoogleSheetId = async (): Promise<string | null> => {
    return null; // Disabled
};

export const syncTransactionsToSheet = async (transactions: any[], portfolios: any[]) => {
    return Promise.resolve(); // Disabled
};

// --- GMAIL INTEGRATION FUNCTIONS (KEPT INTACT FOR EMAIL SCANNER) ---

export const searchGmailMessages = async (query: string) => {
    const token = await getValidToken();
    if (!token) return [];

    try {
        const q = `${query} has:attachment`;
        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=10`;
        const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (listResp.status === 403) throw new Error("Permission denied. Please re-authenticate.");
        const listData = await listResp.json();
        if (!listData.messages) return [];

        const messages = await Promise.all(listData.messages.map(async (msg: any) => {
            const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
            const detailResp = await fetch(detailUrl, { headers: { Authorization: `Bearer ${token}` } });
            const detailData = await detailResp.json();
            const subject = detailData.payload.headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
            const from = detailData.payload.headers.find((h: any) => h.name === 'From')?.value || 'Unknown Sender';
            const date = detailData.internalDate;
            const attachments: any[] = [];
            
            const traverseParts = (partList: any[]) => {
                partList.forEach((part: any) => {
                    if (part.body && part.body.attachmentId) {
                        attachments.push({ id: part.body.attachmentId, filename: part.filename, mimeType: part.mimeType, messageId: msg.id, size: part.body.size });
                    }
                    if (part.parts) traverseParts(part.parts);
                });
            };
            if (detailData.payload.parts) traverseParts(detailData.payload.parts);
            return { id: msg.id, snippet: detailData.snippet, subject, from, date: parseInt(date), attachments };
        }));
        return messages;
    } catch (e: any) {
        throw new Error(e.message || "Failed to access Gmail.");
    }
};

const getMimeType = (filename: string, originalMime: string) => {
    if (originalMime && originalMime !== 'application/octet-stream') return originalMime;
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'pdf': return 'application/pdf';
        case 'jpg': case 'jpeg': return 'image/jpeg';
        case 'png': return 'image/png';
        case 'csv': return 'text/csv';
        case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        case 'xls': return 'application/vnd.ms-excel';
        default: return originalMime || 'application/octet-stream';
    }
};

export const downloadGmailAttachment = async (messageId: string, attachmentId: string, filename: string, mimeType: string): Promise<File | null> => {
    const token = await getValidToken();
    if (!token) return null;

    try {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        
        if (data.data) {
            const base64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
            const byteArray = new Uint8Array(byteNumbers);
            const finalMimeType = getMimeType(filename, mimeType);
            return new File([byteArray], filename, { type: finalMimeType });
        }
    } catch (e) {
        console.error("Attachment Download Failed", e);
    }
    return null;
};

export const hasValidSession = (): boolean => {
    try {
        const storedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
        const storedExpiry = localStorage.getItem(STORAGE_EXPIRY_KEY);
        if (storedToken && storedExpiry) {
            const now = Date.now();
            return now < parseInt(storedExpiry) - 60000;
        }
    } catch (e) { return false; }
    return false;
};
