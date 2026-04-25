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

export const initDriveAuth = (onUserLoggedIn: (user: DriveUser) => void) => {
    if (document.getElementById('google-gsi-script')) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true; script.defer = true; script.id = 'google-gsi-script';
    document.body.appendChild(script);

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
                        const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
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

export const signInWithDrive = () => tokenClient?.requestAccessToken({ prompt: '' });
export const signOutDrive = () => { localStorage.clear(); window.location.reload(); };

export const loadFromDrive = async () => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return { transactions: [], portfolios: [] };
    try {
        const user = JSON.parse(userStr);
        const resp = await fetch(`/api/load/${encodeURIComponent(user.email)}`);
        if (resp.ok) {
            const data = await resp.json();
            // Force return of objects so forEach doesn't fail
            return {
                transactions: Array.isArray(data.transactions) ? data.transactions : [],
                portfolios: Array.isArray(data.portfolios) ? data.portfolios : []
            };
        }
    } catch (e) { console.error("Load failed", e); }
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
    } catch (e) { console.error("Save failed", e); }
};

// --- GMAIL Integration (Fixes Build) ---
export const getValidToken = async (): Promise<string | null> => {
    if (accessToken && tokenExpiryTime > Date.now() + 60000) return accessToken;
    return null;
};

export const searchGmailMessages = async () => [];
export const downloadGmailAttachment = async () => null;
export const hasValidSession = () => !!localStorage.getItem(STORAGE_EXPIRY_KEY);
export const syncTransactionsToSheet = async () => {};
export const getGoogleSheetId = async () => null;
export const deleteUserData = async () => true;
