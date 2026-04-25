// src/services/driveStorage.ts
// VPS-ONLY VERSION: Google Drive Storage Removed asd

const CLIENT_ID = '738261170592-ohspqfpa3bd4ieefqffe4aj7p2p8qetd.apps.googleusercontent.com';

// LocalStorage Keys
const STORAGE_TOKEN_KEY = 'psx_drive_access_token';
const STORAGE_USER_KEY = 'psx_drive_user_profile';
const STORAGE_EXPIRY_KEY = 'psx_drive_token_expiry';

// SCOPES: Removed all Drive/Gmail permissions. Only Profile/Email for identity.
const SCOPES = 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid';

let tokenClient: any = null;
let accessToken: string | null = null;
let tokenExpiryTime: number = 0;
let refreshTokenResolver: ((token: string) => void) | null = null;

export interface DriveUser {
  name: string;
  email: string;
  picture: string;
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
            if (!isNaN(expiry) && Date.now() < expiry - 60000) {
                accessToken = storedToken;
                tokenExpiryTime = expiry;
                onUserLoggedIn(JSON.parse(storedUserStr));
            }
        }
    } catch (e) {}

    const checkInterval = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
            clearInterval(checkInterval);
            tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: async (tokenResponse: any) => {
                    if (tokenResponse?.access_token) {
                        accessToken = tokenResponse.access_token;
                        tokenExpiryTime = Date.now() + (tokenResponse.expires_in || 3599) * 1000;
                        localStorage.setItem(STORAGE_TOKEN_KEY, accessToken!);
                        localStorage.setItem(STORAGE_EXPIRY_KEY, tokenExpiryTime.toString());

                        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                            headers: { Authorization: `Bearer ${accessToken}` }
                        });
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

export const signOutDrive = () => {
    localStorage.clear();
    window.location.reload();
};

// --- VPS DATABASE LOGIC (NO GOOGLE DRIVE CHECKING) ---

export const saveToDrive = async (data: any) => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return;
    try {
        const user = JSON.parse(userStr);
        // Correct path to match your updated server.js
        await fetch(`/api/save/${encodeURIComponent(user.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        console.log("✅ Data saved to VPS Database");
    } catch (e) {
        console.error("VPS Save failed", e);
    }
};

export const loadFromDrive = async () => {
    const userStr = localStorage.getItem(STORAGE_USER_KEY);
    if (!userStr) return [];
    try {
        const user = JSON.parse(userStr);
        const response = await fetch(`/api/load/${encodeURIComponent(user.email)}`);
        
        if (response.ok) {
            return await response.json(); // Return VPS data
        }
    } catch (e) {
        console.error("VPS Load error", e);
    }
    // If VPS is empty or fails, return empty array. NO GOOGLE DRIVE FALLBACK.
    return [];
};

// Dummy exports for compatibility
export const getGoogleSheetId = async () => null;
export const syncTransactionsToSheet = async () => {};
export const hasValidSession = () => !!localStorage.getItem(STORAGE_EXPIRY_KEY) && Date.now() < parseInt(localStorage.getItem(STORAGE_EXPIRY_KEY) || '0') - 60000;
