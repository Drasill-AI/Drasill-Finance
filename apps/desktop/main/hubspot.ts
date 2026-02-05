/**
 * HubSpot CRM Integration
 * 
 * Provides OAuth 2.0 authentication and read-only API access to HubSpot CRM.
 * Used for:
 * - Querying deals, contacts, companies, and owners via AI chat
 * - (Optional) Embedding HubSpot WebView for direct editing
 */

import * as http from 'http';
import * as keytar from 'keytar';
import { shell } from 'electron';

// ============================================================================
// Configuration
// ============================================================================

// HubSpot OAuth App credentials
const CLIENT_ID = '5f678b1e-5a2f-49ad-9cc4-c4228360a493';
const CLIENT_SECRET = 'fb8e0740-dfac-4b5a-b3ab-3945c16d28b8';

// OAuth endpoints
const AUTH_ENDPOINT = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://api.hubapi.com/oauth/v1/token';
const API_BASE_URL = 'https://api.hubapi.com';

// Local callback server
const REDIRECT_PORT = 5678;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/hubspot-callback`;

// Requested scopes (read-only CRM access)
const SCOPES = [
  'crm.objects.deals.read',
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.owners.read',
];

// Keychain storage
const SERVICE_NAME = 'DrasillCloud';
const HUBSPOT_ACCESS_TOKEN_KEY = 'hubspot_access_token';
const HUBSPOT_REFRESH_TOKEN_KEY = 'hubspot_refresh_token';
const HUBSPOT_TOKEN_EXPIRY_KEY = 'hubspot_token_expiry';
const HUBSPOT_USER_EMAIL_KEY = 'hubspot_user_email';
const HUBSPOT_PORTAL_ID_KEY = 'hubspot_portal_id';

// In-memory cache for performance
let accessToken: string | null = null;
let tokenExpiry: number = 0;
let portalId: string | null = null;

// ============================================================================
// Token Storage (using OS keychain via keytar)
// ============================================================================

async function storeTokens(
  newAccessToken: string,
  newRefreshToken: string,
  expiresIn: number,
  email?: string,
  hubspotPortalId?: string
): Promise<void> {
  const expiry = Date.now() + (expiresIn * 1000);
  
  await Promise.all([
    keytar.setPassword(SERVICE_NAME, HUBSPOT_ACCESS_TOKEN_KEY, newAccessToken),
    keytar.setPassword(SERVICE_NAME, HUBSPOT_REFRESH_TOKEN_KEY, newRefreshToken),
    keytar.setPassword(SERVICE_NAME, HUBSPOT_TOKEN_EXPIRY_KEY, expiry.toString()),
    email ? keytar.setPassword(SERVICE_NAME, HUBSPOT_USER_EMAIL_KEY, email) : Promise.resolve(),
    hubspotPortalId ? keytar.setPassword(SERVICE_NAME, HUBSPOT_PORTAL_ID_KEY, hubspotPortalId) : Promise.resolve(),
  ]);

  // Update in-memory cache
  accessToken = newAccessToken;
  tokenExpiry = expiry;
  portalId = hubspotPortalId || portalId;

  console.log('[HubSpot] Tokens stored successfully');
}

async function loadTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  expiry: number;
  email: string | null;
  portalId: string | null;
}> {
  const [storedAccessToken, storedRefreshToken, storedExpiry, storedEmail, storedPortalId] = await Promise.all([
    keytar.getPassword(SERVICE_NAME, HUBSPOT_ACCESS_TOKEN_KEY),
    keytar.getPassword(SERVICE_NAME, HUBSPOT_REFRESH_TOKEN_KEY),
    keytar.getPassword(SERVICE_NAME, HUBSPOT_TOKEN_EXPIRY_KEY),
    keytar.getPassword(SERVICE_NAME, HUBSPOT_USER_EMAIL_KEY),
    keytar.getPassword(SERVICE_NAME, HUBSPOT_PORTAL_ID_KEY),
  ]);

  return {
    accessToken: storedAccessToken,
    refreshToken: storedRefreshToken,
    expiry: storedExpiry ? parseInt(storedExpiry, 10) : 0,
    email: storedEmail,
    portalId: storedPortalId,
  };
}

async function clearTokens(): Promise<void> {
  await Promise.all([
    keytar.deletePassword(SERVICE_NAME, HUBSPOT_ACCESS_TOKEN_KEY),
    keytar.deletePassword(SERVICE_NAME, HUBSPOT_REFRESH_TOKEN_KEY),
    keytar.deletePassword(SERVICE_NAME, HUBSPOT_TOKEN_EXPIRY_KEY),
    keytar.deletePassword(SERVICE_NAME, HUBSPOT_USER_EMAIL_KEY),
    keytar.deletePassword(SERVICE_NAME, HUBSPOT_PORTAL_ID_KEY),
  ]);

  // Clear in-memory cache
  accessToken = null;
  tokenExpiry = 0;
  portalId = null;

  console.log('[HubSpot] Tokens cleared');
}

// ============================================================================
// OAuth Token Exchange & Refresh
// ============================================================================

async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Token exchange failed:', error);
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Token refresh failed:', error);
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  };
}

/**
 * Get valid access token (refresh if needed)
 */
async function getValidAccessToken(): Promise<string | null> {
  // Check in-memory cache first (with 60s buffer)
  if (accessToken && tokenExpiry > Date.now() + 60000) {
    return accessToken;
  }

  // Load from keychain
  const tokens = await loadTokens();

  if (!tokens.accessToken) {
    return null;
  }

  // If token is still valid, use it
  if (tokens.expiry > Date.now() + 60000) {
    accessToken = tokens.accessToken;
    tokenExpiry = tokens.expiry;
    portalId = tokens.portalId;
    return accessToken;
  }

  // Token expired, try to refresh
  if (tokens.refreshToken) {
    try {
      const newTokens = await refreshAccessToken(tokens.refreshToken);
      await storeTokens(
        newTokens.accessToken,
        newTokens.refreshToken,
        newTokens.expiresIn,
        tokens.email || undefined,
        tokens.portalId || undefined
      );
      return newTokens.accessToken;
    } catch (error) {
      console.error('[HubSpot] Failed to refresh token:', error);
      await clearTokens();
      return null;
    }
  }

  return null;
}

// ============================================================================
// OAuth Flow
// ============================================================================

/**
 * Generate random string for state parameter
 */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  require('crypto').randomFillSync(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

/**
 * Get HubSpot account info (portal ID, user email)
 */
async function getAccountInfo(token: string): Promise<{ portalId: string; email: string }> {
  const response = await fetch(`${API_BASE_URL}/oauth/v1/access-tokens/${token}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get HubSpot account info');
  }

  const data = await response.json();
  return {
    portalId: data.hub_id?.toString() || '',
    email: data.user || '',
  };
}

