import type { ApiRequest, ApiResponse } from './types';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  // 1. Get the query string (everything after the ?)
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const query = url.search; // e.g., "?module=logs&action=..."

  // 2. Define the real target
  const targetUrl = `https://eth-sepolia.blockscout.com/api${query}`;

  try {
    // 3. Fetch from Blockscout (Node.js automatically sets the correct Host header)
    const response = await fetch(targetUrl);
    
    // 4. Pass the data back to your frontend
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch from Blockscout proxy' });
  }
}