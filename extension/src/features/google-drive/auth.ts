/**
 * Google auth via chrome.identity (spec section 6, 29). The extension uses a
 * single developer-owned OAuth Client — the user never creates a Google
 * Cloud Project, they just click "Connect Google".
 */
export async function connectGoogle(): Promise<string> {
  const token = await chrome.identity.getAuthToken({ interactive: true });
  const accessToken = typeof token === "string" ? token : token.token;
  if (!accessToken) {
    throw new Error("Google authorization was not granted.");
  }
  return accessToken;
}

export async function getGoogleToken(interactive = false): Promise<string | null> {
  try {
    const token = await chrome.identity.getAuthToken({ interactive });
    const accessToken = typeof token === "string" ? token : token.token;
    return accessToken ?? null;
  } catch {
    return null;
  }
}

export async function disconnectGoogle(): Promise<void> {
  const token = await getGoogleToken(false);
  if (!token) return;
  await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
  await chrome.identity.removeCachedAuthToken({ token });
}

export async function isGoogleConnected(): Promise<boolean> {
  const token = await getGoogleToken(false);
  return token !== null;
}