/**
 * Start HubSpot OAuth flow
 * Opens browser for HubSpot login and handles callback
 */
export async function startHubSpotAuth(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Generate state for CSRF protection
    const state = generateRandomString(32);

    // Build authorization URL
    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    authUrl.searchParams.set('state', state);

    let server: http.Server | null = null;
    let resolved = false;

    const cleanup = () => {
      if (server) {
        server.close();
        server = null;
      }
    };

    // Start local server to receive callback
    server = http.createServer(async (req, res) => {
      if (resolved) return;

      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/hubspot-callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #ff4444;">Authentication Failed</h1>
                <p>${errorDescription || error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          resolved = true;
          cleanup();
          resolve({ success: false, error: errorDescription || error });
          return;
        }

        if (returnedState !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #ff4444;">Authentication Failed</h1>
                <p>Invalid state parameter. This may be a CSRF attack.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          resolved = true;
          cleanup();
          resolve({ success: false, error: 'Invalid state parameter' });
          return;
        }

        if (!code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #ff4444;">Authentication Failed</h1>
                <p>No authorization code received.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          resolved = true;
          cleanup();
          resolve({ success: false, error: 'No authorization code received' });
          return;
        }

        try {
          // Exchange code for tokens
          const tokens = await exchangeCodeForTokens(code);

          // Get account info
          const accountInfo = await getAccountInfo(tokens.accessToken);

          // Store tokens
          await storeTokens(
            tokens.accessToken,
            tokens.refreshToken,
            tokens.expiresIn,
            accountInfo.email,
            accountInfo.portalId
          );

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #00a4bd;">HubSpot Connected!</h1>
                <p>Successfully connected to HubSpot.</p>
                <p>Portal ID: ${accountInfo.portalId}</p>
                <p>You can close this window and return to Drasill Finance.</p>
              </body>
            </html>
          `);

          resolved = true;
          cleanup();
          resolve({ success: true });
        } catch (err) {
          console.error('[HubSpot] OAuth callback error:', err);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #ff4444;">Authentication Failed</h1>
                <p>${err instanceof Error ? err.message : 'Unknown error'}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          resolved = true;
          cleanup();
          resolve({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`[HubSpot] OAuth callback server listening on port ${REDIRECT_PORT}`);
      // Open browser for authentication
      shell.openExternal(authUrl.toString());
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, error: 'Authentication timed out' });
      }
    }, 5 * 60 * 1000);
  });
}

// ============================================================================
// Auth Status & Logout
// ============================================================================

export interface HubSpotAuthStatus {
  connected: boolean;
  email?: string;
  portalId?: string;
}

/**
 * Get HubSpot connection status
 */
export async function getHubSpotAuthStatus(): Promise<HubSpotAuthStatus> {
  const tokens = await loadTokens();

  if (!tokens.accessToken) {
    return { connected: false };
  }

  // Verify token is still valid (or can be refreshed)
  const validToken = await getValidAccessToken();

  if (!validToken) {
    return { connected: false };
  }

  return {
    connected: true,
    email: tokens.email || undefined,
    portalId: tokens.portalId || undefined,
  };
}

/**
 * Disconnect from HubSpot (logout)
 */
export async function logoutHubSpot(): Promise<void> {
  await clearTokens();
  console.log('[HubSpot] Logged out');
}

// ============================================================================
// HubSpot CRM API - Deals
// ============================================================================

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    hubspot_owner_id?: string;
    description?: string;
    [key: string]: string | undefined;
  };
  associations?: {
    contacts?: { results: Array<{ id: string }> };
    companies?: { results: Array<{ id: string }> };
  };
}

export interface HubSpotDealsResponse {
  results: HubSpotDeal[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

/**
 * Get all deals from HubSpot
 */
export async function getHubSpotDeals(options?: {
  limit?: number;
  after?: string;
  properties?: string[];
}): Promise<HubSpotDealsResponse> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const defaultProperties = [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'createdate',
    'hs_lastmodifieddate',
    'hubspot_owner_id',
    'description',
  ];

  const params = new URLSearchParams();
  params.set('limit', (options?.limit || 100).toString());
  if (options?.after) {
    params.set('after', options.after);
  }
  (options?.properties || defaultProperties).forEach(prop => {
    params.append('properties', prop);
  });

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/objects/deals?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get deals:', error);
    throw new Error(`Failed to get HubSpot deals: ${error}`);
  }

  return response.json();
}

/**
 * Get a single deal by ID
 */
export async function getHubSpotDeal(
  dealId: string,
  properties?: string[]
): Promise<HubSpotDeal> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const defaultProperties = [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'createdate',
    'hs_lastmodifieddate',
    'hubspot_owner_id',
    'description',
  ];

  const params = new URLSearchParams();
  (properties || defaultProperties).forEach(prop => {
    params.append('properties', prop);
  });
  // Include associations
  params.append('associations', 'contacts');
  params.append('associations', 'companies');

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/objects/deals/${dealId}?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get deal:', error);
    throw new Error(`Failed to get HubSpot deal: ${error}`);
  }

  return response.json();
}

/**
 * Search deals by criteria
 */
export async function searchHubSpotDeals(query: {
  filterGroups?: Array<{
    filters: Array<{
      propertyName: string;
      operator: string;
      value: string;
    }>;
  }>;
  query?: string;
  limit?: number;
  properties?: string[];
}): Promise<HubSpotDealsResponse> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const defaultProperties = [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'createdate',
    'hs_lastmodifieddate',
    'hubspot_owner_id',
    'description',
  ];

  const response = await fetch(`${API_BASE_URL}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: query.filterGroups || [],
      query: query.query,
      limit: query.limit || 100,
      properties: query.properties || defaultProperties,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to search deals:', error);
    throw new Error(`Failed to search HubSpot deals: ${error}`);
  }

  return response.json();
}

// ============================================================================
// HubSpot CRM API - Contacts
// ============================================================================

export interface HubSpotContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    company?: string;
    jobtitle?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    [key: string]: string | undefined;
  };
}

