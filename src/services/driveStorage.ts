// src/services/driveStorage.ts
const CLIENT_ID = '738261170592-ohspqfpa3bd4ieefqffe4aj7p2p8qetd.apps.googleusercontent.com';
const STORAGE_TOKEN_KEY = 'psx_drive_access_token';
const STORAGE_USER_KEY = 'psx_drive_user_profile';
const STORAGE_EXPIRY_KEY = 'psx_drive_token_expiry';
const SCOPES = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.readonly openid';

let tokenClient: any = null;
let accessToken: string | null = null;
let tokenExpiryTime: number = 0;

export interface DriveUser { name: string; email: string; picture: string; }

// --- AUTH LOGIC ---

export const initDriveAuth = (onUserLoggedIn: (user: DriveUser) => void) => {
    // Immediate check for existing session
    const savedUser = localStorage.getItem(STORAGE_USER_KEY);
    const expiry = localStorage.getItem(STORAGE_EXPIRY_KEY);
    if (savedUser && expiry && Date.now() < parseInt(expiry)) {
        onUserLoggedIn(JSON.parse(savedUser));
    }

    if (!document.getElementById('google-gsi-script')) {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true; script.id = 'google-gsi-script';
        document.body.appendChild(script);
    }

    const checkInterval = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
            clearInterval(checkInterval);
            tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID, scope: SCOPES,
                callback: async (resp: any) => {
                    if (resp?.access_token) {
                        accessToken = resp.access_token;
                        tokenExpiryTime = Date.now() + (resp.expires_in || 3599) * 1000;
                        localStorage.setItem(STORAGE_TOKEN_KEY, accessToken!);
                        localStorage.setItem(STORAGE_EXPIRY_KEY, tokenExpiryTime.toString());
                        const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { 
                            headers: { Authorization: `Bearer ${accessToken}` } 
                        });
                        if (userResp.ok) {
                            const user = await userResp.json();
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

// FIXED: Explicitly exporting this now so the build passes
export const signInWithDrive = () => {
    if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: '' });
    } else {
        console.error("Google Auth not initialized yet.");
    }
};

export const signOutDrive = () => {
    localStorage.clear();
    window.location.reload();
};

// --- VPS DATA STORAGE ---

export const loadFromDrive = async () => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return { transactions: [], portfolios: [] };
    try {
        const user = JSON.parse(userStr);
        const resp = await fetch(`/api/load/${encodeURIComponent(user.email)}`);
        if (resp.ok) {
            const data = await resp.json();
            return {
                transactions: Array.isArray(data?.transactions) ? data.transactions : [],
                portfolios: Array.isArray(data?.portfolios) ? data.portfolios : []
            };
        }
    } catch (e) { console.error("VPS Load Error", e); }
    return { transactions: [], portfolios: [] };
};

export const saveToDrive = async (data: any) => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return;
    try {
        const user = JSON.parse(userStr);
        await fetch(`/api/save/${encodeURIComponent(user.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (e) { console.error("VPS Save Error", e); }
};

// --- COMPATIBILITY EXPORTS (Required for App.tsx and TransactionForm.tsx) ---

export const getValidToken = async () => localStorage.getItem(STORAGE_TOKEN_KEY);
export const searchGmailMessages = async () => [];
export const downloadGmailAttachment = async () => null;
export const hasValidSession = () => {
    const expiry = localStorage.getItem(STORAGE_EXPIRY_KEY);
    return expiry ? Date.now() < parseInt(expiry) : false;
};
export const syncTransactionsToSheet = async () => {};
export const getGoogleSheetId = async () => null;
export const deleteUserData = async (email: string) => {
    try {
        const resp = await fetch(`/api/delete/${encodeURIComponent(email)}`, { method: 'DELETE' });
        return resp.ok;
    } catch (e) { return false; }
};