export interface HubSpotContactsResponse {
  results: HubSpotContact[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

/**
 * Get all contacts from HubSpot
 */
export async function getHubSpotContacts(options?: {
  limit?: number;
  after?: string;
  properties?: string[];
}): Promise<HubSpotContactsResponse> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const defaultProperties = [
    'email',
    'firstname',
    'lastname',
    'phone',
    'company',
    'jobtitle',
    'createdate',
    'hs_lastmodifieddate',
  ];

  const params = new URLSearchParams();
  params.set('limit', (options?.limit || 100).toString());
  if (options?.after) {
    params.set('after', options.after);
  }
  (options?.properties || defaultProperties).forEach(prop => {
    params.append('properties', prop);
  });

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/objects/contacts?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get contacts:', error);
    throw new Error(`Failed to get HubSpot contacts: ${error}`);
  }

  return response.json();
}

/**
 * Get a single contact by ID
 */
export async function getHubSpotContact(
  contactId: string,
  properties?: string[]
): Promise<HubSpotContact> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const defaultProperties = [
    'email',
    'firstname',
    'lastname',
    'phone',
    'company',
    'jobtitle',
    'createdate',
    'hs_lastmodifieddate',
  ];

  const params = new URLSearchParams();
  (properties || defaultProperties).forEach(prop => {
    params.append('properties', prop);
  });

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/objects/contacts/${contactId}?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get contact:', error);
    throw new Error(`Failed to get HubSpot contact: ${error}`);
  }

  return response.json();
}

// ============================================================================
// HubSpot CRM API - Companies
// ============================================================================

export interface HubSpotCompany {
  id: string;
  properties: {
    name?: string;
    domain?: string;
    industry?: string;
    phone?: string;
    city?: string;
    state?: string;
    country?: string;
    numberofemployees?: string;
    annualrevenue?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    [key: string]: string | undefined;
  };
}

export interface HubSpotCompaniesResponse {
  results: HubSpotCompany[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

/**
 * Get all companies from HubSpot
 */
export async function getHubSpotCompanies(options?: {
  limit?: number;
  after?: string;
  properties?: string[];
}): Promise<HubSpotCompaniesResponse> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const defaultProperties = [
    'name',
    'domain',
    'industry',
    'phone',
    'city',
    'state',
    'country',
    'numberofemployees',
    'annualrevenue',
    'createdate',
    'hs_lastmodifieddate',
  ];

  const params = new URLSearchParams();
  params.set('limit', (options?.limit || 100).toString());
  if (options?.after) {
    params.set('after', options.after);
  }
  (options?.properties || defaultProperties).forEach(prop => {
    params.append('properties', prop);
  });

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/objects/companies?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get companies:', error);
    throw new Error(`Failed to get HubSpot companies: ${error}`);
  }

  return response.json();
}

/**
 * Get a single company by ID
 */
export async function getHubSpotCompany(
  companyId: string,
  properties?: string[]
): Promise<HubSpotCompany> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const defaultProperties = [
    'name',
    'domain',
    'industry',
    'phone',
    'city',
    'state',
    'country',
    'numberofemployees',
    'annualrevenue',
    'createdate',
    'hs_lastmodifieddate',
  ];

  const params = new URLSearchParams();
  (properties || defaultProperties).forEach(prop => {
    params.append('properties', prop);
  });

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/objects/companies/${companyId}?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get company:', error);
    throw new Error(`Failed to get HubSpot company: ${error}`);
  }

  return response.json();
}

// ============================================================================
// HubSpot CRM API - Owners
// ============================================================================

export interface HubSpotOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface HubSpotOwnersResponse {
  results: HubSpotOwner[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

/**
 * Get all owners from HubSpot
 */
export async function getHubSpotOwners(options?: {
  limit?: number;
  after?: string;
}): Promise<HubSpotOwnersResponse> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const params = new URLSearchParams();
  params.set('limit', (options?.limit || 100).toString());
  if (options?.after) {
    params.set('after', options.after);
  }

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/owners?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get owners:', error);
    throw new Error(`Failed to get HubSpot owners: ${error}`);
  }

  return response.json();
}

// ============================================================================
// HubSpot CRM API - Pipelines
// ============================================================================

export interface HubSpotPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: {
    probability?: string;
  };
}

export interface HubSpotPipeline {
  id: string;
  label: string;
  displayOrder: number;
  stages: HubSpotPipelineStage[];
}

export interface HubSpotPipelinesResponse {
  results: HubSpotPipeline[];
}

/**
 * Get all deal pipelines from HubSpot
 */
export async function getHubSpotPipelines(): Promise<HubSpotPipelinesResponse> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  const response = await fetch(
    `${API_BASE_URL}/crm/v3/pipelines/deals`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[HubSpot] Failed to get pipelines:', error);
    throw new Error(`Failed to get HubSpot pipelines: ${error}`);
  }

  return response.json();
}

// ============================================================================
// Utility Functions for AI Chat Tools
// ============================================================================

/**
 * Get a summary of all deals for AI context
 */
export async function getHubSpotDealsSummary(): Promise<{
  totalDeals: number;
  totalValue: number;
  dealsByStage: Record<string, { count: number; value: number }>;
  recentDeals: HubSpotDeal[];
}> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('Not authenticated with HubSpot');
  }

  // Get all deals (paginate if needed)
  let allDeals: HubSpotDeal[] = [];
  let after: string | undefined;

  do {
    const response = await getHubSpotDeals({ limit: 100, after });
    allDeals = allDeals.concat(response.results);
    after = response.paging?.next?.after;
  } while (after && allDeals.length < 1000); // Cap at 1000 deals for performance

  // Calculate summary
  const dealsByStage: Record<string, { count: number; value: number }> = {};
  let totalValue = 0;

  for (const deal of allDeals) {
    const stage = deal.properties.dealstage || 'unknown';
    const amount = parseFloat(deal.properties.amount || '0') || 0;

    if (!dealsByStage[stage]) {
      dealsByStage[stage] = { count: 0, value: 0 };
    }
    dealsByStage[stage].count++;
    dealsByStage[stage].value += amount;
    totalValue += amount;
  }

  // Get recent deals (sorted by createdate)
  const recentDeals = [...allDeals]
    .sort((a, b) => {
      const dateA = new Date(a.properties.createdate || 0).getTime();
      const dateB = new Date(b.properties.createdate || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 10);

  return {
    totalDeals: allDeals.length,
    totalValue,
    dealsByStage,
    recentDeals,
  };
}
